"use client";

import { supabase } from "@/lib/supabase";
import { CONTACTABILITY_SHEET_URL, fetchSheetClients } from "../google-sheet";
import type { ContactabilityClient, ContactRecord, WeeklyFollowUp } from "../types";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = { workspaceId: string; userId: string; canEdit: boolean };
const CONTACT_CHANNELS = ["WhatsApp", "Llamada", "Correo", "Reunion", "Otro"];

function limaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone: "America/Lima", year: "numeric"
  }).format(date);
}

function startOfWeek(date = new Date()) {
  const parts = limaDate(date).split("-").map(Number);
  const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = localDate.getDay() || 7;
  localDate.setDate(localDate.getDate() - day + 1);
  return limaDate(localDate);
}

function endOfWeek(weekStart: string) {
  const date = new Date(`${weekStart}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

function friendlyDate(value?: string | null) {
  if (!value) return "Sin registrar";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"
  }).format(new Date(`${value}T12:00:00Z`));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export function ContactabilidadModule({ workspaceId, userId, canEdit }: Props) {
  const [clients, setClients] = useState<ContactabilityClient[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [weekly, setWeekly] = useState<WeeklyFollowUp[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [contactClient, setContactClient] = useState<ContactabilityClient | null>(null);
  const [contactForm, setContactForm] = useState({ fecha: limaDate(), canal: "WhatsApp", notas: "" });
  const autoSyncedWorkspace = useRef("");

  const loadData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [clientsResult, contactsResult, weeklyResult] = await Promise.all([
        supabase.from("contactabilidad_clientes").select("*").eq("workspace_id", workspaceId).eq("activo", true).order("marca"),
        supabase.from("contactabilidad_contactos").select("*").eq("workspace_id", workspaceId).order("fecha_contacto", { ascending: false }),
        supabase.from("contactabilidad_semanas").select("*").eq("workspace_id", workspaceId).eq("semana_inicio", weekStart)
      ]);
      if (clientsResult.error) throw clientsResult.error;
      if (contactsResult.error) throw contactsResult.error;
      if (weeklyResult.error) throw weeklyResult.error;
      setClients((clientsResult.data ?? []) as ContactabilityClient[]);
      setContacts((contactsResult.data ?? []) as ContactRecord[]);
      setWeekly((weeklyResult.data ?? []) as WeeklyFollowUp[]);
    } catch (loadError) {
      setError(`No se pudo cargar Contactabilidad. ${errorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [weekStart, workspaceId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const weeklyByClient = useMemo(() => new Map(weekly.map((item) => [item.cliente_id, item])), [weekly]);
  const contactsByClient = useMemo(() => {
    const grouped = new Map<string, ContactRecord[]>();
    contacts.forEach((contact) => grouped.set(contact.cliente_id, [...(grouped.get(contact.cliente_id) ?? []), contact]));
    return grouped;
  }, [contacts]);

  const visibleClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    if (!query) return clients;
    return clients.filter((client) =>
      [client.marca, client.ruc, ...client.servicios].some((value) => value.toLocaleLowerCase("es").includes(query))
    );
  }, [clients, search]);

  const metrics = useMemo(() => ({
    contacted: clients.filter((client) =>
      (contactsByClient.get(client.id) ?? []).some((contact) =>
        contact.fecha_contacto >= weekStart && contact.fecha_contacto < endOfWeek(weekStart)
      )
    ).length,
    meetings: clients.filter((client) => weeklyByClient.get(client.id)?.reunion_agendada).length,
    reports: clients.filter((client) => weeklyByClient.get(client.id)?.reporte_enviado).length
  }), [clients, contactsByClient, weekStart, weeklyByClient]);

  async function syncClients() {
    if (!workspaceId || !canEdit || syncing) return;
    setSyncing(true);
    setError("");
    try {
      const sheetClients = await fetchSheetClients();
      if (!sheetClients.length) throw new Error("No se encontraron clientes validos en la pestaña Reportes.");
      const syncedAt = new Date().toISOString();
      const existingByRuc = new Map(clients.map((client) => [client.ruc, client]));
      const changedClients = sheetClients.filter((client) => {
        const existing = existingByRuc.get(client.ruc);
        if (!existing) return true;
        return (
          existing.marca !== client.marca ||
          existing.estado_reporte_origen !== client.estadoReporte ||
          JSON.stringify([...existing.servicios].sort()) !== JSON.stringify([...client.servicios].sort())
        );
      });
      if (!changedClients.length) return;
      const { error: upsertError } = await supabase.from("contactabilidad_clientes").upsert(
        changedClients.map((client) => ({
          activo: true,
          estado_reporte_origen: client.estadoReporte,
          fila_origen: client.filaOrigen,
          marca: client.marca,
          ruc: client.ruc,
          servicios: client.servicios,
          sincronizado_en: syncedAt,
          workspace_id: workspaceId
        })),
        { onConflict: "workspace_id,ruc" }
      );
      if (upsertError) throw upsertError;
      await loadData();
    } catch (syncError) {
      setError(`No se pudo sincronizar el Google Sheet. ${errorMessage(syncError)}`);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (loading || !workspaceId || !canEdit || autoSyncedWorkspace.current === workspaceId) return;
    autoSyncedWorkspace.current = workspaceId;
    void syncClients();
    // syncClients se ejecuta una vez por workspace; el boton permite repetirla manualmente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, loading, workspaceId]);

  async function updateWeekly(clientId: string, changes: Partial<WeeklyFollowUp>) {
    if (!canEdit || saving) return;
    const current = weeklyByClient.get(clientId);
    const optimistic: WeeklyFollowUp = {
      id: current?.id ?? `temporary-${clientId}`,
      workspace_id: workspaceId,
      cliente_id: clientId,
      semana_inicio: weekStart,
      reporte_enviado: current?.reporte_enviado ?? false,
      reunion_agendada: current?.reunion_agendada ?? false,
      fecha_reunion: current?.fecha_reunion ?? null,
      updated_at: new Date().toISOString(),
      ...changes
    };
    setWeekly((items) => [...items.filter((item) => item.cliente_id !== clientId), optimistic]);
    setSaving(true);
    const { data, error: updateError } = await supabase.from("contactabilidad_semanas").upsert({
      workspace_id: workspaceId,
      cliente_id: clientId,
      semana_inicio: weekStart,
      reporte_enviado: optimistic.reporte_enviado,
      reunion_agendada: optimistic.reunion_agendada,
      fecha_reunion: optimistic.reunion_agendada ? optimistic.fecha_reunion : null,
      updated_by: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "workspace_id,cliente_id,semana_inicio" }).select().single();
    setSaving(false);
    if (updateError) {
      setError(`No se pudo actualizar el seguimiento semanal. ${errorMessage(updateError)}`);
      await loadData();
      return;
    }
    setWeekly((items) => [...items.filter((item) => item.cliente_id !== clientId), data as WeeklyFollowUp]);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactClient || !canEdit || saving) return;
    setSaving(true);
    const { data, error: insertError } = await supabase.from("contactabilidad_contactos").insert({
      workspace_id: workspaceId,
      cliente_id: contactClient.id,
      fecha_contacto: contactForm.fecha,
      canal: contactForm.canal,
      notas: contactForm.notas.trim() || null,
      created_by: userId
    }).select().single();
    setSaving(false);
    if (insertError) {
      setError(`No se pudo registrar el contacto. ${errorMessage(insertError)}`);
      return;
    }
    setContacts((items) => [data as ContactRecord, ...items]);
    setContactClient(null);
    setContactForm({ fecha: limaDate(), canal: "WhatsApp", notas: "" });
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">Contactabilidad</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Seguimiento de clientes</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Contactos, reportes y reuniones de presentacion organizados por semana.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={CONTACTABILITY_SHEET_URL} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">Ver Google Sheet</a>
            <button type="button" disabled={!canEdit || syncing} onClick={() => void syncClients()} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-800 disabled:bg-red-300">
              {syncing ? "Sincronizando..." : "Sincronizar clientes"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Clientes activos" value={clients.length} detail="Sincronizados desde Sheets" />
        <Metric label="Contactados" value={metrics.contacted} detail="Durante la semana" />
        <Metric label="Reportes enviados" value={metrics.reports} detail={`de ${clients.length} clientes`} />
        <Metric label="Reuniones agendadas" value={metrics.meetings} detail={`de ${clients.length} clientes`} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cliente, RUC o servicio" className="rounded-lg border border-slate-200 px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          <label className="grid gap-1 text-xs font-bold text-slate-500">Semana que inicia
            <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-4">Cliente</th><th className="px-5 py-4">Ultimo contacto</th><th className="px-5 py-4">Reporte semanal</th><th className="px-5 py-4">Reunion semanal</th><th className="px-5 py-4">Accion</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleClients.map((client) => {
                const clientContacts = contactsByClient.get(client.id) ?? [];
                const week = weeklyByClient.get(client.id);
                return (
                  <tr key={client.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-5 py-4"><p className="font-extrabold">{client.marca}</p><p className="mt-1 text-xs text-slate-500">RUC {client.ruc}</p><p className="mt-2 max-w-md text-xs text-slate-400">{client.servicios.join(" · ") || "Sin servicio indicado"}</p></td>
                    <td className="px-5 py-4"><p className="font-bold">{friendlyDate(clientContacts[0]?.fecha_contacto)}</p><p className="mt-1 text-xs text-slate-500">{clientContacts[0]?.canal ?? "Sin contactos"} · {clientContacts.length} registro{clientContacts.length === 1 ? "" : "s"}</p></td>
                    <td className="px-5 py-4"><label className="inline-flex items-center gap-3 font-bold"><input type="checkbox" disabled={!canEdit || saving} checked={week?.reporte_enviado ?? false} onChange={(event) => void updateWeekly(client.id, { reporte_enviado: event.target.checked })} className="h-5 w-5 accent-red-700" />{week?.reporte_enviado ? "Enviado" : "Pendiente"}</label></td>
                    <td className="px-5 py-4"><label className="flex items-center gap-3 font-bold"><input type="checkbox" disabled={!canEdit || saving} checked={week?.reunion_agendada ?? false} onChange={(event) => void updateWeekly(client.id, { reunion_agendada: event.target.checked })} className="h-5 w-5 accent-red-700" />{week?.reunion_agendada ? "Agendada" : "Pendiente"}</label>{week?.reunion_agendada ? <input type="date" disabled={!canEdit || saving} value={week.fecha_reunion ?? ""} onChange={(event) => void updateWeekly(client.id, { fecha_reunion: event.target.value || null })} className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none" /> : null}</td>
                    <td className="px-5 py-4"><button type="button" disabled={!canEdit} onClick={() => setContactClient(client)} className="rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white disabled:bg-slate-300">Registrar contacto</button></td>
                  </tr>
                );
              })}
              {!visibleClients.length && !loading ? <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">{clients.length ? "No hay clientes para esta busqueda." : "Sin clientes. Usa Sincronizar clientes para importar el Google Sheet."}</td></tr> : null}
              {loading ? <tr><td colSpan={5} className="px-6 py-10 text-center font-semibold text-slate-500">Cargando contactabilidad...</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {contactClient ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
          <form onSubmit={saveContact} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-700">Nuevo contacto</p>
            <h3 className="mt-2 text-2xl font-extrabold">{contactClient.marca}</h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-bold text-slate-500">Fecha<input required type="date" value={contactForm.fecha} onChange={(event) => setContactForm({ ...contactForm, fecha: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="grid gap-1 text-xs font-bold text-slate-500">Canal<select value={contactForm.canal} onChange={(event) => setContactForm({ ...contactForm, canal: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900">{CONTACT_CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
            </div>
            <label className="mt-4 grid gap-1 text-xs font-bold text-slate-500">Notas<textarea rows={4} value={contactForm.notas} onChange={(event) => setContactForm({ ...contactForm, notas: event.target.value })} placeholder="Acuerdos o detalles del contacto" className="resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-900" /></label>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setContactClient(null)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold">Cancelar</button><button type="submit" disabled={saving} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-bold text-white disabled:bg-red-300">{saving ? "Guardando..." : "Guardar contacto"}</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><div className="mt-2 flex items-end justify-between gap-3"><strong className="text-3xl">{value}</strong><span className="text-right text-xs text-slate-400">{detail}</span></div></article>;
}

"use client";

import type { RealtimeChannel, User } from "@supabase/supabase-js";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { supabase } from "@/lib/supabase";
import { initialPendingTasks } from "../data";
import type {
  CompletedPendingAction,
  CompletedPendingTask,
  PendingPresenceUser,
  PendingPriority,
  PendingResponsibleOption,
  PendingStatus,
  PendingTask
} from "../types";

type ListaPendientesModuleProps = {
  user: User | null;
  workspaceId: string;
  responsables?: PendingResponsibleOption[];
};

type PendingTaskPatch = Partial<
  Pick<
    PendingTask,
    | "estado"
    | "fecha_fin"
    | "fecha_inicio"
    | "orden"
    | "prioridad"
    | "responsable"
    | "tiempo_acumulado_segundos"
    | "temporizador_duracion_segundos"
    | "temporizador_inicio"
    | "temporizador_usuario_id"
    | "temporizador_usuario_nombre"
    | "titulo"
  >
>;

type CompletedHistoryView = "completadas" | "eliminadas" | "todas";
type OwnerFilter = "Todos" | string;
type StatusFilter = "Todos" | PendingStatus;
type PriorityFilter = "Todas" | PendingPriority;

const STATUS_OPTIONS: PendingStatus[] = ["pendiente", "en_proceso", "bloqueado"];
const PRIORITY_OPTIONS: PendingPriority[] = ["alta", "media", "baja"];

export function ListaPendientesModule({
  user,
  workspaceId,
  responsables = []
}: ListaPendientesModuleProps) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const saveTimersRef = useRef<Record<string, number>>({});
  const draggedTaskIdRef = useRef<string | null>(null);
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<CompletedPendingTask[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PendingPresenceUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskOwner, setNewTaskOwner] = useState("");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<PendingPriority>("media");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("Todos");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("Todas");
  const [completedHistoryView, setCompletedHistoryView] =
    useState<CompletedHistoryView>("completadas");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [, setClock] = useState(0);

  const displayName = useMemo(() => getUserDisplayName(user), [user]);
  const responsibleOptions = useMemo(() => {
    const unique = new Map<string, PendingResponsibleOption>();
    responsables
      .map((responsable, index) => ({
        ...responsable,
        nombre: responsable.nombre.trim(),
        orden: Number.isFinite(responsable.orden) ? responsable.orden : index + 1
      }))
      .filter((responsable) => responsable.nombre)
      .forEach((responsable) => {
        const key = normalizeText(responsable.nombre);
        const current = unique.get(key);
        if (!current || responsable.orden < current.orden) unique.set(key, responsable);
      });

    const sorted = Array.from(unique.values()).sort(
      (left, right) => left.orden - right.orden || left.nombre.localeCompare(right.nombre)
    );
    return sorted.length ? sorted : [{ nombre: displayName, orden: 1 }];
  }, [displayName, responsables]);

  const responsibleNames = useMemo(
    () => responsibleOptions.map((responsable) => responsable.nombre),
    [responsibleOptions]
  );

  useEffect(() => {
    if (!responsibleNames.includes(newTaskOwner)) {
      setNewTaskOwner(
        responsibleNames.find((name) => normalizeText(name) === normalizeText(displayName)) ??
          responsibleNames[0] ??
          ""
      );
    }
  }, [displayName, newTaskOwner, responsibleNames]);

  const ensureInitialTasks = useCallback(async () => {
    if (!workspaceId || !user) return;
    const { count, error: countError } = await supabase
      .from("lista_pendientes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    if (countError) throw countError;
    if ((count ?? 0) > 0) return;

    const now = new Date().toISOString();
    const { error } = await supabase.from("lista_pendientes").insert(
      initialPendingTasks.map((task, index) => ({
        ...task,
        created_by: user.id,
        fecha_creacion: now,
        orden: index,
        prioridad: "media",
        tiempo_acumulado_segundos: 0,
        temporizador_duracion_segundos: 0,
        workspace_id: workspaceId
      }))
    );
    if (error) throw error;
  }, [user, workspaceId]);

  const loadPendingData = useCallback(async () => {
    if (!workspaceId || !user) return;
    setLoading(true);
    setErrorMessage("");

    try {
      await ensureInitialTasks();
      const [{ data: activeRows, error: activeError }, { data: historyRows, error: historyError }] =
        await Promise.all([
          supabase
            .from("lista_pendientes")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("orden", { ascending: true })
            .order("fecha_creacion", { ascending: true }),
          supabase
            .from("lista_pendientes_completadas")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("fecha_finalizacion", { ascending: false })
        ]);

      if (activeError) throw activeError;
      if (historyError) throw historyError;
      setTasks((activeRows ?? []).map(normalizeTask));
      setCompletedTasks((historyRows ?? []).map(normalizeCompletedTask));
    } catch (error) {
      setErrorMessage(
        `No se pudo cargar el Panel de Pendientes. Ejecuta el schema actualizado de Supabase. Detalle: ${getErrorMessage(error)}`
      );
    } finally {
      setLoading(false);
    }
  }, [ensureInitialTasks, user, workspaceId]);

  useEffect(() => {
    loadPendingData();
  }, [loadPendingData]);

  useEffect(() => {
    if (!tasks.some((task) => task.temporizador_inicio)) return undefined;
    const interval = window.setInterval(() => setClock((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [tasks]);

  useEffect(() => {
    const expired = tasks.filter(
      (task) =>
        task.temporizador_inicio &&
        task.temporizador_usuario_id === user?.id &&
        remainingSeconds(task) <= 0
    );
    expired.forEach((task) => void pauseTimer(task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, user?.id]);

  useEffect(() => {
    if (!workspaceId || !user) return undefined;
    const channel = supabase.channel(`lista-pendientes-${workspaceId}`, {
      config: { presence: { key: user.id } }
    });
    channelRef.current = channel;

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `workspace_id=eq.${workspaceId}`,
          schema: "public",
          table: "lista_pendientes"
        },
        () => loadPendingData()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `workspace_id=eq.${workspaceId}`,
          schema: "public",
          table: "lista_pendientes_completadas"
        },
        () => loadPendingData()
      )
      .on("presence", { event: "sync" }, () => setPresenceUsers(readPresenceUsers(channel)))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track(buildPresencePayload(user, displayName, null));
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [displayName, loadPendingData, user, workspaceId]);

  const connectedStatus = useMemo(
    () =>
      responsibleNames.map((name) => ({
        name,
        presence: presenceUsers.find((presenceUser) => matchesKnownUser(presenceUser, name))
      })),
    [presenceUsers, responsibleNames]
  );

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const ownerMatches = ownerFilter === "Todos" || task.responsable === ownerFilter;
        const statusMatches = statusFilter === "Todos" || task.estado === statusFilter;
        const priorityMatches = priorityFilter === "Todas" || task.prioridad === priorityFilter;
        return ownerMatches && statusMatches && priorityMatches;
      }),
    [ownerFilter, priorityFilter, statusFilter, tasks]
  );

  const taskGroups = useMemo(() => {
    const byOwner = visibleTasks.reduce<Record<string, PendingTask[]>>((groups, task) => {
      const owner = task.responsable?.trim() || "Sin responsable";
      groups[owner] = [...(groups[owner] ?? []), task];
      return groups;
    }, {});
    const known = responsibleNames
      .map((owner) => ({ owner, tasks: byOwner[owner] ?? [] }))
      .filter((group) => group.tasks.length);
    const knownNames = new Set(responsibleNames);
    const extra = Object.entries(byOwner)
      .filter(([owner]) => !knownNames.has(owner))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([owner, ownerTasks]) => ({ owner, tasks: ownerTasks }));
    return [...known, ...extra];
  }, [responsibleNames, visibleTasks]);

  const overdueCount = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.fecha_fin &&
          task.estado !== "bloqueado" &&
          new Date(task.fecha_fin).getTime() < Date.now()
      ).length,
    [tasks]
  );

  const completedByOwner = useMemo(
    () =>
      completedTasks.filter(
        (task) => ownerFilter === "Todos" || task.responsable === ownerFilter
      ),
    [completedTasks, ownerFilter]
  );

  const visibleCompletedTasks = useMemo(() => {
    if (completedHistoryView === "todas") return completedByOwner;
    if (completedHistoryView === "eliminadas") {
      return completedByOwner.filter((task) => task.accion === "eliminada");
    }
    return completedByOwner.filter((task) => task.accion === "completada");
  }, [completedByOwner, completedHistoryView]);

  function updatePresence(task: PendingTask | null) {
    if (!user || !channelRef.current) return;
    channelRef.current.track(buildPresencePayload(user, displayName, task));
  }

  function updateTaskLocal(taskId: string, patch: PendingTaskPatch) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    );
  }

  function scheduleTaskSave(taskId: string, patch: PendingTaskPatch) {
    updateTaskLocal(taskId, patch);
    window.clearTimeout(saveTimersRef.current[taskId]);
    saveTimersRef.current[taskId] = window.setTimeout(() => {
      void saveTaskPatch(taskId, patch);
    }, 300);
  }

  async function saveTaskPatch(taskId: string, patch: PendingTaskPatch) {
    const { error } = await supabase
      .from("lista_pendientes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("workspace_id", workspaceId);
    if (error) {
      setErrorMessage(`No se pudo actualizar la tarea: ${getErrorMessage(error)}`);
      loadPendingData();
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !user || saving) return;
    if (!newTaskTitle.trim()) {
      setErrorMessage("Escribe el nombre del pendiente.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    const nextOrder = tasks.reduce((max, task) => Math.max(max, task.orden), -1) + 1;
    const { error } = await supabase.from("lista_pendientes").insert({
      created_by: user.id,
      estado: "pendiente",
      fecha_creacion: new Date().toISOString(),
      fecha_fin: toDatabaseDateTime(newTaskDueDate),
      fecha_inicio: toDatabaseDateTime(newTaskStartDate),
      orden: nextOrder,
      prioridad: newTaskPriority,
      responsable: newTaskOwner || responsibleNames[0] || null,
      tiempo_acumulado_segundos: 0,
      temporizador_duracion_segundos: durationFromDates(
        newTaskStartDate,
        newTaskDueDate
      ),
      titulo: newTaskTitle.trim(),
      workspace_id: workspaceId
    });

    if (error) {
      setErrorMessage(`No se pudo crear la tarea: ${getErrorMessage(error)}`);
    } else {
      setNewTaskTitle("");
      setNewTaskStartDate("");
      setNewTaskDueDate("");
      setNewTaskPriority("media");
      setOwnerFilter("Todos");
      setStatusFilter("Todos");
      setPriorityFilter("Todas");
    }
    setSaving(false);
  }

  async function startTimer(task: PendingTask) {
    if (!user) return;
    if (
      task.temporizador_inicio &&
      task.temporizador_usuario_id &&
      task.temporizador_usuario_id !== user.id
    ) {
      setErrorMessage(`${task.temporizador_usuario_nombre || "Otro usuario"} está trabajando esta tarea.`);
      return;
    }

    const otherActive = tasks.filter(
      (item) => item.id !== task.id && item.temporizador_usuario_id === user.id
    );
    await Promise.all(otherActive.map((item) => pauseTimer(item)));

    const duration =
      remainingSeconds(task) > 0
        ? task.temporizador_duracion_segundos
        : Math.max(
            task.temporizador_duracion_segundos,
            scheduledDuration(task),
            task.tiempo_acumulado_segundos + 3600
          );
    const patch: PendingTaskPatch = {
      estado: "en_proceso",
      temporizador_duracion_segundos: duration,
      temporizador_inicio: new Date().toISOString(),
      temporizador_usuario_id: user.id,
      temporizador_usuario_nombre: displayName
    };
    updateTaskLocal(task.id, patch);
    await saveTaskPatch(task.id, patch);
  }

  async function pauseTimer(task: PendingTask) {
    if (!task.temporizador_inicio) return;
    const elapsed = elapsedCurrentSession(task);
    const patch: PendingTaskPatch = {
      tiempo_acumulado_segundos: task.tiempo_acumulado_segundos + elapsed,
      temporizador_inicio: null,
      temporizador_usuario_id: null,
      temporizador_usuario_nombre: null
    };
    updateTaskLocal(task.id, patch);
    await saveTaskPatch(task.id, patch);
  }

  async function toggleTimer(task: PendingTask) {
    if (task.temporizador_inicio && task.temporizador_usuario_id === user?.id) {
      await pauseTimer(task);
      return;
    }
    await startTimer(task);
  }

  async function moveTaskToCompleted(
    task: PendingTask,
    action: CompletedPendingAction
  ) {
    if (!workspaceId || !user || saving) return;
    setSaving(true);
    setErrorMessage("");

    const currentElapsed = task.temporizador_inicio ? elapsedCurrentSession(task) : 0;
    const totalSeconds = task.tiempo_acumulado_segundos + currentElapsed;
    const { error: insertError } = await supabase
      .from("lista_pendientes_completadas")
      .insert({
        accion: action,
        fecha_creacion: task.fecha_creacion,
        fecha_fin: task.fecha_fin,
        fecha_finalizacion: new Date().toISOString(),
        fecha_inicio: task.fecha_inicio,
        original_task_id: task.id,
        prioridad: task.prioridad,
        responsable: task.responsable,
        tiempo_total_segundos: totalSeconds,
        titulo: task.titulo,
        usuario_accion_id: user.id,
        usuario_accion_nombre: displayName,
        workspace_id: workspaceId
      });

    if (insertError) {
      setErrorMessage(`No se pudo archivar la tarea: ${getErrorMessage(insertError)}`);
      setSaving(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("lista_pendientes")
      .delete()
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
    if (deleteError) {
      setErrorMessage(`La tarea se archivó, pero no se retiró del tablero: ${getErrorMessage(deleteError)}`);
    }
    setSaving(false);
    loadPendingData();
  }

  async function restoreCompletedTask(task: CompletedPendingTask) {
    if (!user || saving) return;
    setSaving(true);
    const nextOrder = tasks.reduce((max, item) => Math.max(max, item.orden), -1) + 1;
    const { error: insertError } = await supabase.from("lista_pendientes").insert({
      created_by: user.id,
      estado: "pendiente",
      fecha_creacion: task.fecha_creacion,
      fecha_fin: task.fecha_fin,
      fecha_inicio: task.fecha_inicio,
      orden: nextOrder,
      prioridad: task.prioridad,
      responsable: task.responsable,
      tiempo_acumulado_segundos: task.tiempo_total_segundos,
      temporizador_duracion_segundos: Math.max(
        task.tiempo_total_segundos,
        durationFromIsoDates(task.fecha_inicio, task.fecha_fin)
      ),
      titulo: task.titulo,
      workspace_id: workspaceId
    });

    if (insertError) {
      setErrorMessage(`No se pudo restaurar la tarea: ${getErrorMessage(insertError)}`);
      setSaving(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("lista_pendientes_completadas")
      .delete()
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
    if (deleteError) {
      setErrorMessage(`La tarea regresó al tablero, pero continúa en el historial: ${getErrorMessage(deleteError)}`);
    }
    setSaving(false);
    loadPendingData();
  }

  async function reorderTask(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const current = [...tasks];
    const sourceIndex = current.findIndex((task) => task.id === sourceId);
    const targetIndex = current.findIndex((task) => task.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = current.splice(sourceIndex, 1);
    current.splice(targetIndex, 0, moved);
    const reordered = current.map((task, index) => ({ ...task, orden: index }));
    setTasks(reordered);
    const results = await Promise.all(
      reordered.map((task) =>
        supabase
          .from("lista_pendientes")
          .update({ orden: task.orden, updated_at: new Date().toISOString() })
          .eq("id", task.id)
          .eq("workspace_id", workspaceId)
      )
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setErrorMessage(`No se pudo guardar el nuevo orden: ${getErrorMessage(failed.error)}`);
      loadPendingData();
    }
  }

  if (!workspaceId) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-950">Panel de Pendientes</h2>
        <p className="mt-2 text-sm text-slate-500">Selecciona o crea un workspace.</p>
      </section>
    );
  }

  const completedCount = completedByOwner.filter(
    (task) => task.accion === "completada"
  ).length;

  return (
    <section className="space-y-4 text-slate-950">
      <header className="rounded-xl border border-slate-200 bg-white px-6 py-7 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
              <span className="grid h-5 w-5 place-items-center rounded-full border border-blue-500 font-bold">$</span>
              Operaciones
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Panel de Pendientes</h2>
            <p className="mt-2 text-sm text-slate-600 sm:text-base">
              Seguimiento colaborativo editable por responsable, fecha de inicio, fecha fin y tiempo dedicado.
            </p>
          </div>
          <label className="flex min-w-60 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold">
            <CalendarIcon />
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="min-w-0 flex-1 bg-transparent outline-none"
              aria-label="Mes del panel"
            />
          </label>
        </div>
      </header>

      <div className="grid gap-3 xl:grid-cols-[repeat(2,minmax(0,1.1fr))_repeat(4,minmax(0,1fr))]">
        {connectedStatus.map(({ name, presence }) => (
          <PresenceCard
            key={name}
            name={name}
            connected={Boolean(presence)}
            workedSeconds={workedSecondsForUser(tasks, name)}
          />
        ))}
        <MetricCard label="Pendientes abiertos" value={visibleTasks.length} detail="Tareas visibles todavía activas" />
        <MetricCard label="Vencidos" value={overdueCount} detail="Pendientes con fecha límite pasada" />
        <MetricCard label="Completados" value={completedCount} detail="Historial filtrado de tareas cerradas" />
        <MetricCard
          label="Bloqueados"
          value={tasks.filter((task) => task.estado === "bloqueado").length}
          detail="Requieren destrabe operativo"
        />
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <form
        onSubmit={handleCreateTask}
        className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(190px,1.15fr)_minmax(190px,1.15fr)_minmax(110px,.7fr)_auto]"
      >
        <FormField label="Pendiente">
          <input
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            placeholder="Nueva tarea pendiente"
          />
        </FormField>
        <FormField label="Responsable">
          <select value={newTaskOwner} onChange={(event) => setNewTaskOwner(event.target.value)}>
            {responsibleNames.map((name) => <option key={name}>{name}</option>)}
          </select>
        </FormField>
        <FormField label="Inicio">
          <input
            type="datetime-local"
            value={newTaskStartDate}
            onChange={(event) => setNewTaskStartDate(event.target.value)}
          />
        </FormField>
        <FormField label="Fin">
          <input
            type="datetime-local"
            value={newTaskDueDate}
            onChange={(event) => setNewTaskDueDate(event.target.value)}
          />
        </FormField>
        <FormField label="Prioridad">
          <select
            value={newTaskPriority}
            onChange={(event) => setNewTaskPriority(event.target.value as PendingPriority)}
          >
            {PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>{priorityLabel(priority)}</option>
            ))}
          </select>
        </FormField>
        <button
          type="submit"
          disabled={saving}
          className="h-10 self-end rounded-lg bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
        >
          Agregar
        </button>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="text-lg font-extrabold">Tablero de pendientes</h3>
            <p className="text-sm text-slate-500">{visibleTasks.length} tareas visibles</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FilterControl label="Responsable">
              <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option>Todos</option>
                {responsibleNames.map((name) => <option key={name}>{name}</option>)}
              </select>
            </FilterControl>
            <FilterControl label="Estado">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option>Todos</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </FilterControl>
            <FilterControl label="Prioridad">
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
              >
                <option>Todas</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>{priorityLabel(priority)}</option>
                ))}
              </select>
            </FilterControl>
          </div>
        </div>

        <div>
          {taskGroups.map((group) => (
            <div key={group.owner}>
              <h4 className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-600">
                Pendientes de {group.owner}
              </h4>
              {group.tasks.map((task) => {
                const lockedByOther = Boolean(
                  task.temporizador_inicio &&
                    task.temporizador_usuario_id &&
                    task.temporizador_usuario_id !== user?.id
                );
                const ownedTimer = Boolean(
                  task.temporizador_inicio && task.temporizador_usuario_id === user?.id
                );
                return (
                  <article
                    key={task.id}
                    draggable={!lockedByOther}
                    onDragStart={() => {
                      draggedTaskIdRef.current = task.id;
                      updatePresence(task);
                    }}
                    onDragEnd={() => {
                      draggedTaskIdRef.current = null;
                      updatePresence(null);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      const sourceId = draggedTaskIdRef.current;
                      if (sourceId) void reorderTask(sourceId, task.id);
                    }}
                    className={`relative grid gap-3 border-b border-slate-200 px-4 py-4 last:border-b-0 lg:grid-cols-[34px_minmax(0,1fr)_minmax(590px,auto)] lg:items-center ${
                      ownedTimer ? "bg-rose-50/40 shadow-[inset_3px_0_0_#e11d48]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400"
                      aria-label="Mover tarea"
                      disabled={lockedByOther}
                    >
                      <GripIcon />
                    </button>

                    <div className="min-w-0">
                      {editingTaskId === task.id ? (
                        <input
                          autoFocus
                          value={task.titulo}
                          onChange={(event) => updateTaskLocal(task.id, { titulo: event.target.value })}
                          onBlur={() => {
                            setEditingTaskId(null);
                            updatePresence(null);
                            void saveTaskPatch(task.id, { titulo: task.titulo });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                          className="w-full rounded-md border border-blue-300 px-2 py-1 text-base font-extrabold outline-none ring-2 ring-blue-100"
                        />
                      ) : (
                        <button
                          type="button"
                          onDoubleClick={() => {
                            if (lockedByOther) return;
                            setEditingTaskId(task.id);
                            updatePresence(task);
                          }}
                          className="group flex max-w-full items-start gap-1 text-left text-base font-extrabold leading-snug xl:text-lg"
                          title="Doble clic para editar"
                        >
                          <span>{task.titulo}</span>
                          <PencilIcon />
                        </button>
                      )}

                    </div>

                    <div className="grid min-w-0 gap-2">
                      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                        <CompactSelect
                          value={task.estado}
                          disabled={lockedByOther}
                          className={statusClass(task.estado)}
                          onChange={(value) =>
                            scheduleTaskSave(task.id, { estado: value as PendingStatus })
                          }
                          options={STATUS_OPTIONS.map((status) => ({
                            label: statusLabel(status),
                            value: status
                          }))}
                        />
                        <CompactSelect
                          value={task.prioridad}
                          disabled={lockedByOther}
                          className={priorityClass(task.prioridad)}
                          onChange={(value) =>
                            scheduleTaskSave(task.id, { prioridad: value as PendingPriority })
                          }
                          options={PRIORITY_OPTIONS.map((priority) => ({
                            label: priorityLabel(priority),
                            value: priority
                          }))}
                        />
                        <select
                          value={task.responsable ?? ""}
                          disabled={lockedByOther}
                          onFocus={() => updatePresence(task)}
                          onBlur={() => updatePresence(null)}
                          onChange={(event) =>
                            scheduleTaskSave(task.id, { responsable: event.target.value || null })
                          }
                          className="max-w-36 bg-transparent text-xs text-slate-500 outline-none"
                        >
                          {responsibleNames.map((name) => <option key={name}>{name}</option>)}
                        </select>
                        <PencilIcon />
                      </div>

                      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                        <label className="flex items-center gap-1 text-xs text-slate-500">
                          Inicio
                          <input
                            type="datetime-local"
                            value={toDateTimeLocalValue(task.fecha_inicio)}
                            disabled={lockedByOther}
                            onFocus={() => updatePresence(task)}
                            onBlur={() => updatePresence(null)}
                            onChange={(event) =>
                              scheduleTaskSave(task.id, {
                                fecha_inicio: toDatabaseDateTime(event.target.value)
                              })
                            }
                            className="h-8 w-36 rounded-md border border-slate-200 px-2 text-[11px] text-slate-950 outline-none focus:border-blue-400"
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-slate-500">
                          Fin
                          <input
                            type="datetime-local"
                            value={toDateTimeLocalValue(task.fecha_fin)}
                            disabled={lockedByOther}
                            onFocus={() => updatePresence(task)}
                            onBlur={() => updatePresence(null)}
                            onChange={(event) =>
                              scheduleTaskSave(task.id, {
                                fecha_fin: toDatabaseDateTime(event.target.value)
                              })
                            }
                            className="h-8 w-36 rounded-md border border-slate-200 px-2 text-[11px] text-slate-950 outline-none focus:border-blue-400"
                          />
                        </label>
                        <div className={`inline-grid h-8 grid-cols-[auto_auto] overflow-hidden rounded-lg border bg-white ${
                        task.temporizador_inicio ? "border-rose-500" : "border-slate-200"
                      }`}>
                        <span className={`grid min-w-20 place-items-center px-2 text-xs font-extrabold tabular-nums ${
                          task.temporizador_inicio ? "bg-rose-600 text-white" : ""
                        }`}>
                          {formatTimer(remainingSeconds(task))}
                        </span>
                        <button
                          type="button"
                          disabled={lockedByOther}
                          onClick={() => void toggleTimer(task)}
                          className="border-l border-slate-200 px-2 text-xs font-semibold disabled:text-slate-300"
                        >
                          {ownedTimer ? "Pausar" : remainingSeconds(task) > 0 ? "Iniciar" : "Reiniciar"}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={lockedByOther || saving}
                        onClick={() => void moveTaskToCompleted(task, "completada")}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold hover:bg-slate-50 disabled:text-slate-300"
                      >
                        Terminar
                      </button>
                      <button
                        type="button"
                        disabled={lockedByOther || saving}
                        onClick={() => {
                          if (window.confirm("¿Mover este pendiente al historial como eliminado?")) {
                            void moveTaskToCompleted(task, "eliminada");
                          }
                        }}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold hover:bg-slate-50 disabled:text-slate-300"
                      >
                        Borrar
                      </button>
                      </div>
                    </div>

                    {lockedByOther ? (
                      <div className="absolute inset-0 z-10 flex items-center justify-end gap-4 bg-slate-100/75 px-6 backdrop-blur-[1px]">
                        <div className="rounded-lg border border-slate-200 bg-white/90 px-4 py-2 text-right shadow-sm">
                          <p className="text-sm font-bold">
                            {task.temporizador_usuario_nombre || "Otro usuario"} está trabajando esta tarea
                          </p>
                          <p className="text-xs text-slate-500">Quedará disponible cuando pause el temporizador.</p>
                        </div>
                        <strong className="rounded-lg bg-rose-600 px-4 py-3 text-sm tabular-nums text-white">
                          {formatTimer(remainingSeconds(task))}
                        </strong>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ))}

          {!visibleTasks.length && !loading ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Sin pendientes visibles.
            </div>
          ) : null}
          {loading ? (
            <div className="px-6 py-8 text-center text-sm font-semibold text-slate-500">
              Sincronizando...
            </div>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-extrabold">Historial de tareas</h3>
            <p className="text-sm text-slate-500">
              {visibleCompletedTasks.length} tareas visibles · {completedTasks.length} en historial total
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["completadas", "eliminadas", "todas"] as CompletedHistoryView[]).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setCompletedHistoryView(view)}
                className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                  completedHistoryView === view
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200"
                }`}
              >
                {historyViewLabel(view)}
              </button>
            ))}
            <button
              type="button"
              disabled={!completedTasks.length}
              onClick={() => downloadCompletedTasksCsv(completedTasks)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:bg-blue-300"
            >
              Descargar tabla
            </button>
          </div>
        </div>
        <div>
          {visibleCompletedTasks.map((task) => (
            <article
              key={task.id}
              className="grid gap-3 border-b border-slate-200 px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_repeat(3,max-content)_auto] lg:items-center"
            >
              <div>
                <h4 className="font-bold">{task.titulo}</h4>
                <p className="mt-1 text-xs text-slate-500">
                  {task.responsable || "Sin asignar"} · {task.accion === "eliminada" ? "Eliminada" : "Completada"} por {task.usuario_accion_nombre}
                </p>
              </div>
              <span className="text-xs text-slate-500">Creación: {formatLocalDate(task.fecha_creacion)}</span>
              <span className="text-xs text-slate-500">Finalización: {formatLocalDate(task.fecha_finalizacion)}</span>
              <span className="text-xs text-slate-500">Tiempo: {formatTimer(task.tiempo_total_segundos)}</span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void restoreCompletedTask(task)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"
              >
                Regresar
              </button>
            </article>
          ))}
          {!visibleCompletedTasks.length ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Aún no hay tareas para este filtro.
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1 text-[10px] font-semibold uppercase text-slate-500 [&_input]:h-10 [&_input]:min-w-0 [&_input]:rounded-lg [&_input]:border [&_input]:border-slate-200 [&_input]:px-3 [&_input]:text-xs [&_input]:font-medium [&_input]:normal-case [&_input]:text-slate-950 [&_input]:outline-none [&_select]:h-10 [&_select]:min-w-0 [&_select]:rounded-lg [&_select]:border [&_select]:border-slate-200 [&_select]:px-3 [&_select]:text-xs [&_select]:font-medium [&_select]:normal-case [&_select]:text-slate-950 [&_select]:outline-none">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FilterControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-56 items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-500 [&_select]:min-w-0 [&_select]:flex-1 [&_select]:bg-transparent [&_select]:font-semibold [&_select]:text-slate-950 [&_select]:outline-none">
      {label}
      {children}
    </label>
  );
}

function PresenceCard({
  name,
  connected,
  workedSeconds
}: {
  name: string;
  connected: boolean;
  workedSeconds: number;
}) {
  return (
    <article className={`rounded-xl border px-4 py-3 shadow-sm ${
      connected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
    }`}>
      <div className="flex items-center gap-2 text-sm font-extrabold">
        <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-300"}`} />
        {name}
      </div>
      <p className="mt-1 text-xs text-slate-500">{connected ? "Conectado" : "Sin conexión activa"}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase text-slate-500">
        Hoy <strong className="text-sm text-slate-950">{formatWorkedMinutes(workedSeconds)}</strong> trabajados
      </p>
    </article>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="flex min-h-20 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase text-slate-500">{label}</p>
        <p className="truncate text-[10px] text-slate-400">{detail}</p>
      </div>
      <strong className="text-2xl">{value}</strong>
    </article>
  );
}

function CompactSelect({
  value,
  options,
  onChange,
  disabled,
  className
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled: boolean;
  className: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`rounded-md border px-2 py-1 text-[11px] font-semibold outline-none ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {[3, 8, 13].flatMap((y) => [
        <circle key={`left-${y}`} cx="5" cy={y} r="1.4" />,
        <circle key={`right-${y}`} cx="11" cy={y} r="1.4" />
      ])}
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="mt-1 h-3.5 w-3.5 shrink-0 text-blue-400 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M14.7 2.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7.3 15.7l-4.1 1.1 1.1-4.1L14.7 2.3Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-5 w-5 text-slate-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="13" rx="2" />
      <path d="M6 2v4M14 2v4M2.5 8h15" />
    </svg>
  );
}

function normalizeTask(raw: Record<string, unknown>): PendingTask {
  return {
    ...(raw as unknown as PendingTask),
    estado: (raw.estado as PendingStatus) || "pendiente",
    orden: Number(raw.orden || 0),
    prioridad: (raw.prioridad as PendingPriority) || "media",
    tiempo_acumulado_segundos: Number(raw.tiempo_acumulado_segundos || 0),
    temporizador_duracion_segundos: Number(raw.temporizador_duracion_segundos || 0),
    temporizador_inicio: typeof raw.temporizador_inicio === "string" ? raw.temporizador_inicio : null,
    temporizador_usuario_id: typeof raw.temporizador_usuario_id === "string" ? raw.temporizador_usuario_id : null,
    temporizador_usuario_nombre: typeof raw.temporizador_usuario_nombre === "string" ? raw.temporizador_usuario_nombre : null
  };
}

function normalizeCompletedTask(raw: Record<string, unknown>): CompletedPendingTask {
  return {
    ...(raw as unknown as CompletedPendingTask),
    fecha_fin: typeof raw.fecha_fin === "string" ? raw.fecha_fin : null,
    fecha_inicio: typeof raw.fecha_inicio === "string" ? raw.fecha_inicio : null,
    prioridad: (raw.prioridad as PendingPriority) || "media",
    tiempo_total_segundos: Number(raw.tiempo_total_segundos || 0)
  };
}

function elapsedCurrentSession(task: PendingTask) {
  if (!task.temporizador_inicio) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(task.temporizador_inicio).getTime()) / 1000));
}

function elapsedSeconds(task: PendingTask) {
  return task.tiempo_acumulado_segundos + elapsedCurrentSession(task);
}

function remainingSeconds(task: PendingTask) {
  return Math.max(0, task.temporizador_duracion_segundos - elapsedSeconds(task));
}

function scheduledDuration(task: PendingTask) {
  return durationFromIsoDates(task.fecha_inicio, task.fecha_fin) || 3600;
}

function durationFromDates(start: string, end: string) {
  if (!start || !end) return 0;
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}

function durationFromIsoDates(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}

function workedSecondsForUser(tasks: PendingTask[], name: string) {
  return tasks.reduce((sum, task) => {
    if (normalizeText(task.temporizador_usuario_nombre || "") !== normalizeText(name)) return sum;
    return sum + elapsedCurrentSession(task);
  }, 0);
}

function formatWorkedMinutes(seconds: number) {
  return `${Math.floor(seconds / 60)} min`;
}

function formatTimer(seconds: number) {
  const normalized = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const remaining = normalized % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
}

function statusLabel(status: PendingStatus) {
  if (status === "en_proceso") return "En proceso";
  if (status === "bloqueado") return "Bloqueado";
  return "Pendiente";
}

function priorityLabel(priority: PendingPriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function statusClass(status: PendingStatus) {
  if (status === "en_proceso") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "bloqueado") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function priorityClass(priority: PendingPriority) {
  if (priority === "alta") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "baja") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function historyViewLabel(view: CompletedHistoryView) {
  if (view === "eliminadas") return "Eliminadas";
  if (view === "todas") return "Todas";
  return "Completadas";
}

function downloadCompletedTasksCsv(tasks: CompletedPendingTask[]) {
  const headers = ["Pendiente", "Responsable", "Creación", "Finalización", "Usuario", "Acción", "Tiempo", "Inicio", "Fin", "Prioridad"];
  const rows = tasks.map((task) => [
    task.titulo,
    task.responsable || "Sin asignar",
    formatLocalDate(task.fecha_creacion),
    formatLocalDate(task.fecha_finalizacion),
    task.usuario_accion_nombre,
    task.accion,
    formatTimer(task.tiempo_total_segundos),
    task.fecha_inicio || "",
    task.fecha_fin || "",
    priorityLabel(task.prioridad)
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tareas-completadas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildPresencePayload(
  user: User,
  displayName: string,
  task: PendingTask | null
): PendingPresenceUser {
  return {
    editingTaskId: task?.id ?? null,
    editingTaskTitle: task?.titulo ?? null,
    email: user.email,
    name: displayName,
    onlineAt: new Date().toISOString(),
    userId: user.id
  };
}

function readPresenceUsers(channel: RealtimeChannel) {
  const state = channel.presenceState() as Record<string, PendingPresenceUser[]>;
  const byUser = new Map<string, PendingPresenceUser>();
  Object.values(state).flat().forEach((presenceUser) => byUser.set(presenceUser.userId, presenceUser));
  return Array.from(byUser.values());
}

function getUserDisplayName(user: User | null) {
  const metadata = user?.user_metadata ?? {};
  const rawName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : user?.email?.split("@")[0];
  const normalized = normalizeText(rawName ?? "Usuario");
  if (normalized.includes("jorge")) return "Jorge Luis";
  if (normalized.includes("diego")) return "Diego";
  return rawName ?? "Usuario";
}

function matchesKnownUser(presenceUser: PendingPresenceUser, knownName: string) {
  const firstName = normalizeText(knownName).split(" ")[0];
  return normalizeText(presenceUser.name).includes(firstName) ||
    normalizeText(presenceUser.email ?? "").includes(firstName);
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function toDatabaseDateTime(value: string) {
  if (!value) return null;
  return value.length === 10 ? `${value}T00:00:00-05:00` : `${value}:00-05:00`;
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Lima",
    year: "numeric"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Lima"
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ListaPendientesModule } from "@/modules/lista-pendientes/components/lista-pendientes-module";
import type { PendingResponsibleOption } from "@/modules/lista-pendientes/types";
import type { User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Workspace = {
  id: string;
  nombre: string;
  owner_id: string;
};

type MemberRole = "owner" | "admin" | "editor" | "viewer";

type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  email: string;
  rol: MemberRole;
  estado: "activo" | "pendiente";
  orden: number | null;
  invitado_por: string | null;
  invitado_en: string;
};

type WorkspaceMembershipRow = {
  workspace_id: string | null;
};

const MANAGER_ROLES: MemberRole[] = ["owner", "admin"];
const DEFAULT_WORKSPACE_NAME = "Mi Workspace";

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function getMemberDisplayName(email?: string | null) {
  const normalized = normalizeEmail(email);
  return normalized.split("@")[0] || "Usuario";
}

function getMemberOrder(member: Pick<WorkspaceMember, "email" | "orden">) {
  return member.orden ?? 99;
}

function translateAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("email rate limit exceeded") || lower.includes("rate limit")) {
    return "Por seguridad, espera unos minutos antes de volver a intentarlo.";
  }
  if (lower.includes("invalid login credentials")) {
    return "El correo o la contrasena no son correctos.";
  }
  if (lower.includes("user already registered")) {
    return "Este correo ya esta registrado. Prueba iniciar sesion.";
  }
  if (lower.includes("password should be at least")) {
    return "La contrasena debe tener al menos 6 caracteres.";
  }
  if (lower.includes("email not confirmed")) {
    return "Tu correo aun no ha sido confirmado.";
  }
  return "Ocurrio un error. Intenta de nuevo.";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

function formatDate(dateString?: string | null): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Pendiente";
  return date.toLocaleDateString("es-PE");
}

function getInitialWorkspaceName(email?: string | null) {
  const normalized = normalizeEmail(email);
  if (!normalized) return DEFAULT_WORKSPACE_NAME;

  try {
    const storedName = window.localStorage.getItem(`lr-pendientes-workspace:${normalized}`);
    return storedName?.trim() || DEFAULT_WORKSPACE_NAME;
  } catch {
    return DEFAULT_WORKSPACE_NAME;
  }
}

function storeInitialWorkspaceName(email: string, workspaceName: string) {
  const normalized = normalizeEmail(email);
  const trimmedName = workspaceName.trim();
  if (!normalized || !trimmedName) return;

  try {
    window.localStorage.setItem(`lr-pendientes-workspace:${normalized}`, trimmedName);
  } catch {
    // El workspace tambien viaja en metadata; localStorage solo ayuda al primer login.
  }
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [registerWorkspaceName, setRegisterWorkspaceName] = useState(DEFAULT_WORKSPACE_NAME);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceActivo, setWorkspaceActivo] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteForm, setInviteForm] = useState({ email: "", rol: "viewer" as MemberRole });
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [view, setView] = useState<"pendientes" | "usuarios">("pendientes");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentMembership = useMemo(
    () => members.find((member) => member.user_id === user?.id && member.workspace_id === workspaceActivo),
    [members, user?.id, workspaceActivo]
  );

  const canManageMembers = Boolean(currentMembership && MANAGER_ROLES.includes(currentMembership.rol));

  const responsablesPendientes = useMemo<PendingResponsibleOption[]>(
    () =>
      members
        .filter((member) => member.workspace_id === workspaceActivo && member.estado === "activo" && member.email)
        .map((member) => ({
          email: member.email,
          nombre: getMemberDisplayName(member.email),
          orden: getMemberOrder(member)
        }))
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)),
    [members, workspaceActivo]
  );

  useEffect(() => {
    const initAuth = async () => {
      try {
        setSessionLoading(true);
        if (!isSupabaseConfigured) {
          setUser(null);
          return;
        }
        const { data } = await supabase.auth.getUser();
        setUser(data?.user ?? null);
      } finally {
        setSessionLoading(false);
      }
    };

    initAuth();
    if (!isSupabaseConfigured) return;

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      authListener.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setWorkspaceActivo("");
      setMembers([]);
      return;
    }

    loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user || !workspaceActivo) return;
    loadMembers(workspaceActivo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, workspaceActivo]);

  async function acceptPendingInvitations() {
    if (!user?.email) return;

    const { error } = await supabase
      .from("workspace_members")
      .update({ user_id: user.id, estado: "activo" })
      .eq("email", user.email)
      .eq("estado", "pendiente")
      .is("user_id", null);

    if (error) console.warn("No se pudieron activar invitaciones pendientes:", error);
  }

  async function loadWorkspaces() {
    if (!user) return;

    setWorkspaceLoading(true);
    try {
      await acceptPendingInvitations();

      const { data: memberships, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .eq("estado", "activo");

      if (membershipError) throw membershipError;

      const workspaceIds = (memberships || [])
        .map((row: WorkspaceMembershipRow) => row.workspace_id)
        .filter(Boolean) as string[];

      let workspaceData: Workspace[] = [];
      if (workspaceIds.length) {
        const { data, error } = await supabase
          .from("workspaces")
          .select("id, nombre, owner_id")
          .in("id", workspaceIds)
          .order("nombre", { ascending: true });

        if (error) throw error;
        workspaceData = data || [];
      }

      if (!workspaceData.length) {
        workspaceData = [await createWorkspace(getInitialWorkspaceName(user.email))];
      }

      setWorkspaces(workspaceData);
      setWorkspaceActivo((current) => current || workspaceData[0]?.id || "");
    } catch (error) {
      alert(`No se pudieron cargar los workspaces: ${getErrorMessage(error)}`);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function createWorkspace(nombre: string) {
    if (!user) throw new Error("Sesion no disponible");

    const { data: workspace, error: workspaceError } = await supabase
      .rpc("create_workspace_with_owner", { workspace_name: nombre })
      .single();

    if (workspaceError || !workspace) throw workspaceError || new Error("No se pudo crear el workspace");
    return workspace as Workspace;
  }

  async function loadMembers(targetWorkspaceId = workspaceActivo) {
    if (!targetWorkspaceId) return;

    const { data, error } = await supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", targetWorkspaceId)
      .order("orden", { ascending: true, nullsFirst: false })
      .order("email", { ascending: true });

    if (error) {
      console.error("Error loading members:", error);
      return;
    }

    setMembers((data || []) as WorkspaceMember[]);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLoading) return;

    setAuthError("");
    setAuthMessage("");
    setAuthLoading(true);

    try {
      if (!isSupabaseConfigured) {
        setAuthError("Supabase no esta configurado. Agrega NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en GitHub Actions.");
        return;
      }

      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizeEmail(authForm.email),
          password: authForm.password
        });
        if (error) {
          setAuthError(translateAuthError(error.message));
          return;
        }
        setAuthMessage("Inicio de sesion correcto. Cargando...");
      } else {
        const email = normalizeEmail(authForm.email);
        const workspaceName = registerWorkspaceName.trim() || DEFAULT_WORKSPACE_NAME;
        storeInitialWorkspaceName(email, workspaceName);

        const { data, error } = await supabase.auth.signUp({
          email,
          password: authForm.password,
          options: {
            data: {
              workspace_name: workspaceName
            }
          }
        });

        if (error) {
          setAuthError(translateAuthError(error.message));
          return;
        }

        if (data.session) {
          setAuthMessage("Cuenta creada. Preparando tu workspace...");
        } else {
          setAuthMessage("Cuenta creada. Confirma tu correo y vuelve a iniciar sesion para crear tu workspace.");
        }
      }
    } catch (error) {
      setAuthError(translateAuthError(getErrorMessage(error)));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nombre = newWorkspaceName.trim();
    if (!nombre) return;

    try {
      const workspace = await createWorkspace(nombre);
      setWorkspaces((current) => [...current, workspace]);
      setWorkspaceActivo(workspace.id);
      setNewWorkspaceName("");
    } catch (error) {
      alert(`No se pudo crear el workspace: ${getErrorMessage(error)}`);
    }
  }

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceActivo || !user || !canManageMembers) return;

    const email = normalizeEmail(inviteForm.email);
    if (!email) {
      alert("Ingresa un email valido.");
      return;
    }

    const alreadyInvited = members.some((member) => normalizeEmail(member.email) === email);
    if (alreadyInvited) {
      alert("Este email ya pertenece al workspace o tiene una invitacion pendiente.");
      return;
    }

    const { data, error } = await supabase
      .from("workspace_members")
      .insert([
        {
          workspace_id: workspaceActivo,
          email,
          rol: inviteForm.rol,
          estado: "pendiente",
          invitado_por: user.id
        }
      ])
      .select();

    if (error) {
      alert(`No se pudo enviar la invitacion: ${getErrorMessage(error)}`);
      return;
    }

    setMembers((current) => [...current, ...((data || []) as WorkspaceMember[])]);
    setInviteForm({ email: "", rol: "viewer" });
  }

  async function handleUpdateMemberOrder(member: WorkspaceMember, orden: number) {
    if (!workspaceActivo || !canManageMembers) return;
    const nextOrden = Number.isFinite(orden) && orden > 0 ? Math.trunc(orden) : null;

    setMembers((current) => current.map((item) => (item.id === member.id ? { ...item, orden: nextOrden } : item)));

    const { error } = await supabase
      .from("workspace_members")
      .update({ orden: nextOrden })
      .eq("id", member.id)
      .eq("workspace_id", workspaceActivo);

    if (error) {
      alert(`No se pudo actualizar el orden: ${getErrorMessage(error)}`);
      loadMembers();
    }
  }

  async function handleUpdateMemberRole(member: WorkspaceMember, rol: MemberRole) {
    if (!workspaceActivo || !canManageMembers || member.user_id === user?.id) return;

    const { error } = await supabase
      .from("workspace_members")
      .update({ rol })
      .eq("id", member.id)
      .eq("workspace_id", workspaceActivo);

    if (error) {
      alert(`No se pudo actualizar el rol: ${getErrorMessage(error)}`);
      return;
    }

    setMembers((current) => current.map((item) => (item.id === member.id ? { ...item, rol } : item)));
  }

  async function handleDeleteMember(member: WorkspaceMember) {
    if (!workspaceActivo || !canManageMembers || member.user_id === user?.id) return;
    if (!window.confirm("Eliminar este miembro o invitacion? Esta accion no se puede deshacer.")) return;

    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("id", member.id)
      .eq("workspace_id", workspaceActivo);

    if (error) {
      alert(`No se pudo eliminar el miembro: ${getErrorMessage(error)}`);
      return;
    }

    setMembers((current) => current.filter((item) => item.id !== member.id));
  }

  if (sessionLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-600">Cargando...</main>;
  }

  if (!user) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-gray-950 text-gray-950">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url("login-background.png")' }}
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-black/10" />
        <section className="relative flex min-h-screen items-center px-4 py-8 sm:px-8 lg:px-16">
          <form
            onSubmit={handleAuthSubmit}
            className="w-full max-w-md rounded-lg border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-sm sm:p-8"
          >
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">LR Pendientes</p>
            <h1 className="mt-3 text-3xl font-bold">Ingresa a tu workspace</h1>
            <p className="mt-3 text-sm font-semibold leading-6 text-gray-600">
              Crea tu cuenta, abre tu workspace y agrega tus propios usuarios con roles.
            </p>
            {!isSupabaseConfigured ? (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                Falta conectar Supabase en GitHub Pages. Configura los secrets para activar el registro.
              </p>
            ) : null}
            <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                  setAuthMessage("");
                }}
                className={`rounded-md px-3 py-2 text-sm font-bold ${authMode === "login" ? "bg-white text-red-700 shadow-sm" : "text-gray-600"}`}
              >
                Iniciar sesion
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                  setAuthMessage("");
                }}
                className={`rounded-md px-3 py-2 text-sm font-bold ${authMode === "register" ? "bg-white text-red-700 shadow-sm" : "text-gray-600"}`}
              >
                Crear cuenta
              </button>
            </div>
            <input
              required
              type="email"
              placeholder="Email"
              value={authForm.email}
              onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
            {authMode === "register" ? (
              <input
                required
                type="text"
                placeholder="Nombre de tu workspace"
                value={registerWorkspaceName}
                onChange={(event) => setRegisterWorkspaceName(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
              />
            ) : null}
            <input
              required
              minLength={6}
              type="password"
              placeholder="Contrasena"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
            />
            {authError ? <p className="text-sm font-semibold text-red-700">{authError}</p> : null}
            {!authError && authMessage ? <p className="text-sm font-semibold text-green-700">{authMessage}</p> : null}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-lg bg-red-700 px-5 py-3 font-bold text-white transition hover:bg-red-800 disabled:bg-red-400"
            >
              {authLoading ? "Procesando..." : authMode === "login" ? "Entrar" : "Crear cuenta"}
            </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <aside
        className={`fixed inset-y-0 left-0 z-40 border-r border-slate-200 bg-white transition-[width] duration-200 ${
          sidebarOpen ? "w-72 shadow-xl" : "w-16"
        }`}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen((current) => !current)}
          className="absolute -right-5 top-5 grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-xl text-slate-600 shadow-sm"
          aria-label={sidebarOpen ? "Cerrar menú" : "Abrir menú"}
        >
          {sidebarOpen ? "‹" : "›"}
        </button>

        <div className="flex h-full flex-col overflow-hidden px-2 pb-4 pt-20">
          <nav className="grid gap-3">
            <button
              type="button"
              onClick={() => setView("pendientes")}
              className={`flex h-14 items-center rounded-lg border text-sm font-bold ${
                sidebarOpen ? "gap-3 px-4" : "justify-center"
              } ${
                view === "pendientes"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
              title="Pendientes"
            >
              <span className="text-base">P</span>
              {sidebarOpen ? <span>Pendientes</span> : null}
            </button>
            <button
              type="button"
              onClick={() => setView("usuarios")}
              className={`flex h-14 items-center rounded-lg border text-sm font-bold ${
                sidebarOpen ? "gap-3 px-4" : "justify-center"
              } ${
                view === "usuarios"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
              title="Usuarios"
            >
              <span className="text-base">U</span>
              {sidebarOpen ? <span>Usuarios</span> : null}
            </button>
          </nav>

          {sidebarOpen ? (
            <div className="mt-6 grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">Conectado como</p>
                <p className="mt-1 break-all text-sm font-bold">{user.email}</p>
              </section>

              <label className="grid gap-2 text-xs font-bold text-slate-600">
                Workspace
                <select
                  value={workspaceActivo}
                  onChange={(event) => setWorkspaceActivo(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.nombre}</option>
                  ))}
                </select>
              </label>

              <form onSubmit={handleCreateWorkspace} className="grid gap-2">
                <input
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  placeholder="Nuevo workspace"
                  className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none"
                />
                <button type="submit" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">
                  Crear workspace
                </button>
              </form>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            className={`mt-auto flex h-11 items-center rounded-lg border border-slate-200 text-sm font-bold text-slate-600 ${
              sidebarOpen ? "justify-center px-4" : "justify-center"
            }`}
            title="Salir"
          >
            {sidebarOpen ? "Salir" : "S"}
          </button>
        </div>
      </aside>

      <div className={`min-w-0 px-4 py-5 transition-[margin] duration-200 sm:px-6 lg:px-8 ${
        sidebarOpen ? "ml-72" : "ml-16"
      }`}>
        <div className="mx-auto max-w-[1500px]">
          {workspaceLoading ? (
            <section className="rounded-lg border border-gray-200 bg-white p-6 text-sm font-semibold text-gray-500 shadow-sm">Cargando workspace...</section>
          ) : null}

          {view === "pendientes" ? (
            <ListaPendientesModule user={user} workspaceId={workspaceActivo} responsables={responsablesPendientes} />
          ) : (
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-700">Usuarios</p>
                  <h2 className="mt-2 text-2xl font-bold">Miembros del workspace</h2>
                </div>
                <p className="text-sm font-semibold text-gray-500">{members.length} usuarios</p>
              </div>

              {canManageMembers ? (
                <form onSubmit={handleInviteMember} className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <input
                    required
                    type="email"
                    placeholder="Email del invitado"
                    value={inviteForm.email}
                    onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
                    className="rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  />
                  <select
                    value={inviteForm.rol}
                    onChange={(event) => setInviteForm({ ...inviteForm, rol: event.target.value as MemberRole })}
                    className="rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button type="submit" className="rounded-lg bg-red-700 px-5 py-3 font-bold text-white hover:bg-red-800">
                    Invitar
                  </button>
                </form>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-700">
                    <tr>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Orden</th>
                      <th className="px-4 py-3">Rol</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Invitado</th>
                      <th className="px-4 py-3">Accion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {members.map((member) => (
                      <tr key={member.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold">{member.email}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={1}
                            disabled={!canManageMembers}
                            value={member.orden ?? ""}
                            onChange={(event) => handleUpdateMemberOrder(member, Number(event.target.value))}
                            className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 disabled:bg-gray-100"
                            aria-label={`Orden de ${member.email}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            disabled={!canManageMembers || member.user_id === user.id}
                            value={member.rol}
                            onChange={(event) => handleUpdateMemberRole(member, event.target.value as MemberRole)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm capitalize outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 disabled:bg-gray-100"
                          >
                            <option value="owner">Owner</option>
                            <option value="admin">Admin</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${member.estado === "activo" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                            {member.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3">{formatDate(member.invitado_en)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            disabled={!canManageMembers || member.user_id === user.id}
                            onClick={() => handleDeleteMember(member)}
                            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:text-red-300"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!members.length ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-gray-500">No hay usuarios en este workspace.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}


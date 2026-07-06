create table if not exists public.lista_pendientes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  titulo text not null,
  responsable text,
  estado text not null default 'pendiente',
  prioridad text not null default 'media',
  orden bigint not null default 0,
  fecha_creacion timestamptz not null default now(),
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  tiempo_acumulado_segundos bigint not null default 0,
  temporizador_duracion_segundos bigint not null default 0,
  temporizador_inicio timestamptz,
  temporizador_usuario_id uuid references auth.users(id) on delete set null,
  temporizador_usuario_nombre text,
  subtareas jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
begin
  alter table public.lista_pendientes
    add column if not exists prioridad text not null default 'media',
    add column if not exists orden bigint not null default 0,
    add column if not exists tiempo_acumulado_segundos bigint not null default 0,
    add column if not exists temporizador_duracion_segundos bigint not null default 0,
    add column if not exists temporizador_inicio timestamptz,
    add column if not exists temporizador_usuario_id uuid references auth.users(id) on delete set null,
    add column if not exists temporizador_usuario_nombre text,
    add column if not exists subtareas jsonb not null default '[]'::jsonb;

  alter table public.lista_pendientes drop constraint if exists lista_pendientes_estado_check;
  alter table public.lista_pendientes
    add constraint lista_pendientes_estado_check
    check (estado in ('pendiente', 'en_proceso', 'bloqueado'));

  alter table public.lista_pendientes drop constraint if exists lista_pendientes_prioridad_check;
  alter table public.lista_pendientes
    add constraint lista_pendientes_prioridad_check
    check (prioridad in ('alta', 'media', 'baja'));

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lista_pendientes'
      and column_name = 'fecha_inicio'
      and data_type = 'date'
  ) then
    alter table public.lista_pendientes
      alter column fecha_inicio type timestamptz
      using fecha_inicio::timestamp at time zone 'America/Lima';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lista_pendientes'
      and column_name = 'fecha_fin'
      and data_type = 'date'
  ) then
    alter table public.lista_pendientes
      alter column fecha_fin type timestamptz
      using fecha_fin::timestamp at time zone 'America/Lima';
  end if;
end $$;

create table if not exists public.lista_pendientes_completadas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  original_task_id uuid,
  titulo text not null,
  responsable text,
  fecha_creacion timestamptz not null,
  fecha_finalizacion timestamptz not null default now(),
  usuario_accion_id uuid references auth.users(id) on delete set null,
  usuario_accion_nombre text not null,
  accion text not null check (accion in ('completada', 'eliminada')),
  prioridad text not null default 'media',
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  tiempo_total_segundos bigint not null default 0,
  subtareas jsonb not null default '[]'::jsonb
);

alter table public.lista_pendientes_completadas
  add column if not exists prioridad text not null default 'media',
  add column if not exists fecha_inicio timestamptz,
  add column if not exists fecha_fin timestamptz,
  add column if not exists tiempo_total_segundos bigint not null default 0,
  add column if not exists subtareas jsonb not null default '[]'::jsonb;

alter table public.lista_pendientes_completadas
  drop constraint if exists lista_pendientes_completadas_prioridad_check;

alter table public.lista_pendientes_completadas
  add constraint lista_pendientes_completadas_prioridad_check
  check (prioridad in ('alta', 'media', 'baja'));

create index if not exists lista_pendientes_workspace_idx
  on public.lista_pendientes(workspace_id, fecha_creacion);

create index if not exists lista_pendientes_completadas_workspace_idx
  on public.lista_pendientes_completadas(workspace_id, fecha_finalizacion desc);

alter table public.lista_pendientes enable row level security;
alter table public.lista_pendientes_completadas enable row level security;

drop policy if exists "workspace members can read pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can insert pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can update pending tasks" on public.lista_pendientes;
drop policy if exists "workspace members can delete pending tasks" on public.lista_pendientes;

create policy "workspace members can read pending tasks"
  on public.lista_pendientes for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can insert pending tasks"
  on public.lista_pendientes for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can update pending tasks"
  on public.lista_pendientes for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can delete pending tasks"
  on public.lista_pendientes for delete
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

drop policy if exists "workspace members can read completed tasks" on public.lista_pendientes_completadas;
drop policy if exists "workspace members can insert completed tasks" on public.lista_pendientes_completadas;
drop policy if exists "workspace members can delete completed tasks" on public.lista_pendientes_completadas;

create policy "workspace members can read completed tasks"
  on public.lista_pendientes_completadas for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes_completadas.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can insert completed tasks"
  on public.lista_pendientes_completadas for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes_completadas.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace members can delete completed tasks"
  on public.lista_pendientes_completadas for delete
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lista_pendientes_completadas.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create or replace function public.complete_pending_task(
  task_id uuid,
  task_action text,
  actor_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_task public.lista_pendientes%rowtype;
  completed_id uuid;
  total_seconds bigint;
begin
  if task_action not in ('completada', 'eliminada') then
    raise exception 'Accion invalida para completar pendiente: %', task_action;
  end if;

  select *
    into pending_task
  from public.lista_pendientes
  where id = task_id
  for update;

  if not found then
    raise exception 'Pendiente no encontrado o no disponible';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = pending_task.workspace_id
      and wm.user_id = auth.uid()
      and wm.estado = 'activo'
  ) then
    raise exception 'No tienes permiso para completar este pendiente';
  end if;

  total_seconds :=
    pending_task.tiempo_acumulado_segundos +
    case
      when pending_task.temporizador_inicio is null then 0
      else greatest(0, floor(extract(epoch from (now() - pending_task.temporizador_inicio)))::bigint)
    end;

  insert into public.lista_pendientes_completadas (
    workspace_id,
    original_task_id,
    titulo,
    responsable,
    fecha_creacion,
    fecha_finalizacion,
    usuario_accion_id,
    usuario_accion_nombre,
    accion,
    prioridad,
    fecha_inicio,
    fecha_fin,
    tiempo_total_segundos,
    subtareas
  )
  values (
    pending_task.workspace_id,
    pending_task.id,
    pending_task.titulo,
    pending_task.responsable,
    pending_task.fecha_creacion,
    now(),
    auth.uid(),
    coalesce(nullif(actor_name, ''), auth.email(), 'Usuario'),
    task_action,
    pending_task.prioridad,
    pending_task.fecha_inicio,
    pending_task.fecha_fin,
    total_seconds,
    pending_task.subtareas
  )
  returning id into completed_id;

  delete from public.lista_pendientes
  where id = pending_task.id;

  return completed_id;
end;
$$;

grant execute on function public.complete_pending_task(uuid, text, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.lista_pendientes;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.lista_pendientes_completadas;
  exception
    when duplicate_object then null;
  end;
end $$;

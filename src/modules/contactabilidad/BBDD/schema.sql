create table if not exists public.contactabilidad_clientes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ruc text not null,
  marca text not null,
  servicios text[] not null default '{}',
  estado_reporte_origen text,
  fila_origen integer,
  activo boolean not null default true,
  sincronizado_en timestamptz not null default now(),
  unique (workspace_id, ruc)
);

create table if not exists public.contactabilidad_contactos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cliente_id uuid not null references public.contactabilidad_clientes(id) on delete cascade,
  fecha_contacto date not null,
  canal text not null check (canal in ('WhatsApp', 'Llamada', 'Correo', 'Reunion', 'Otro')),
  notas text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.contactabilidad_semanas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cliente_id uuid not null references public.contactabilidad_clientes(id) on delete cascade,
  semana_inicio date not null,
  reporte_enviado boolean not null default false,
  reunion_agendada boolean not null default false,
  fecha_reunion date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (workspace_id, cliente_id, semana_inicio)
);

create index if not exists contactabilidad_clientes_workspace_idx on public.contactabilidad_clientes(workspace_id, marca);
create index if not exists contactabilidad_contactos_cliente_idx on public.contactabilidad_contactos(cliente_id, fecha_contacto desc);
create index if not exists contactabilidad_semanas_workspace_idx on public.contactabilidad_semanas(workspace_id, semana_inicio);

alter table public.contactabilidad_clientes enable row level security;
alter table public.contactabilidad_contactos enable row level security;
alter table public.contactabilidad_semanas enable row level security;

do $$
declare
  target_table text;
begin
  foreach target_table in array array['contactabilidad_clientes', 'contactabilidad_contactos', 'contactabilidad_semanas'] loop
    execute format('drop policy if exists "workspace members can read %1$s" on public.%1$I', target_table);
    execute format('drop policy if exists "workspace editors can insert %1$s" on public.%1$I', target_table);
    execute format('drop policy if exists "workspace editors can update %1$s" on public.%1$I', target_table);
    execute format('drop policy if exists "workspace editors can delete %1$s" on public.%1$I', target_table);
    execute format('create policy "workspace members can read %1$s" on public.%1$I for select using (public.is_workspace_member(workspace_id))', target_table);
    execute format('create policy "workspace editors can insert %1$s" on public.%1$I for insert with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = %1$I.workspace_id and wm.user_id = auth.uid() and wm.estado = ''activo'' and wm.rol in (''owner'', ''admin'', ''editor'')))', target_table);
    execute format('create policy "workspace editors can update %1$s" on public.%1$I for update using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %1$I.workspace_id and wm.user_id = auth.uid() and wm.estado = ''activo'' and wm.rol in (''owner'', ''admin'', ''editor''))) with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = %1$I.workspace_id and wm.user_id = auth.uid() and wm.estado = ''activo'' and wm.rol in (''owner'', ''admin'', ''editor'')))', target_table);
    execute format('create policy "workspace editors can delete %1$s" on public.%1$I for delete using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %1$I.workspace_id and wm.user_id = auth.uid() and wm.estado = ''activo'' and wm.rol in (''owner'', ''admin'', ''editor'')))', target_table);
  end loop;
end $$;

do $$
begin
  begin alter publication supabase_realtime add table public.contactabilidad_clientes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.contactabilidad_contactos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.contactabilidad_semanas; exception when duplicate_object then null; end;
end $$;

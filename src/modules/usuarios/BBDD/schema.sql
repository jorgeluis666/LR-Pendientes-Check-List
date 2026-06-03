create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  rol text not null default 'viewer' check (rol in ('owner', 'admin', 'editor', 'viewer')),
  estado text not null default 'pendiente' check (estado in ('activo', 'pendiente')),
  orden integer,
  invitado_por uuid references auth.users(id) on delete set null,
  invitado_en timestamptz not null default now(),
  unique (workspace_id, email)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members(user_id, estado);

create index if not exists workspace_members_workspace_order_idx
  on public.workspace_members(workspace_id, orden, email);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "members can read workspaces" on public.workspaces;
drop policy if exists "users can create workspaces" on public.workspaces;
drop policy if exists "owners can update workspaces" on public.workspaces;

create policy "members can read workspaces"
  on public.workspaces for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "users can create workspaces"
  on public.workspaces for insert
  with check (owner_id = auth.uid());

create policy "owners can update workspaces"
  on public.workspaces for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "members can read workspace members" on public.workspace_members;
drop policy if exists "users can accept own invitations" on public.workspace_members;
drop policy if exists "workspace managers can invite members" on public.workspace_members;
drop policy if exists "workspace managers can update members" on public.workspace_members;
drop policy if exists "workspace managers can delete members" on public.workspace_members;

create policy "members can read workspace members"
  on public.workspace_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
    )
  );

create policy "workspace managers can invite members"
  on public.workspace_members for insert
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
        and wm.rol in ('owner', 'admin')
    )
  );

create policy "users can accept own invitations"
  on public.workspace_members for update
  using (lower(email) = lower(auth.email()) and estado = 'pendiente')
  with check (user_id = auth.uid() and estado = 'activo');

create policy "workspace managers can update members"
  on public.workspace_members for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
        and wm.rol in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
        and wm.rol in ('owner', 'admin')
    )
  );

create policy "workspace managers can delete members"
  on public.workspace_members for delete
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.estado = 'activo'
        and wm.rol in ('owner', 'admin')
    )
  );

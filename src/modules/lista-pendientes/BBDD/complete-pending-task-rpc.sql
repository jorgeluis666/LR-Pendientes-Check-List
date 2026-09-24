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

  -- Solo editores: la funcion es security definer (se salta RLS) y antes bastaba ser miembro.
  if not public.is_workspace_editor(pending_task.workspace_id) then
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

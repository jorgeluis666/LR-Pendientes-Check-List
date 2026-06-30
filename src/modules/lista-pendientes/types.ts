export type PendingStatus = "pendiente" | "en_proceso" | "bloqueado";

export type PendingPriority = "alta" | "media" | "baja";

export type CompletedPendingAction = "completada" | "eliminada";

export interface PendingSubtask {
  id: string;
  titulo: string;
  completada: boolean;
}

export interface PendingResponsibleOption {
  email?: string;
  nombre: string;
  orden: number;
}

export interface PendingTask {
  id: string;
  workspace_id: string;
  titulo: string;
  responsable: string | null;
  estado: PendingStatus;
  prioridad: PendingPriority;
  orden: number;
  fecha_creacion: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  tiempo_acumulado_segundos: number;
  temporizador_duracion_segundos: number;
  temporizador_inicio: string | null;
  temporizador_usuario_id: string | null;
  temporizador_usuario_nombre: string | null;
  subtareas: PendingSubtask[];
  created_by: string | null;
  updated_at: string | null;
}

export interface CompletedPendingTask {
  id: string;
  workspace_id: string;
  original_task_id: string | null;
  titulo: string;
  responsable: string | null;
  fecha_creacion: string;
  fecha_finalizacion: string;
  usuario_accion_id: string | null;
  usuario_accion_nombre: string;
  accion: CompletedPendingAction;
  prioridad: PendingPriority;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  tiempo_total_segundos: number;
  subtareas: PendingSubtask[];
}

export interface PendingPresenceUser {
  userId: string;
  name: string;
  email?: string;
  editingTaskId: string | null;
  editingTaskTitle: string | null;
  onlineAt: string;
}

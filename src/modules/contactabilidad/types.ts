export type ContactabilityClient = {
  id: string;
  workspace_id: string;
  ruc: string;
  marca: string;
  servicios: string[];
  estado_reporte_origen: string | null;
  fila_origen: number | null;
  activo: boolean;
  sincronizado_en: string;
};

export type ContactRecord = {
  id: string;
  workspace_id: string;
  cliente_id: string;
  fecha_contacto: string;
  canal: string;
  notas: string | null;
  created_at: string;
};

export type WeeklyFollowUp = {
  id: string;
  workspace_id: string;
  cliente_id: string;
  semana_inicio: string;
  reporte_enviado: boolean;
  reunion_agendada: boolean;
  fecha_reunion: string | null;
  updated_at: string;
};

export type SheetClient = {
  ruc: string;
  marca: string;
  servicios: string[];
  estadoReporte: string | null;
  filaOrigen: number;
};

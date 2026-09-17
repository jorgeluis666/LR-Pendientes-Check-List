import type { SheetClient } from "./types";

export const CONTACTABILITY_SPREADSHEET_ID = "1kWRbaKzvFKWGrPjtL-1okX-Ik_kYrISgoNEfPvMnZII";
export const CONTACTABILITY_SHEET_GID = "0";
export const CONTACTABILITY_SHEET_URL = `https://docs.google.com/spreadsheets/d/${CONTACTABILITY_SPREADSHEET_ID}/edit?gid=${CONTACTABILITY_SHEET_GID}`;

type GoogleCell = { v?: string | number | boolean | null; f?: string } | null;
type GoogleRow = { c?: GoogleCell[] };
type GoogleVisualizationResponse = { table?: { rows?: GoogleRow[] } };

function cellValue(row: GoogleRow, index: number) {
  const cell = row.c?.[index];
  return String(cell?.f ?? cell?.v ?? "").trim();
}

function parseVisualizationResponse(payload: string): GoogleVisualizationResponse {
  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Google Sheets devolvio una respuesta no valida.");
  return JSON.parse(payload.slice(start, end + 1)) as GoogleVisualizationResponse;
}

export async function fetchSheetClients(): Promise<SheetClient[]> {
  const endpoint = `https://docs.google.com/spreadsheets/d/${CONTACTABILITY_SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${CONTACTABILITY_SHEET_GID}&headers=1`;
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo leer el Google Sheet. Verifica que el archivo permita acceso mediante enlace.");
  }

  const data = parseVisualizationResponse(await response.text());
  const rows = data.table?.rows ?? [];
  const clientsByRuc = new Map<string, SheetClient>();

  rows.forEach((row, index) => {
    const marca = cellValue(row, 1);
    const ruc = cellValue(row, 2).replace(/\D/g, "");
    const servicio = cellValue(row, 3);
    const estadoReporte = cellValue(row, 4) || null;
    if (!marca || !ruc) return;

    const current = clientsByRuc.get(ruc);
    if (current) {
      if (servicio && !current.servicios.includes(servicio)) current.servicios.push(servicio);
      if (estadoReporte) current.estadoReporte = estadoReporte;
      return;
    }

    clientsByRuc.set(ruc, {
      ruc,
      marca,
      servicios: servicio ? [servicio] : [],
      estadoReporte,
      filaOrigen: index + 2
    });
  });

  return Array.from(clientsByRuc.values()).sort((a, b) => a.marca.localeCompare(b.marca, "es"));
}

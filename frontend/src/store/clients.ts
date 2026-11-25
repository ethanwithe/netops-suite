/** Datos de clientes por SOT (año/mes según la fecha de los datos). Cualquier ventana puede sumar lo que sabe. */
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useAutosave } from "./autosave";
import { expandDatos } from "./clientLink";
import { localClients } from "../sync/engine";

export interface ClientRecord {
  id: string;
  sot: string;
  nombre: string;
  fecha: string; // yyyy-mm-dd
  cid: string;
  proy: string;
  contrata: string;
  datos: Record<string, string>;
  reportes: { tipo?: string; nombre?: string; filename?: string; url?: string; generado?: string; por?: string }[];
  owner_id?: string;
  owner_name?: string;
  participants?: { id: string; username: string; name: string }[];
  point?: number;
  shared?: boolean;
  mine?: boolean;
  deleted_at?: string;
  updated_at?: string;
}

export interface ClientInput {
  sot: string;
  nombre?: string;
  fecha?: string;
  cid?: string;
  proy?: string;
  contrata?: string;
  datos?: Record<string, string>;
}

export const listYears = () => api.get<{ year: number; total: number }[]>("/clients/years").then((r) => r.data);
export const createYear = (year: number) => api.post("/clients/years", { year });
async function localFiltered(params: { year?: number; q?: string }): Promise<ClientRecord[]> {
  const q = (params.q || "").trim().toLowerCase();
  const rows = (await localClients()) as unknown as ClientRecord[];
  return rows.filter((c) => (!params.year || String(c.fecha || "").startsWith(String(params.year))) && (!q || `${c.sot} ${c.nombre} ${c.cid}`.toLowerCase().includes(q)))
    .map((c) => ({ ...c, datos: c.datos || {}, reportes: c.reportes || [], mine: true }))
    .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
}

/** Mis clientes. Con conexión, los del servidor; si el servidor no responde o no devuelve ninguno, los que hay en este equipo. */
export async function listClients(params: { year?: number; q?: string }): Promise<ClientRecord[]> {
  let server: ClientRecord[] | null = null;
  let failure: unknown;
  try { server = (await api.get<ClientRecord[]>("/clients", { params })).data; } catch (e) { failure = e; }
  if (server && server.length) return server;
  const local = await localFiltered(params).catch(() => [] as ClientRecord[]);
  if (local.length) return local;
  if (server) return server;
  throw failure;
}
export const createClient = (c: ClientInput) => api.post<ClientRecord>("/clients", c).then((r) => r.data);
export const updateClient = (id: string, c: ClientInput) => api.put<ClientRecord>(`/clients/${id}`, c).then((r) => r.data);
export const deleteClient = (id: string) => api.delete(`/clients/${id}`);
export const listTrash = () => api.get<ClientRecord[]>("/clients/trash").then((r) => r.data);
export const restoreClient = (id: string) => api.put(`/clients/${id}/restore`);

export interface SyncInput extends ClientInput {
  reporte?: { tipo?: string; nombre?: string; filename?: string; url?: string };
}
export const syncClient = (c: SyncInput) => api.post<ClientRecord>("/clients/sync", c).then((r) => r.data);

/** Carpeta del cliente (ZIP con PDF de fotos, fotos, CheckList y gráficas); cada vez que se arma es una versión nueva. */
export const packageStatus = (id: string) => api.get<{ version: number; stale: boolean; built: string }>(`/clients/${id}/package-status`).then((r) => r.data);
export const buildPackage = (id: string) =>
  api.post<{ version: number; filename: string; url: string; counts: Record<string, number> }>(`/clients/${id}/package`, {}, { timeout: 180000 }).then((r) => r.data);
/** Guarda en los reportes del cliente un archivo generado en el navegador (p. ej. la gráfica). */
export function attachFile(sot: string, tipo: string, nombre: string, filename: string, blob: Blob) {
  const f = new FormData();
  f.append("sot", sot); f.append("tipo", tipo); f.append("nombre", nombre); f.append("filename", filename); f.append("file", blob, filename);
  return api.post("/clients/attach-file", f, { headers: { "Content-Type": "multipart/form-data" } });
}

/** "31/10/2026" o "2026-10-31" -> "2026-10-31" ('' si no se entiende). */
export function toISODate(f: string): string {
  const s = (f || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (!m) return "";
  const p = (n: string) => n.padStart(2, "0");
  return `${m[3]}-${p(m[2])}-${p(m[1])}`;
}

/**
 * Cada vez que cambian los datos de una SOT en una ventana, se guardan solos en
 * su cliente (se crea si no existe). Espera un momento para no guardar en cada tecla.
 */
export function useSotSync(data: ClientInput, enabled = true): void {
  const last = useRef("");
  const auto = useAutosave();
  const json = JSON.stringify({ ...data, datos: expandDatos(data.datos) });
  useEffect(() => {
    if (!auto || !enabled || !data.sot?.trim()) return;
    if (json === last.current) return;
    const t = window.setTimeout(() => {
      last.current = json;
      syncClient({ ...data, datos: expandDatos(data.datos), fecha: toISODate(data.fecha ?? "") }).catch(() => {
        last.current = ""; // se reintenta con el próximo cambio
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [json, enabled, auto]); // eslint-disable-line react-hooks/exhaustive-deps
}

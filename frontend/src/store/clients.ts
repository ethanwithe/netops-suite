/** Datos de clientes por SOT (año/mes según la fecha de los datos). Cualquier ventana puede sumar lo que sabe. */
import { useEffect, useRef } from "react";
import { api } from "../api/client";

export interface ClientRecord {
  id: string;
  sot: string;
  nombre: string;
  fecha: string; // yyyy-mm-dd
  cid: string;
  proy: string;
  contrata: string;
  datos: Record<string, string>;
  reportes: { tipo?: string; nombre?: string; filename?: string; url?: string; generado?: string }[];
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
export const listClients = (params: { year?: number; q?: string }) =>
  api.get<ClientRecord[]>("/clients", { params }).then((r) => r.data);
export const createClient = (c: ClientInput) => api.post<ClientRecord>("/clients", c).then((r) => r.data);
export const updateClient = (id: string, c: ClientInput) => api.put<ClientRecord>(`/clients/${id}`, c).then((r) => r.data);
export const deleteClient = (id: string) => api.delete(`/clients/${id}`);

export interface SyncInput extends ClientInput {
  reporte?: { tipo?: string; nombre?: string; filename?: string; url?: string };
}
export const syncClient = (c: SyncInput) => api.post<ClientRecord>("/clients/sync", c).then((r) => r.data);

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
  const json = JSON.stringify({ ...data, datos: data.datos ?? {} });
  useEffect(() => {
    if (!enabled || !data.sot?.trim()) return;
    if (json === last.current) return;
    const t = window.setTimeout(() => {
      last.current = json;
      syncClient({ ...data, fecha: toISODate(data.fecha ?? "") }).catch(() => {
        last.current = ""; // se reintenta con el próximo cambio
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [json, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

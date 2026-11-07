/** Agenda personal: recordatorios, tareas y eventos (los crea el usuario o Bit). */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";

export type AgendaKind = "recordatorio" | "tarea" | "evento";
export interface AgendaItem { id: string; kind: AgendaKind; title: string; notes: string; done: boolean; due_at: string | null; created_at: string | null }

let list: AgendaItem[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export async function reloadAgenda(): Promise<void> {
  const { data } = await api.get<AgendaItem[]>("/agenda");
  list = data; loaded = true; emit();
}
export function useAgenda() {
  const items = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => list);
  useEffect(() => { if (!loaded) void reloadAgenda().catch(() => {}); }, []);
  return { items, loaded };
}
export const getAgenda = () => list;
export const addAgenda = (p: { kind: AgendaKind; title: string; due_at?: string | null; notes?: string }) =>
  api.post<AgendaItem>("/agenda", p).then(reloadAgenda);
export const patchAgenda = (id: string, p: Partial<Pick<AgendaItem, "kind" | "title" | "notes" | "done">> & { due_at?: string; clear_due?: boolean }) =>
  api.put<AgendaItem>(`/agenda/${id}`, p).then(reloadAgenda);
export const removeAgenda = (id: string) => api.delete(`/agenda/${id}`).then(reloadAgenda);
/** Lo que ya venció y todavía no se avisó (el servidor lo marca como avisado al entregarlo). */
export const fetchDue = () => api.get<AgendaItem[]>("/agenda/due").then((r) => r.data);

export const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-PE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sin hora";
/** Valor de <input type="datetime-local"> (hora local) <-> ISO UTC. */
export const toLocalInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

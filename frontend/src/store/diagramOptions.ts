/** Opciones de Gráfica creadas por usuarios y diseños publicados / base (se guardan en el servidor). */
import { useSyncExternalStore } from "react";
import { api } from "../api/client";
import type { Doc } from "../diagram/types";

export interface DiagramOptionRow { id: string; grupo: string; nombre: string; custom: boolean; published: boolean; bases: number }
export interface OptionDetail { published: Doc | null; base: Doc | null; versions: { id: string; at: string; by: string }[] }

let state: { list: DiagramOptionRow[]; loaded: boolean } = { list: [], loaded: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
const set = (n: Partial<typeof state>) => { state = { ...state, ...n }; listeners.forEach((l) => l()); };

export function loadDiagramOptions(force = false): Promise<void> {
  if (loading && !force) return loading;
  const p: Promise<void> = api.get<DiagramOptionRow[]>("/diagrams/options")
    .then((r) => set({ list: Array.isArray(r.data) ? r.data : [], loaded: true }))
    .catch(() => set({ loaded: true }))
    .finally(() => { loading = null; });
  loading = p;
  return p;
}

export function useDiagramOptions() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); if (!state.loaded && !loading) void loadDiagramOptions(); return () => listeners.delete(l); },
    () => state, () => state,
  );
}

export async function fetchOption(id: string): Promise<OptionDetail> {
  const { data } = await api.get<OptionDetail>(`/diagrams/options/${id}`);
  return data;
}
export async function fetchVersion(id: string, vid: string): Promise<Doc> {
  const { data } = await api.get<{ doc: Doc }>(`/diagrams/options/${id}/versions/${vid}`);
  return data.doc;
}
export async function publishOption(id: string, doc: Doc): Promise<void> {
  await api.post(`/diagrams/options/${id}/publish`, { doc });
  void loadDiagramOptions(true);
}
export async function setOptionBase(id: string, doc: Doc): Promise<void> {
  await api.post(`/diagrams/options/${id}/base`, { doc });
  void loadDiagramOptions(true);
}
export async function createOption(grupo: string, nombre: string, doc: Doc): Promise<DiagramOptionRow> {
  const { data } = await api.post<DiagramOptionRow>("/diagrams/options", { grupo, nombre, doc });
  set({ list: [...state.list, data] });
  return data;
}
export async function deleteOption(id: string): Promise<void> {
  await api.delete(`/diagrams/options/${id}`);
  set({ list: state.list.filter((o) => o.id !== id) });
}

/** Opciones de Gráfica creadas por usuarios y diseños publicados / base (se guardan en el servidor). */
import { useMemo, useSyncExternalStore } from "react";
import { api } from "../api/client";
import type { Doc } from "../diagram/types";
import { gruposOf } from "../diagram/groups";

export interface DiagramOptionRow { id: string; grupo: string; nombre: string; custom: boolean; published: boolean; bases: number }
export interface OptionDetail { published: Doc | null; base: Doc | null; versions: { id: string; at: string; by: string }[] }

/** Marcas creadas por el superadmin y nombres cambiados (de marcas y de opciones de fábrica). */
export interface DiagramLayout { groups: { id: string; label: string }[]; labels: Record<string, string> }
const NO_LAYOUT: DiagramLayout = { groups: [], labels: {} };

let state: { list: DiagramOptionRow[]; loaded: boolean; layout: DiagramLayout } = { list: [], loaded: false, layout: NO_LAYOUT };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
const set = (n: Partial<typeof state>) => { state = { ...state, ...n }; listeners.forEach((l) => l()); };

export function loadDiagramOptions(force = false): Promise<void> {
  if (loading && !force) return loading;
  const p: Promise<void> = Promise.all([
    api.get<DiagramOptionRow[]>("/diagrams/options"),
    api.get<DiagramLayout>("/diagrams/options/layout").then((r) => r.data).catch(() => state.layout),
  ])
    .then(([r, layout]) => set({ list: Array.isArray(r.data) ? r.data : [], loaded: true, layout: layout?.groups ? layout : NO_LAYOUT }))
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

/** Crea una marca nueva (al mismo nivel que Cisco, Huawei y Fortinet). Solo superadmin. */
export async function createGroup(label: string): Promise<string> {
  const { data } = await api.post<DiagramLayout>("/diagrams/options/groups", { label });
  set({ layout: data });
  return data.groups[data.groups.length - 1].id;
}
/** Cambia el nombre de una marca u opción (también las de fábrica). Solo superadmin. */
export async function renameLabel(id: string, label: string): Promise<void> {
  const { data } = await api.put<DiagramLayout>("/diagrams/options/labels", { id, label });
  set({ layout: data });
  void loadDiagramOptions(true);
}
export async function deleteGroup(id: string): Promise<void> {
  const { data } = await api.delete<DiagramLayout>(`/diagrams/options/groups/${id}`);
  set({ layout: data, list: state.list.filter((o) => o.grupo !== id) });
}

/** Marcas (de fábrica + creadas) con sus nombres vigentes. */
export function useGrupos() {
  const s = useDiagramOptions();
  return useMemo(() => gruposOf(s.layout), [s.layout]);
}

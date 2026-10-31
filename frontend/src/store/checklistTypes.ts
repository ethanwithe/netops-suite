/** Tipos de CheckList (Internet Huawei, RPV Cisco con HA, ...). Se guardan en el servidor. */
import { useSyncExternalStore } from "react";
import { api } from "../api/client";

export interface CkItem {
  id: string;
  nombre: string;
  /** texto: la salida va como texto en el PDF · foto: va como captura (imagen) */
  modo: "texto" | "foto";
  /** Comando a ejecutar; puede llevar {WAN}, {NEXTHOP}, ... */
  cmd: string;
}
export interface CkSection {
  id: string;
  titulo: string;
  items: CkItem[];
}
export interface CkParam {
  key: string;
  label: string;
  default: string;
}
export interface CkData {
  servicio: "internet" | "rpv";
  vendor: string;
  setup: string[];
  params: CkParam[];
  sections: CkSection[];
}
export interface CkType {
  id: string;
  nombre: string;
  data: CkData;
}

interface Store {
  list: CkType[];
  loaded: boolean;
  error: boolean;
}

let state: Store = { list: [], loaded: false, error: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: Partial<Store>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function loadChecklistTypes(force = false): Promise<void> {
  if (loading && !force) return loading;
  const p: Promise<void> = api
    .get<CkType[]>("/checklist/templates")
    .then((r) => set({ list: Array.isArray(r.data) ? r.data : [], loaded: true, error: false }))
    .catch(() => set({ loaded: true, error: true }))
    .finally(() => {
      loading = null;
    });
  loading = p;
  return p;
}

export function useChecklistTypes(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!state.loaded && !loading) void loadChecklistTypes();
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

export async function createChecklistType(input: { nombre: string; copiar_de?: string; data?: Partial<CkData> }): Promise<CkType> {
  const { data } = await api.post<CkType>("/checklist/templates", input);
  set({ list: [...state.list, data] });
  return data;
}

export async function updateChecklistType(id: string, nombre: string, data: CkData): Promise<CkType> {
  const { data: out } = await api.put<CkType>(`/checklist/templates/${id}`, { nombre, data });
  set({ list: state.list.map((t) => (t.id === id ? out : t)) });
  return out;
}

export async function deleteChecklistType(id: string): Promise<void> {
  await api.delete(`/checklist/templates/${id}`);
  set({ list: state.list.filter((t) => t.id !== id) });
}

export const checklistRoute = (id: string) => `/checklist/t/${id}`;

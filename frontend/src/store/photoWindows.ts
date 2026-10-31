/**
 * Ventanas de reporte fotográfico creadas por el usuario. Se guardan en el
 * servidor (base de datos), así que aparecen en cualquier navegador o celular.
 */
import { useSyncExternalStore } from "react";
import { api } from "../api/client";
import { forgetWindow } from "./photoReportStore";
import type { WindowConfig } from "./photoReportStore";

export interface PhotoWindow {
  id: string;
  nombre: string;
  config: WindowConfig;
}

interface WinStore {
  list: PhotoWindow[];
  loaded: boolean;
  error: boolean;
}

let state: WinStore = { list: [], loaded: false, error: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: Partial<WinStore>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function loadWindows(force = false): Promise<void> {
  if (loading && !force) return loading;
  const p: Promise<void> = api
    .get<PhotoWindow[]>("/photos/windows")
    .then((r) => set({ list: Array.isArray(r.data) ? r.data : [], loaded: true, error: false }))
    .catch(() => set({ loaded: true, error: true }))
    .finally(() => {
      loading = null;
    });
  loading = p;
  return p;
}

export function usePhotoWindows(): WinStore {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!state.loaded && !loading) void loadWindows();
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

export interface WindowInput {
  nombre: string;
  config: WindowConfig;
  /** Solo al crear. "" = empezar sin ítems. */
  copiar_de?: string;
}

export async function createWindow(input: WindowInput): Promise<PhotoWindow> {
  const { data } = await api.post<PhotoWindow>("/photos/windows", input);
  set({ list: [...state.list, data] });
  return data;
}

export async function updateWindow(id: string, input: WindowInput): Promise<PhotoWindow> {
  const { data } = await api.put<PhotoWindow>(`/photos/windows/${id}`, input);
  set({ list: state.list.map((w) => (w.id === id ? data : w)) });
  return data;
}

export async function deleteWindow(id: string): Promise<void> {
  await api.delete(`/photos/windows/${id}`);
  forgetWindow(id);
  set({ list: state.list.filter((w) => w.id !== id) });
}

export const windowRoute = (id: string) => `/fotografico/v/${id}`;

/** Nombres de la interfaz que el superadmin puede cambiar (menú, ventanas de fábrica...). Si no hay cambio, vale el de fábrica. */
import { useSyncExternalStore } from "react";
import { api } from "../api/client";

let labels: Record<string, string> = {};
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function loadUiLabels(force = false): Promise<void> {
  if (loading && !force) return loading;
  const p: Promise<void> = api.get<{ labels: Record<string, string> }>("/designs/labels")
    .then((r) => { labels = r.data.labels ?? {}; })
    .catch(() => undefined)
    .finally(() => { loaded = true; loading = null; emit(); });
  loading = p;
  return p;
}

export async function setUiLabel(key: string, label: string): Promise<void> {
  const { data } = await api.put<{ labels: Record<string, string> }>("/designs/labels", { key, label });
  labels = data.labels ?? {};
  emit();
}

/** `L(clave, defecto)`: el nombre vigente (el cambiado por el superadmin o, si no hay, el de fábrica). */
export function useUiLabels() {
  const snap = useSyncExternalStore(
    (l) => { listeners.add(l); if (!loaded && !loading) void loadUiLabels(); return () => listeners.delete(l); },
    () => labels, () => labels,
  );
  return { labels: snap, L: (key: string, def: string) => snap[key] || def };
}

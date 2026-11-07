import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";
import type { IconInfo } from "./types";

let list: IconInfo[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export async function reloadIcons(): Promise<void> {
  const { data } = await api.get<IconInfo[]>("/diagrams/icons");
  list = data; loaded = true; emit();
}
export function useIcons(): { icons: IconInfo[]; loaded: boolean } {
  const icons = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => list);
  useEffect(() => { if (!loaded && !loading) loading = reloadIcons().finally(() => { loading = null; }); }, []);
  return { icons, loaded };
}
export const iconUrl = (id: string) => `/api/diagrams/icons/${encodeURIComponent(id)}/image`;

export async function uploadIcon(file: File, name = "", categoria = "Mis iconos"): Promise<IconInfo> {
  const fd = new FormData();
  fd.append("file", file); fd.append("name", name); fd.append("categoria", categoria);
  const { data } = await api.post<IconInfo>("/diagrams/icons", fd);
  await reloadIcons();
  return data;
}
export const renameIcon = (id: string, name: string, categoria: string) => api.put(`/diagrams/icons/${id}`, { name, categoria }).then(reloadIcons);
export const deleteIcon = (id: string) => api.delete(`/diagrams/icons/${id}`).then(reloadIcons);

/** Medidas reales del icono (para insertarlo sin deformarlo). */
export function iconSize(id: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth || 100, h: im.naturalHeight || 100 });
    im.onerror = () => res({ w: 100, h: 100 });
    im.src = iconUrl(id);
  });
}

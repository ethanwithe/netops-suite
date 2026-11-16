/** Interruptor global del guardado automático (por SOT y en «Datos de cliente»). Se recuerda en este navegador. */
import { useSyncExternalStore } from "react";

const KEY = "netops.ui.v1.autosave.on";
const subs = new Set<() => void>();
let value = true;
try { value = localStorage.getItem(KEY) !== "0"; } catch { /* sin almacenamiento: queda activado */ }

export const getAutosave = () => value;
export function setAutosave(v: boolean): void {
  value = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignorar */ }
  subs.forEach((f) => f());
}
export function useAutosave(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => value, () => value);
}

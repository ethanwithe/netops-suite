import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark" | "ocean";
export const THEME_OPTIONS: { id: ThemePref; label: string; hint: string }[] = [
  { id: "system", label: "Predeterminado", hint: "Sigue al sistema" },
  { id: "light", label: "Claro", hint: "Fondo blanco" },
  { id: "dark", label: "Oscuro", hint: "Gris azulado" },
  { id: "ocean", label: "Océano", hint: "Azul profundo" },
];
const KEY = "netops.theme";
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY) as ThemePref | null;
    if (v && THEME_OPTIONS.some((o) => o.id === v)) return v;
  } catch { /* sin almacenamiento */ }
  return "system";
}
let pref: ThemePref = read();

export function resolveTheme(p: ThemePref): "light" | "dark" | "ocean" {
  if (p !== "system") return p;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme() {
  const t = resolveTheme(pref);
  const d = document.documentElement;
  d.dataset.theme = t;
  d.classList.toggle("dark", t !== "light");
}

export function setTheme(p: ThemePref) {
  pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* ignorar */ }
  applyTheme();
  listeners.forEach((l) => l());
}

try {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (pref === "system") applyTheme();
  });
} catch { /* ignorar */ }

export function useTheme() {
  const p = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => pref,
  );
  return { pref: p, resolved: resolveTheme(p), setTheme };
}

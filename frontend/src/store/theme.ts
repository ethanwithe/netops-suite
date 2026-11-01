import { useSyncExternalStore } from "react";

export type ThemeId = "light" | "sky" | "dark" | "ocean" | "aurora";
export type ThemePref = "system" | ThemeId;
export const isDarkTheme = (t: ThemeId) => t === "dark" || t === "ocean" || t === "aurora";
export const THEME_OPTIONS: { id: ThemePref; label: string; hint: string }[] = [
  { id: "system", label: "Predeterminado", hint: "Sigue al sistema" },
  { id: "light", label: "Claro", hint: "Blanco limpio" },
  { id: "sky", label: "Cielo", hint: "Azul cristalino" },
  { id: "dark", label: "Oscuro", hint: "Grafito" },
  { id: "ocean", label: "Océano", hint: "Azul profundo" },
  { id: "aurora", label: "Aurora", hint: "Violeta y turquesa" },
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

export function resolveTheme(p: ThemePref): ThemeId {
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
  d.classList.toggle("dark", isDarkTheme(t));
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

/** Colores de muestra para el selector. */
export const THEME_SWATCH: Record<ThemePref, string> = {
  system: "linear-gradient(135deg,#f4f8ff 50%,#0f172a 50%)",
  light: "linear-gradient(135deg,#ffffff,#d5e4fa)",
  sky: "linear-gradient(135deg,#dff2ff,#4f9bff)",
  dark: "linear-gradient(135deg,#2b3347,#0b0e15)",
  ocean: "linear-gradient(135deg,#1eb8f0,#051026)",
  aurora: "linear-gradient(135deg,#e65ac8,#7c5cff 45%,#3ce1d7)",
};

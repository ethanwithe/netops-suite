import { useSyncExternalStore } from "react";

/** Personalización visual: escena de fondo 3D, gotas y colores. Se guarda en este navegador. */
export type Scene = "none" | "bubbles" | "orbs" | "waves" | "crystals" | "stars";
export const SCENES: { id: Scene; label: string }[] = [
  { id: "none", label: "Ninguno" },
  { id: "bubbles", label: "Burbujas" },
  { id: "orbs", label: "Esferas" },
  { id: "waves", label: "Olas" },
  { id: "crystals", label: "Cristales" },
  { id: "stars", label: "Estrellas" },
];

export interface Look {
  scene: Scene;
  drops: boolean;
  bgHue: number | null;      // color del fondo (null = el del tema)
  dropHue: number | null;    // color de las gotas
  accentHue: number | null;  // color de botones y acentos
  intensity: number;         // 0.3 – 1.5: fuerza del fondo
  glass: boolean;            // efecto cristal líquido al pasar el cursor
}
export const LOOK_DEFAULTS: Look = { scene: "none", drops: true, bgHue: null, dropHue: null, accentHue: null, intensity: 1, glass: true };

const KEY = "netops.look";
const listeners = new Set<() => void>();

function read(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...LOOK_DEFAULTS, ...v };
  } catch { return { ...LOOK_DEFAULTS }; }
}
let look: Look = read();

/** hsl (h 0-360, s/l 0-100) → "r g b" para usar en rgb(var(--x) / a). */
export function hsl(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `${f(0)} ${f(8)} ${f(4)}`;
}

export function applyLook() {
  const d = document.documentElement, st = d.style;
  const set = (k: string, v: string | null) => (v == null ? st.removeProperty(k) : st.setProperty(k, v));
  const b = look.bgHue, g = look.dropHue, a = look.accentHue;
  set("--bg1", b == null ? null : hsl(b, 92, 58));
  set("--bg2", b == null ? null : hsl((b + 40) % 360, 82, 52));
  set("--bg3", b == null ? null : hsl((b + 330) % 360, 88, 66));
  set("--drop1", g == null ? null : hsl(g, 90, 74));
  set("--drop2", g == null ? null : hsl(g, 72, 24));
  set("--drop3", g == null ? null : hsl(g, 82, 8));
  set("--sdrop1", g == null ? null : hsl(g, 90, 78));
  set("--sdrop2", g == null ? null : hsl(g, 70, 38));
  set("--sdrop3", g == null ? null : hsl(g, 80, 14));
  set("--btn1", a == null ? null : hsl(a, 100, 63));
  set("--btn2", a == null ? null : hsl(a, 76, 46));
  set("--btn3", a == null ? null : hsl(a, 76, 35));
  set("--accent", a == null ? null : hsl(a, 76, 46));
  set("--accent2", a == null ? null : hsl((a + 25) % 360, 95, 62));
  st.setProperty("--bgo", String(look.intensity));
  d.dataset.glass = look.glass ? "on" : "off";
}

export function setLook(p: Partial<Look>) {
  look = { ...look, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* ignorar */ }
  applyLook();
  listeners.forEach((l) => l());
}
export const resetLook = () => setLook({ ...LOOK_DEFAULTS });

if (typeof document !== "undefined") applyLook();

export function useLook() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => look);
}

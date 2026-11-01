import { useSyncExternalStore } from "react";

export interface MascotSettings {
  hidden: boolean;   // ocultar por completo
  voice: boolean;    // hablar en voz alta
  idle: boolean;     // comentarios espontáneos
  right: number;     // posición (px desde el borde derecho)
  bottom: number;    // posición (px desde el borde inferior)
  voiceName: string; // voz elegida ('' = la mejor disponible; 'nube:nova' = voz del servidor)
  voiceStyle: string; // normal | grave | aguda | pausada | rapida | robot | dibujos
  listen: boolean;   // conversación: micrófono siempre atento
  needName: boolean; // solo responder si dices «Bit»
  learn: boolean;    // aprender de ti
}
const KEY = "netops.mascot";
const DEFAULTS: MascotSettings = { hidden: false, voice: false, idle: true, right: 16, bottom: 16, voiceName: "", voiceStyle: "normal", listen: true, needName: false, learn: true };
const listeners = new Set<() => void>();

function load(): MascotSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* sin almacenamiento */ }
  return { ...DEFAULTS };
}
let state = load();

export function setMascot(patch: Partial<MascotSettings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignorar */ }
  listeners.forEach((l) => l());
}

export function useMascotSettings() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
  );
}

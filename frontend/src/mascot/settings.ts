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
  needName: boolean; // despertar al decir «Bit» (como un asistente de voz)
  learn: boolean;    // aprender de ti
  mute: boolean;     // voz de Bit apagada (independiente del micrófono)
}
const KEY = "netops.mascot";
const DEFAULTS: MascotSettings = { hidden: false, voice: false, idle: true, right: 16, bottom: 16, voiceName: "", voiceStyle: "normal", listen: true, needName: true, learn: true, mute: false };
const listeners = new Set<() => void>();

function load(): MascotSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = { ...DEFAULTS, ...JSON.parse(raw) };
      // Una sola vez: Bit pasa a despertar con su nombre («Bit, ...»); se puede volver a apagar en su panel.
      if (!localStorage.getItem("netops.mascot.wake1")) { j.needName = true; localStorage.setItem("netops.mascot.wake1", "1"); }
      return j;
    }
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

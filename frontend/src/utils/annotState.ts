/**
 * Marcas de una foto editada (texto, líneas, flechas, recortes ya aplicados…): se guardan junto a la foto para
 * poder volver a abrirla y seguir editando cada marca, no solo ver la imagen ya «quemada».
 * `baseUrl` es la foto sin marcas (con recortes y ajustes aplicados).
 */
export interface AnnotState { baseUrl: string; w: number; h: number; objects: unknown[]; t?: number }

const KEY = "netops.ui.v1.annot.states";
const MAX = 200;
const norm = (u: string) => (u || "").split("?")[0];

function read(): Record<string, AnnotState> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, AnnotState>; } catch { return {}; }
}

export const getEditState = (url: string): AnnotState | null => read()[norm(url)] ?? null;

export function setEditState(url: string, st: AnnotState): void {
  const m = read();
  m[norm(url)] = { ...st, t: Date.now() };
  const keys = Object.keys(m);
  if (keys.length > MAX) for (const k of keys.sort((a, b) => (m[a].t ?? 0) - (m[b].t ?? 0)).slice(0, keys.length - MAX)) delete m[k];
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* sin espacio: se edita sobre la imagen como antes */ }
}

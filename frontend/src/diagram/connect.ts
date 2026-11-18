/** Conectores: líneas cuyos extremos se pegan a un elemento y lo siguen cuando se mueve. */
import type { Anchor, El, LineEl } from "./types";

export interface Pt { x: number; y: number }
type Side = "t" | "r" | "b" | "l";
type Shaped = Exclude<El, LineEl>;
export const SIDES: Side[] = ["t", "r", "b", "l"];

const center = (e: Shaped): Pt => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });

export function anchorPoint(e: Shaped, side: Side): Pt {
  const c = center(e);
  const p = side === "t" ? { x: c.x, y: e.y } : side === "b" ? { x: c.x, y: e.y + e.h } : side === "l" ? { x: e.x, y: c.y } : { x: e.x + e.w, y: c.y };
  const r = ((e as { rot?: number }).rot ?? 0) * Math.PI / 180;
  if (!r) return p;
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) };
}

/** El lado que mira hacia el punto dado. */
export function autoSide(e: Shaped, toward: Pt): Side {
  const c = center(e);
  const dx = (toward.x - c.x) / (e.w / 2 || 1), dy = (toward.y - c.y) / (e.h / 2 || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t");
}

/** Pone en cada línea pegada las coordenadas del elemento al que está unida (si ya no existe, queda suelta). */
export function resolveLines(els: El[]): El[] {
  if (!els.some((e) => e.type === "line" && (e.a || e.b))) return els;
  const by = new Map(els.map((e) => [e.id, e]));
  const target = (a: Anchor | undefined): Shaped | null => {
    const t = a ? by.get(a.id) : undefined;
    return t && t.type !== "line" ? (t as Shaped) : null;
  };
  return els.map((e) => {
    if (e.type !== "line" || (!e.a && !e.b)) return e;
    const ta = target(e.a), tb = target(e.b);
    let { x1, y1, x2, y2 } = e;
    const ca = ta ? center(ta) : { x: x1, y: y1 }, cb = tb ? center(tb) : { x: x2, y: y2 };
    if (ta && e.a) { const s = e.a.side === "auto" ? autoSide(ta, cb) : e.a.side; const p = anchorPoint(ta, s); x1 = p.x; y1 = p.y; }
    if (tb && e.b) { const s = e.b.side === "auto" ? autoSide(tb, ca) : e.b.side; const p = anchorPoint(tb, s); x2 = p.x; y2 = p.y; }
    const out: LineEl = { ...e, x1, y1, x2, y2 };
    if (e.a && !ta) out.a = undefined;
    if (e.b && !tb) out.b = undefined;
    return x1 === e.x1 && y1 === e.y1 && x2 === e.x2 && y2 === e.y2 && out.a === e.a && out.b === e.b ? e : out;
  });
}

export interface Snap { id: string; side: Side; pt: Pt }
/** ¿Hay un elemento cerca de ese punto? Devuelve el punto de unión más cercano (o el lado más próximo si está encima). */
export function snapAt(els: El[], p: Pt, tol: number, skip: string[] = []): Snap | null {
  let best: Snap | null = null, bestD = Infinity;
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.type === "line" || skip.includes(e.id)) continue;
    const inside = p.x >= e.x - tol && p.x <= e.x + e.w + tol && p.y >= e.y - tol && p.y <= e.y + e.h + tol;
    if (!inside) continue;
    let cand: Snap | null = null, cd = Infinity;
    for (const side of SIDES) {
      const pt = anchorPoint(e as Shaped, side);
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < cd) { cd = d; cand = { id: e.id, side, pt }; }
    }
    // los fondos y marcos grandes solo se pegan cerca de un punto de unión; los iconos y cuadros chicos, desde cualquier parte de ellos
    const small = e.w <= 420 && e.h <= 420;
    if (cand && (small || cd <= tol * 1.5)) { best = cand; bestD = cd; }
    if (best) return best;   // el de más arriba gana
  }
  return null;
}

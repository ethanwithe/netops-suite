/** Imagen (PNG) de lo que se ve en la terminal, con los mismos colores: sirve de evidencia o para pegar en un correo/Word. */
import { colorOf } from "./vt";
import type { VCell } from "./vt";
import { colorMap } from "./termColors";

export function termCanvas(lines: VCell[][], o: { bg: string; fg: string; fontSize: number; paint: "dark" | "light" | ""; maxLines?: number }): HTMLCanvasElement | null {
  let ls = lines.map((l) => l);
  while (ls.length && !ls[ls.length - 1].some((c) => c.c.trim())) ls.pop();
  ls = ls.slice(-(o.maxLines ?? 400));
  if (!ls.length) return null;
  const fs = o.fontSize, lh = Math.round(fs * 1.35), pad = 12, k = 2;
  const font = (b: boolean) => `${b ? "700 " : ""}${fs}px ui-monospace, Consolas, "Courier New", monospace`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font(false);
  const cw = probe.measureText("M").width;
  const cols = Math.min(300, Math.max(20, ...ls.map((l) => { let n = l.length; while (n > 0 && !l[n - 1].c.trim()) n--; return n; })));
  const cv = document.createElement("canvas");
  cv.width = Math.ceil((cols * cw + pad * 2) * k);
  cv.height = (ls.length * lh + pad * 2) * k;
  const g = cv.getContext("2d")!;
  g.scale(k, k);
  g.fillStyle = o.bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.textBaseline = "top";
  ls.forEach((l, y) => {
    const auto = o.paint ? colorMap(l.map((c) => c.c).join(""), o.paint === "dark") : [];
    let x = 0;
    while (x < l.length && x < cols) {
      const c = l[x];
      const col = c.f >= 0 ? colorOf(c.f) : auto[x] || o.fg;
      let end = x + 1, txt = c.c;
      while (end < l.length && end < cols) {
        const n = l[end];
        const nc = n.f >= 0 ? colorOf(n.f) : auto[end] || o.fg;
        if (nc !== col || n.b !== c.b) break;
        txt += n.c; end++;
      }
      g.font = font(c.b);
      g.fillStyle = col;
      g.fillText(txt, pad + x * cw, pad + y * lh + (lh - fs) / 2 - 1);
      x = end;
    }
  });
  return cv;
}

export const canvasBlob = (cv: HTMLCanvasElement) => new Promise<Blob | null>((r) => cv.toBlob(r, "image/png"));

/**
 * Ajuste de los textos para que el editor y lo que se descarga (PPTX / PDF) se vean igual.
 * Misma regla que backend/app/services/diagram_fit.py:
 *  - un interlineado fijo menor que la letra (p. ej. 14,6 px con letra de 24 px) se sube, si no la letra se monta;
 *  - un texto con color de fondo: aire a los lados, una sola línea sin interlineado fijo, y la caja se agranda lo necesario.
 * Solo agranda (nunca achica) y es idempotente.
 */
import type { TextEl } from "./types";

export const PT = 1.2698;   // px por punto de fuente
export const PAD_X = 8;     // aire a los lados del texto dentro del color
export const PAD_Y = 4;
const MARK = /\*\*|~~/g;

let ctx: CanvasRenderingContext2D | null = null;
function widthOf(text: string, bold: boolean, italic: boolean, fpx: number): number {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * fpx * 0.55;
  ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fpx}px Arial, Helvetica, sans-serif`;
  return ctx.measureText(text).width;
}

export function fitText(el: TextEl): TextEl {
  if (!String(el.text ?? "").trim()) return el;
  const e: TextEl = { ...el };
  const size = Number(e.size) || 12;
  const fpx = size * PT;
  if (e.lineH && Number(e.lineH) < fpx) e.lineH = Math.round(fpx * 1.15 * 100) / 100;
  if (!e.fill) return e;
  if (!String(e.text).includes("\n")) e.lineH = undefined;
  const lines = String(e.text).split("\n");
  const lead = e.lineH ? Number(e.lineH) : fpx * 1.2;
  const spc = Number(e.spcBef) || 0;
  const needH = lines.length * lead + spc * Math.max(0, lines.length - 1) + 2 * PAD_Y;
  let { x, y, w, h } = e;
  h = h ?? 20;
  if (e.nowrap || lines.length === 1) {
    const widest = Math.max(...lines.map((l) => widthOf(l.replace(MARK, ""), !!e.bold, !!e.italic, fpx)));
    let needW = widest + 2 * PAD_X + 2;
    if (!e.nowrap) needW = Math.min(needW, w);
    if (needW > w) {
      if (e.align === "c") x -= (needW - w) / 2;
      else if (e.align === "r") x -= needW - w;
      w = needW;
    }
  }
  if (needH > h) { y -= (needH - h) / 2; h = needH; }
  const r = (v: number) => Math.round(v * 100) / 100;
  return { ...e, x: r(x), y: r(y), w: r(w), h: r(h) };
}

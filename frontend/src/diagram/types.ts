/** Modelo del diagrama: un lienzo (px) con elementos (texto, formas, líneas, iconos, tablas), como en PowerPoint. */

export type Dash = "" | "dash" | "lgDash" | "sysDash" | "dot" | "sysDot" | "dashDot";
export type Head = "none" | "triangle" | "arrow" | "stealth" | "oval" | "diamond";
export type HAlign = "l" | "c" | "r";

interface Base { id: string; name?: string; locked?: boolean }

export interface TextEl extends Base {
  type: "text";
  x: number; y: number; w: number; h: number; rot?: number;
  text: string;                    // admite {{campo}}
  size: number;                    // puntos
  bold?: boolean; italic?: boolean;
  color: string; align: HAlign;
  fill: string | null;             // fondo del cuadro
  lineH?: number | null;           // interlineado en px
  spcBef?: number;                 // espacio antes de cada párrafo (px)
  nowrap?: boolean;
}
export interface RectEl extends Base {
  type: "rect";
  x: number; y: number; w: number; h: number; rot?: number;
  fill: string | null; stroke: string | null; strokeW: number; dash?: Dash;
  text?: string; size?: number; bold?: boolean; italic?: boolean; color?: string; align?: HAlign;
}
export interface LineEl extends Base {
  type: "line";
  x1: number; y1: number; x2: number; y2: number;
  stroke: string; strokeW: number; dash?: Dash; head?: Head; tail?: Head;
}
export interface ImgEl extends Base {
  type: "image";
  x: number; y: number; w: number; h: number; rot?: number;
  icon: string;                    // id de la pestaña Iconos
}
export interface Cell {
  text: string; align: HAlign; size: number; bold: boolean; italic: boolean; color: string;
  fill: string | null;
  grad?: { colors: string[]; ang: number } | null;
  span: number; merged: boolean;
}
export interface TableEl extends Base {
  type: "table";
  x: number; y: number; w: number; h: number; rot?: number;
  cols: number[]; rows: { h: number; cells: Cell[] }[];
}
export type El = TextEl | RectEl | LineEl | ImgEl | TableEl;
export type ImageEl = ImgEl;

export interface Doc { w: number; h: number; elements: El[] }

export interface TemplateField { key: string; label: string; hint?: string; multiline?: boolean }
export interface Template {
  id: string; label: string; desc: string; doc: Doc;
  groups: { title: string; fields: TemplateField[] }[];
}

export interface IconInfo { id: string; name: string; categoria: string; builtin: boolean; mine: boolean; url: string }

export const isLine = (e: El): e is LineEl => e.type === "line";

export interface Box { x: number; y: number; w: number; h: number }
/** Caja que envuelve al elemento (para selección y giro). */
export function bbox(e: El): Box {
  if (e.type === "line") {
    const x = Math.min(e.x1, e.x2), y = Math.min(e.y1, e.y2);
    return { x, y, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
  }
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

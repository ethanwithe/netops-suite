import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import { NEUTRAL, adjustCanvas, isNeutral } from "../utils/imageAdjust";
import type { Adjust } from "../utils/imageAdjust";

interface Props {
  imageUrl: string;
  onClose: () => void;
  onSaved: (path: string, url: string) => void;
}

// ============================================================
// MODELO
//  Todas las marcas de línea (línea, flecha, rectángulo, óvalo) son una misma
//  figura de PUNTOS: se pueden mover, agregar, quitar, curvar, cerrar, hacer
//  punteadas o convertir en flecha en cualquier momento.
// ============================================================

type Point = { x: number; y: number };
type TextBg = "none" | "dark" | "light";

type Poly = { id: number; k: "poly"; pts: Point[]; closed: boolean; smooth: boolean; dashed: boolean; arrow: boolean; color: string; w: number };
type Obj =
  | Poly
  | { id: number; k: "blur"; a: Point; b: Point }
  | { id: number; k: "text"; p: Point; text: string; size: number; color: string; bg: TextBg; bold: boolean };

interface Doc {
  base: HTMLCanvasElement; // imagen de trabajo (nunca se modifica: cada recorte/giro crea otra)
  objects: Obj[];
}

type CropR = { x: number; y: number; w: number; h: number };
type CropMode = "new" | "move" | "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

type Tool = "select" | "line" | "arrow" | "rect" | "ellipse" | "text" | "blur" | "crop";

const MAX_WORK = 3000;     // lado máximo de la imagen guardada (suficiente para un PDF)
const MAX_PREVIEW = 1400;  // resolución de la vista en pantalla
const MAX_HISTORY = 60;

const COLORS = ["#f60707", "#ffd400", "#00c853", "#2979ff", "#ffffff", "#000000"];
const WIDTHS: [string, number][] = [["Fino", 2], ["Normal", 4], ["Grueso", 7]];
const RATIOS: [string, number | null][] = [["Libre", null], ["4:3", 4 / 3], ["3:4", 3 / 4], ["16:9", 16 / 9], ["1:1", 1]];

let nextId = 1;
const newId = () => nextId++;

/** Unidad de medida: 1 unidad = 1/800 del lado mayor (así los trazos escalan con la foto). */
const unitOf = (c: { width: number; height: number }) => Math.max(c.width, c.height) / 800;

// ============================================================
// GEOMETRÍA
// ============================================================

const STEPS = 16;

/** Convierte los puntos de control en la línea real que se dibuja (recta o curva suave). */
function flatten(pts: Point[], closed: boolean, smooth: boolean): Point[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  if (!smooth || n < 3) return closed ? [...pts, pts[0]] : pts.slice();
  const out: Point[] = [];
  const segs = closed ? n : n - 1;
  const P = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let t = 0; t < STEPS; t++) {
      const u = t / STEPS, u2 = u * u, u3 = u2 * u;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
      });
    }
  }
  out.push(closed ? pts[0] : pts[n - 1]);
  return out;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function distToSeg(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Figuras iniciales a partir de un arrastre. */
function shapeFromDrag(kind: "arrow" | "rect" | "ellipse", a: Point, b: Point, style: { color: string; w: number; dashed: boolean; smooth: boolean }): Omit<Poly, "id"> {
  const base = { k: "poly" as const, color: style.color, w: style.w, dashed: style.dashed };
  if (kind === "arrow") return { ...base, pts: [a, b], closed: false, smooth: style.smooth, arrow: true };
  if (kind === "rect") {
    return { ...base, pts: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], closed: true, smooth: style.smooth, arrow: false };
  }
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  const pts = Array.from({ length: 8 }, (_, i) => ({ x: cx + rx * Math.cos((i / 8) * Math.PI * 2), y: cy + ry * Math.sin((i / 8) * Math.PI * 2) }));
  return { ...base, pts, closed: true, smooth: true, arrow: false };
}

// ============================================================
// DIBUJO
// ============================================================

function textMetrics(ctx: CanvasRenderingContext2D, o: Extract<Obj, { k: "text" }>, px: number) {
  ctx.font = `${o.bold ? "bold " : ""}${px}px Arial`;
  const lines = o.text.split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const lead = px * 1.2;
  return { lines, w, lead, h: lead * lines.length };
}

function pixelate(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, a: Point, b: Point, s: number) {
  const x = Math.min(a.x, b.x) * s, y = Math.min(a.y, b.y) * s;
  const w = Math.abs(b.x - a.x) * s, h = Math.abs(b.y - a.y) * s;
  if (w < 2 || h < 2) return;
  const block = Math.max(6, Math.round(Math.max(w, h) / 14));
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.round(w / block));
  tmp.height = Math.max(1, Math.round(h / block));
  const t = tmp.getContext("2d");
  if (!t) return;
  t.drawImage(src, x, y, w, h, 0, 0, tmp.width, tmp.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
  ctx.restore();
}

function drawPoly(ctx: CanvasRenderingContext2D, o: Poly, s: number, lw: number) {
  let flat = flatten(o.pts, o.closed, o.smooth).map((p) => ({ x: p.x * s, y: p.y * s }));
  if (flat.length < 2) return;
  if (o.dashed) ctx.setLineDash([lw * 3, lw * 2]);
  let head: { tip: Point; ang: number; size: number } | null = null;

  if (o.arrow && !o.closed) {
    const size = Math.max(lw * 4, 12);
    const tip = flat[flat.length - 1];
    // punto de la línea a 0,75·cabeza de la punta: la línea termina ahí para que la punta quede limpia
    let acc = 0, k = flat.length - 1;
    while (k > 0 && acc < size * 0.75) { acc += dist(flat[k], flat[k - 1]); k--; }
    const base = flat[k];
    if (dist(base, tip) > 1) {
      head = { tip, ang: Math.atan2(tip.y - base.y, tip.x - base.x), size };
      flat = [...flat.slice(0, k), base];
    }
  }

  ctx.beginPath();
  ctx.moveTo(flat[0].x, flat[0].y);
  for (const p of flat.slice(1)) ctx.lineTo(p.x, p.y);
  if (o.closed) ctx.closePath();
  ctx.stroke();

  if (head) {
    ctx.setLineDash([]);
    const { tip, ang, size } = head;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - size * Math.cos(ang - Math.PI / 7), tip.y - size * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(tip.x - size * Math.cos(ang + Math.PI / 7), tip.y - size * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
}

/** Dibuja los objetos sobre `ctx`. `s` = píxeles del lienzo por píxel de la imagen base. */
function renderObjects(ctx: CanvasRenderingContext2D, objects: Obj[], s: number, u: number, src: HTMLCanvasElement) {
  for (const o of objects) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (o.k === "blur") {
      pixelate(ctx, src, o.a, o.b, s);
    } else if (o.k === "text") {
      const px = o.size * u * s;
      const m = textMetrics(ctx, o, px);
      ctx.textBaseline = "top";
      const pad = px * 0.28;
      const x = o.p.x * s, y = o.p.y * s;
      if (o.bg !== "none") {
        ctx.fillStyle = o.bg === "dark" ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.8)";
        ctx.fillRect(x - pad, y - pad, m.w + pad * 2, m.h + pad * 2 - (m.lead - px));
      }
      ctx.fillStyle = o.color;
      if (o.bg === "none") {
        ctx.lineWidth = Math.max(2, px * 0.12);
        ctx.strokeStyle = o.color === "#000000" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)";
        m.lines.forEach((l, i) => ctx.strokeText(l, x, y + i * m.lead));
      }
      m.lines.forEach((l, i) => ctx.fillText(l, x, y + i * m.lead));
    } else {
      const lw = o.w * u * s;
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.lineWidth = lw;
      drawPoly(ctx, o, s, lw);
    }
    ctx.restore();
  }
}

/** Caja que ocupa un objeto, en píxeles de imagen. */
function boundsImg(ctx: CanvasRenderingContext2D, o: Obj, u: number) {
  if (o.k === "text") {
    const m = textMetrics(ctx, o, o.size * u);
    return { x: o.p.x, y: o.p.y, w: m.w, h: m.h };
  }
  const pts = o.k === "poly" ? flatten(o.pts, o.closed, o.smooth) : [o.a, o.b];
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ---------- selección ----------

function hit(ctx: CanvasRenderingContext2D, o: Obj, p: Point, tol: number, u: number): boolean {
  switch (o.k) {
    case "poly": {
      const f = flatten(o.pts, o.closed, o.smooth);
      return f.some((q, i) => i > 0 && distToSeg(p, f[i - 1], q) <= tol + (o.w * u) / 2);
    }
    case "blur":
      return p.x >= Math.min(o.a.x, o.b.x) && p.x <= Math.max(o.a.x, o.b.x) &&
        p.y >= Math.min(o.a.y, o.b.y) && p.y <= Math.max(o.a.y, o.b.y);
    case "text": {
      const m = textMetrics(ctx, o, o.size * u);
      return p.x >= o.p.x - tol / 2 && p.x <= o.p.x + m.w + tol / 2 && p.y >= o.p.y - tol / 2 && p.y <= o.p.y + m.h + tol / 2;
    }
  }
}

/** Transforma todos los puntos de un objeto (mover, recortar, girar, escalar). */
function mapObj(o: Obj, f: (p: Point) => Point): Obj {
  switch (o.k) {
    case "poly": return { ...o, pts: o.pts.map(f) };
    case "text": return { ...o, p: f(o.p) };
    default: return { ...o, a: f(o.a), b: f(o.b) };
  }
}

/** Puntos de control editables de un objeto. */
function handlesOf(o: Obj): Point[] {
  if (o.k === "poly") return o.pts;
  if (o.k === "blur") return [o.a, o.b];
  return [];
}

function setHandle(o: Obj, i: number, p: Point): Obj {
  if (o.k === "poly") return { ...o, pts: o.pts.map((q, j) => (j === i ? p : q)) };
  if (o.k === "blur") return i === 0 ? { ...o, a: p } : { ...o, b: p };
  return o;
}

// ---------- recorte ajustable ----------

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Qué parte del recuadro de recorte se tocó: una manija, el interior (mover) o nada. */
function cropHit(r: CropR, p: Point, tol: number): CropMode | null {
  const nearX1 = Math.abs(p.x - r.x) <= tol, nearX2 = Math.abs(p.x - (r.x + r.w)) <= tol;
  const nearY1 = Math.abs(p.y - r.y) <= tol, nearY2 = Math.abs(p.y - (r.y + r.h)) <= tol;
  const inX = p.x >= r.x - tol && p.x <= r.x + r.w + tol;
  const inY = p.y >= r.y - tol && p.y <= r.y + r.h + tol;
  const midX = Math.abs(p.x - (r.x + r.w / 2)) <= tol * 1.4;
  const midY = Math.abs(p.y - (r.y + r.h / 2)) <= tol * 1.4;

  if (nearX1 && nearY1) return "tl";
  if (nearX2 && nearY1) return "tr";
  if (nearX1 && nearY2) return "bl";
  if (nearX2 && nearY2) return "br";
  if (nearY1 && midX && inX) return "t";
  if (nearY2 && midX && inX) return "b";
  if (nearX1 && midY && inY) return "l";
  if (nearX2 && midY && inY) return "r";
  if (nearX1 && inY) return "l";
  if (nearX2 && inY) return "r";
  if (nearY1 && inX) return "t";
  if (nearY2 && inX) return "b";
  if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return "move";
  return null;
}

const MIN_CROP = 24;

/** Redimensiona el recuadro arrastrando una manija; con proporción fija la conserva. */
function resizeCrop(o: CropR, mode: CropMode, p: Point, ratio: number | null, W: number, H: number): CropR {
  let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
  const px = clampN(p.x, 0, W), py = clampN(p.y, 0, H);
  const L = mode.includes("l"), R = mode.includes("r"), T = mode.includes("t"), B = mode.includes("b");

  if (L) x1 = Math.min(px, x2 - MIN_CROP);
  if (R) x2 = Math.max(px, x1 + MIN_CROP);
  if (T) y1 = Math.min(py, y2 - MIN_CROP);
  if (B) y2 = Math.max(py, y1 + MIN_CROP);

  if (ratio) {
    const corner = (L || R) && (T || B);
    if (corner || L || R) {
      let w = x2 - x1;
      let h = w / ratio;
      if (!corner) {
        // borde lateral: la altura se ajusta alrededor del centro
        const cy = (o.y + o.h / 2);
        y1 = cy - h / 2; y2 = cy + h / 2;
      } else if (T) y1 = y2 - h;
      else y2 = y1 + h;
      // si se sale de la imagen, se reduce manteniendo la proporción
      const over = Math.max(0 - y1, y2 - H, 0);
      if (over > 0) {
        h -= over * (corner ? 1 : 2);
        w = h * ratio;
        if (L) x1 = x2 - w; else x2 = x1 + w;
        if (!corner) { const cy = o.y + o.h / 2; y1 = cy - h / 2; y2 = cy + h / 2; }
        else if (T) y1 = y2 - h; else y2 = y1 + h;
      }
    } else {
      // borde superior/inferior: el ancho se ajusta alrededor del centro
      let h = y2 - y1;
      let w = h * ratio;
      const cx = o.x + o.w / 2;
      x1 = cx - w / 2; x2 = cx + w / 2;
      const over = Math.max(0 - x1, x2 - W, 0);
      if (over > 0) {
        w -= over * 2;
        h = w / ratio;
        x1 = cx - w / 2; x2 = cx + w / 2;
        if (T) y1 = y2 - h; else y2 = y1 + h;
      }
    }
  }

  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Ajusta un recuadro a una proporción, conservando su centro y sin salirse de la imagen. */
function fitRatio(r: CropR, ratio: number, W: number, H: number): CropR {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = r.w, h = r.w / ratio;
  if (h > r.h) { h = r.h; w = h * ratio; }
  w = Math.min(w, W); h = Math.min(h, H);
  return { x: clampN(cx - w / 2, 0, W - w), y: clampN(cy - h / 2, 0, H - h), w, h };
}

// ============================================================
// IMAGEN
// ============================================================

async function loadBase(url: string): Promise<HTMLCanvasElement> {
  // Se descarga como archivo y se dibuja desde ahí: así funciona también cuando
  // el backend está en otro dominio sin "manchar" el lienzo (CORS).
  let src = url;
  let temp: string | null = null;
  if (!url.startsWith("blob:") && !url.startsWith("data:")) {
    const r = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error("No se pudo cargar la imagen.");
    temp = URL.createObjectURL(await r.blob());
    src = temp;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo cargar la imagen."));
      el.src = src;
    });
    const k = Math.min(1, MAX_WORK / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    if (temp) URL.revokeObjectURL(temp);
  }
}

function rotateBase(src: HTMLCanvasElement, cw: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(cw ? Math.PI / 2 : -Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function cropBase(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(r.w));
  c.height = Math.max(1, Math.round(r.h));
  c.getContext("2d")!.drawImage(src, Math.round(r.x), Math.round(r.y), c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// ============================================================
// COMPONENTE
// ============================================================

function toDataUrl(c: HTMLCanvasElement, max = 1280, q = 0.86): string {
  const k = Math.min(1, max / Math.max(c.width, c.height));
  const t = document.createElement("canvas");
  t.width = Math.max(1, Math.round(c.width * k));
  t.height = Math.max(1, Math.round(c.height * k));
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", q);
}

const AI_CHIPS = ["Mejorar la calidad general", "Aclarar las sombras", "Más nitidez en los textos", "Corregir el color amarillento", "Difuminar caras y placas"];
const EDIT_CHIPS = ["Quitar el objeto del fondo", "Limpiar y ordenar el fondo", "Mejorar iluminación como foto profesional"];

export default function ImageAnnotator({ imageUrl, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });

  const [doc, setDoc] = useState<Doc | null>(null);
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("line");
  const [selId, setSelId] = useState<number | null>(null);
  const [selVertex, setSelVertex] = useState<number | null>(null);

  // Estilo para figuras nuevas (también se aplica a la figura seleccionada)
  const [color, setColor] = useState("#f60707");
  const [textColor, setTextColor] = useState("#ffffff");
  const [width, setWidth] = useState(4);
  const [dashedLine, setDashedLine] = useState(true);
  const [dashedShape, setDashedShape] = useState(false);
  const [curve, setCurve] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [textSize, setTextSize] = useState(28);
  const [textBg, setTextBg] = useState<TextBg>("dark");
  const [bold, setBold] = useState(true);

  // Trazos en curso
  const [draftPts, setDraftPts] = useState<Point[]>([]);
  const [dragShape, setDragShape] = useState<{ a: Point; b: Point } | null>(null);
  const [cropRect, setCropRect] = useState<CropR | null>(null);
  const cropDrag = useRef<{ mode: CropMode; start: Point; orig: CropR } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  const [adj, setAdj] = useState<Adjust>(NEUTRAL);
  const [showOrig, setShowOrig] = useState(false);
  const [adjusted, setAdjusted] = useState<HTMLCanvasElement | null>(null);

  const [panel, setPanel] = useState<null | "adjust" | "ai">(null);
  const [menu, setMenu] = useState<null | "img" | "more">(null);
  const [aiStatus, setAiStatus] = useState<{ adjust: boolean; edit: boolean } | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const moving = useRef<{ id: number; kind: "obj" | "v"; idx: number; last: Point; origin: Doc; moved: boolean } | null>(null);

  // ---------- carga ----------
  useEffect(() => {
    let cancelled = false;
    loadBase(imageUrl)
      .then((base) => !cancelled && setDoc({ base, objects: [] }))
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    api.get("/imageai/status").then((r) => setAiStatus(r.data)).catch(() => setAiStatus({ adjust: false, edit: false }));
  }, []);

  const base = doc?.base ?? null;
  const objects = useMemo(() => doc?.objects ?? [], [doc]);
  const u = base ? unitOf(base) : 1;

  const effAdj = showOrig ? NEUTRAL : adj;
  const previewScale = base ? Math.min(1, MAX_PREVIEW / Math.max(base.width, base.height)) : 1;

  useEffect(() => {
    if (!base) return;
    const timer = window.setTimeout(() => {
      const pv = document.createElement("canvas");
      pv.width = Math.max(1, Math.round(base.width * previewScale));
      pv.height = Math.max(1, Math.round(base.height * previewScale));
      pv.getContext("2d")?.drawImage(base, 0, 0, pv.width, pv.height);
      setAdjusted(adjustCanvas(pv, effAdj));
    }, 40);
    return () => window.clearTimeout(timer);
  }, [base, effAdj, previewScale]);

  // La imagen ocupa todo el espacio disponible.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const fit = useMemo(() => {
    if (!base || !area.w || !area.h) return null;
    const k = Math.min((area.w - 6) / base.width, (area.h - 6) / base.height);
    return { w: Math.max(50, Math.floor(base.width * k)), h: Math.max(50, Math.floor(base.height * k)) };
  }, [base, area]);
  const pxScale = fit && base ? base.width / fit.w : 1; // píxeles de imagen por píxel de pantalla

  // ---------- historial ----------
  const commit = useCallback((next: Doc) => {
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), doc!]);
    setFuture([]);
    setDoc(next);
  }, [doc]);

  function undo() {
    if (!past.length || !doc) return;
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSelId(null); setSelVertex(null); setDraftPts([]);
  }
  function redo() {
    if (!future.length || !doc) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture(future.slice(1));
    setSelId(null); setSelVertex(null);
  }

  const setObjects = (objs: Obj[]) => doc && commit({ ...doc, objects: objs });
  const selected = objects.find((o) => o.id === selId) ?? null;
  const selPoly = selected?.k === "poly" ? selected : null;

  // ---------- dibujo en pantalla ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !base || !adjusted) return;
    canvas.width = adjusted.width;
    canvas.height = adjusted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(adjusted, 0, 0);
    const s = previewScale;
    const live: Obj[] = [...objects];
    const style = { color, w: width, dashed: tool === "line" ? dashedLine : dashedShape, smooth: curve };
    if (dragShape && (tool === "arrow" || tool === "rect" || tool === "ellipse")) live.push({ id: -1, ...shapeFromDrag(tool, dragShape.a, dragShape.b, style) });
    if (dragShape && tool === "blur") live.push({ id: -1, k: "blur", ...dragShape });
    if (tool === "line" && draftPts.length) live.push({ id: -2, k: "poly", pts: draftPts, closed: false, smooth: curve, dashed: dashedLine, arrow: false, color, w: width });
    renderObjects(ctx, live, s, u, adjusted);

    const cs = fit ? canvas.width / fit.w : 1; // píxeles de lienzo por píxel de pantalla
    ctx.fillStyle = color;
    for (const p of draftPts) { ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 4 * cs, 0, Math.PI * 2); ctx.fill(); }

    // figura seleccionada: caja, estructura y puntos de control
    if (tool === "select" && selected) {
      const bb = boundsImg(ctx, selected, u);
      ctx.save();
      if (bb) {
        ctx.setLineDash([6 * cs, 4 * cs]); ctx.lineWidth = 1.2 * cs; ctx.strokeStyle = "rgba(37,99,235,.8)";
        ctx.strokeRect(bb.x * s - 4 * cs, bb.y * s - 4 * cs, bb.w * s + 8 * cs, bb.h * s + 8 * cs);
      }
      ctx.setLineDash([]);
      if (selected.k === "poly") {
        const n = selected.pts.length, segs = selected.closed ? n : n - 1;
        if (selected.smooth) {
          ctx.setLineDash([3 * cs, 4 * cs]); ctx.strokeStyle = "rgba(37,99,235,.55)"; ctx.lineWidth = 1.2 * cs;
          ctx.beginPath();
          selected.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
          if (selected.closed) ctx.closePath();
          ctx.stroke(); ctx.setLineDash([]);
        }
        for (let i = 0; i < segs; i++) {
          const m = mid(selected.pts[i], selected.pts[(i + 1) % n]);
          ctx.beginPath(); ctx.arc(m.x * s, m.y * s, 4.5 * cs, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.strokeStyle = "rgba(37,99,235,.9)"; ctx.lineWidth = 1.5 * cs; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(m.x * s - 2.2 * cs, m.y * s); ctx.lineTo(m.x * s + 2.2 * cs, m.y * s);
          ctx.moveTo(m.x * s, m.y * s - 2.2 * cs); ctx.lineTo(m.x * s, m.y * s + 2.2 * cs); ctx.stroke();
        }
      }
      handlesOf(selected).forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 7 * cs, 0, Math.PI * 2);
        ctx.fillStyle = i === selVertex ? "#2563eb" : "#fff"; ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 2.2 * cs;
        ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }

    // recorte: se oscurece lo que se descarta y se dibujan las manijas
    if (tool === "crop" && cropRect) {
      const x = cropRect.x * s, y = cropRect.y * s, w = cropRect.w * s, h = cropRect.h * s;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvas.width - x - w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3); ctx.stroke();
      }
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      const hs = Math.max(10, Math.round(Math.max(canvas.width, canvas.height) * 0.014));
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2563eb";
      const pts: [number, number][] = [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
      for (const [hx, hy] of pts) { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs); }
    }
  }, [adjusted, base, objects, dragShape, draftPts, cropRect, tool, selected, selVertex, color, width, dashedLine, dashedShape, curve, previewScale, u, fit]);

  // ---------- punteros ----------
  function pointOf(clientX: number, clientY: number): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) * (canvas.width / rect.width)) / previewScale,
      y: ((clientY - rect.top) * (canvas.height / rect.height)) / previewScale,
    };
  }
  const toImage = (e: React.PointerEvent<HTMLCanvasElement>) => pointOf(e.clientX, e.clientY);

  const inBase = (p: Point): Point =>
    base ? { x: Math.max(0, Math.min(base.width, p.x)), y: Math.max(0, Math.min(base.height, p.y)) } : p;

  function constrain(a: Point, b: Point): Point {
    if (tool !== "crop" || !ratio) return b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
    return { x: a.x + Math.sign(dx || 1) * w, y: a.y + Math.sign(dy || 1) * (w / ratio) };
  }

  const cropTol = () => (base ? Math.max(base.width, base.height) * 0.03 : 20);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!doc || !base) return;
    const p = toImage(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    setMenu(null);

    if (tool === "select") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const sel = selected;
      if (sel) {
        const tolH = 13 * pxScale;
        const hs = handlesOf(sel);
        const hi = hs.findIndex((h) => dist(h, p) <= tolH);
        if (hi >= 0) {
          setSelVertex(hi);
          moving.current = { id: sel.id, kind: "v", idx: hi, last: p, origin: doc, moved: false };
          return;
        }
        if (sel.k === "poly") {
          const n = sel.pts.length, segs = sel.closed ? n : n - 1;
          for (let i = 0; i < segs; i++) {
            const m = mid(sel.pts[i], sel.pts[(i + 1) % n]);
            if (dist(m, p) <= tolH * 0.9) {
              const pts = [...sel.pts.slice(0, i + 1), m, ...sel.pts.slice(i + 1)];
              setDoc({ ...doc, objects: doc.objects.map((o) => (o.id === sel.id ? { ...sel, pts } : o)) });
              setSelVertex(i + 1);
              moving.current = { id: sel.id, kind: "v", idx: i + 1, last: p, origin: doc, moved: true };
              return;
            }
          }
        }
      }
      const found = [...objects].reverse().find((o) => hit(ctx, o, p, 10 * pxScale, u)) ?? null;
      setSelId(found ? found.id : null);
      setSelVertex(null);
      if (found) {
        moving.current = { id: found.id, kind: "obj", idx: -1, last: p, origin: doc, moved: false };
        if (found.k === "text") setTextInput(found.text);
      }
      return;
    }

    if (tool === "text") {
      if (!textInput.trim()) { alert("Escribe un texto primero."); return; }
      const o: Obj = { id: newId(), k: "text", p: inBase(p), text: textInput.trim(), size: textSize, color: textColor, bg: textBg, bold };
      setObjects([...objects, o]);
      setSelId(o.id);
      setTool("select");
      return;
    }

    if (tool === "line") {
      setDraftPts([...draftPts, inBase(p)]);
      return;
    }

    if (tool === "crop") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const h = cropRect ? cropHit(cropRect, p, cropTol()) : null;
      if (h && cropRect) {
        cropDrag.current = { mode: h, start: p, orig: cropRect };
      } else {
        const a = inBase(p);
        cropDrag.current = { mode: "new", start: a, orig: { x: a.x, y: a.y, w: 0, h: 0 } };
        setCropRect({ x: a.x, y: a.y, w: 0, h: 0 });
      }
      return;
    }

    // figuras de arrastre (flecha, rectángulo, óvalo, difuminar)
    e.currentTarget.setPointerCapture(e.pointerId);
    const a = inBase(p);
    setDragShape({ a, b: a });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!doc) return;
    const p = toImage(e);

    const m = moving.current;
    if (m && e.buttons) {
      const dx = p.x - m.last.x, dy = p.y - m.last.y;
      if (!m.moved && Math.hypot(dx, dy) < 2 * pxScale) return;
      m.moved = true;
      m.last = p;
      if (m.kind === "v") {
        const q = inBase(p);
        setDoc((d) => d && { ...d, objects: d.objects.map((o) => (o.id === m.id ? setHandle(o, m.idx, q) : o)) });
      } else {
        setDoc((d) => d && { ...d, objects: d.objects.map((o) => (o.id === m.id ? mapObj(o, (pt) => ({ x: pt.x + dx, y: pt.y + dy })) : o)) });
      }
      return;
    }
    if (dragShape && e.buttons) setDragShape({ a: dragShape.a, b: inBase(p) });
    const cd = cropDrag.current;
    if (cd && base && e.buttons) {
      if (cd.mode === "new") {
        const b = inBase(constrain(cd.start, p));
        setCropRect({ x: Math.min(cd.start.x, b.x), y: Math.min(cd.start.y, b.y), w: Math.abs(b.x - cd.start.x), h: Math.abs(b.y - cd.start.y) });
      } else if (cd.mode === "move") {
        const dx = p.x - cd.start.x, dy = p.y - cd.start.y;
        setCropRect({ ...cd.orig, x: clampN(cd.orig.x + dx, 0, base.width - cd.orig.w), y: clampN(cd.orig.y + dy, 0, base.height - cd.orig.h) });
      } else {
        setCropRect(resizeCrop(cd.orig, cd.mode, p, ratio, base.width, base.height));
      }
    }
  }

  function onPointerUp() {
    if (cropDrag.current) {
      cropDrag.current = null;
      setCropRect((r) => (r && (r.w < MIN_CROP || r.h < MIN_CROP) ? null : r));
      return;
    }
    if (moving.current) {
      const m = moving.current;
      moving.current = null;
      if (m.moved) { setPast((pp) => [...pp.slice(-(MAX_HISTORY - 1)), m.origin]); setFuture([]); }
      return;
    }
    if (dragShape && doc) {
      const big = Math.hypot(dragShape.b.x - dragShape.a.x, dragShape.b.y - dragShape.a.y) > 8 * pxScale;
      if (big && (tool === "arrow" || tool === "rect" || tool === "ellipse")) {
        const o: Obj = { id: newId(), ...shapeFromDrag(tool, dragShape.a, dragShape.b, { color, w: width, dashed: dashedShape, smooth: curve }) };
        setObjects([...objects, o]);
        setSelId(o.id); setSelVertex(null); setTool("select"); // para ajustarla enseguida por puntos
      } else if (big && tool === "blur") {
        const o: Obj = { id: newId(), k: "blur", ...dragShape };
        setObjects([...objects, o]);
        setSelId(o.id); setTool("select");
      }
      setDragShape(null);
    }
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (tool === "line") { finishLine(); return; }
    if (tool === "select" && selPoly) {
      const p = pointOf(e.clientX, e.clientY);
      const i = selPoly.pts.findIndex((h) => dist(h, p) <= 13 * pxScale);
      if (i >= 0) removeVertex(i);
    }
  }

  // ---------- acciones ----------
  function finishLine() {
    if (draftPts.length >= 2) {
      const o: Obj = { id: newId(), k: "poly", pts: draftPts, closed: false, smooth: curve, dashed: dashedLine, arrow: false, color, w: width };
      setObjects([...objects, o]);
      setSelId(o.id); setSelVertex(null); setTool("select");
    }
    setDraftPts([]);
  }

  function deleteSelected() {
    if (selId == null) return;
    setObjects(objects.filter((o) => o.id !== selId));
    setSelId(null); setSelVertex(null);
  }

  function clearAll() {
    if (!objects.length && !draftPts.length) return;
    setObjects([]); setDraftPts([]); setSelId(null); setSelVertex(null);
  }

  function patchPoly(patch: Partial<Poly>) {
    if (selId == null) return;
    setObjects(objects.map((o) => (o.id === selId && o.k === "poly" ? { ...o, ...patch } : o)));
  }
  function patchSelected(patch: Record<string, unknown>) {
    if (selId == null) return;
    setObjects(objects.map((o) => (o.id === selId ? ({ ...o, ...patch } as Obj) : o)));
  }

  function removeVertex(i: number) {
    if (!selPoly) return;
    const min = selPoly.closed ? 3 : 2;
    if (selPoly.pts.length <= min) { alert(selPoly.closed ? "Una figura cerrada necesita al menos 3 puntos." : "Una línea necesita al menos 2 puntos."); return; }
    patchPoly({ pts: selPoly.pts.filter((_, j) => j !== i) });
    setSelVertex(null);
  }

  function scaleSelected(k: number) {
    if (!selected || !doc) return;
    const bb = boundsImg(canvasRef.current!.getContext("2d")!, selected, u);
    if (!bb) return;
    const c = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
    if (selected.k === "text") { patchSelected({ size: Math.max(8, Math.round(selected.size * k)) }); return; }
    setObjects(objects.map((o) => (o.id === selected.id ? mapObj(o, (p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k })) : o)));
  }

  function duplicateSelected() {
    if (!selected) return;
    const off = 16 * u;
    const copy = { ...mapObj(selected, (p) => ({ x: p.x + off, y: p.y + off })), id: newId() } as Obj;
    setObjects([...objects, copy]);
    setSelId(copy.id);
  }

  const textMode = tool === "text" || (tool === "select" && selected?.k === "text");
  const activeColor = textMode ? (selected?.k === "text" ? selected.color : textColor) : (selPoly?.color ?? color);
  const changeColor = (c: string) => {
    if (textMode) setTextColor(c); else setColor(c);
    if (selected && selected.k !== "blur") patchSelected({ color: c });
  };
  const changeWidth = (w: number) => {
    setWidth(w);
    if (selPoly) patchPoly({ w });
  };

  const drawTool = tool === "line" || tool === "arrow" || tool === "rect" || tool === "ellipse";
  const dashedVal = selPoly ? selPoly.dashed : tool === "line" ? dashedLine : dashedShape;
  const curveVal = selPoly ? selPoly.smooth : curve;
  const toggleDashed = () => {
    if (selPoly) patchPoly({ dashed: !selPoly.dashed });
    else if (tool === "line") setDashedLine(!dashedLine); else setDashedShape(!dashedShape);
  };
  const toggleCurve = () => { if (selPoly) patchPoly({ smooth: !selPoly.smooth }); else setCurve(!curve); };

  function rotate(cw: boolean) {
    if (!doc) return;
    const H = doc.base.height, W = doc.base.width;
    const f = cw ? (p: Point) => ({ x: H - p.y, y: p.x }) : (p: Point) => ({ x: p.y, y: W - p.x });
    commit({ base: rotateBase(doc.base, cw), objects: doc.objects.map((o) => mapObj(o, f)) });
    setCropRect(null); setDraftPts([]);
  }

  function startCrop(r0?: CropR) {
    if (!base) return;
    const m = Math.round(Math.min(base.width, base.height) * 0.04);
    const r = r0 ?? { x: m, y: m, w: base.width - 2 * m, h: base.height - 2 * m };
    setCropRect(ratio && !r0 ? fitRatio(r, ratio, base.width, base.height) : r);
  }

  function changeRatio(v: number | null) {
    setRatio(v);
    if (v && cropRect && base) setCropRect(fitRatio(cropRect, v, base.width, base.height));
  }

  function applyCrop() {
    if (!doc || !cropRect) return;
    const { x, y, w, h } = cropRect;
    if (w < MIN_CROP || h < MIN_CROP) { alert("El recorte es demasiado pequeño."); return; }
    commit({
      base: cropBase(doc.base, { x, y, w, h }),
      objects: doc.objects.map((o) => mapObj(o, (p) => ({ x: p.x - Math.round(x), y: p.y - Math.round(y) }))),
    });
    setCropRect(null);
    setTool("select");
  }

  const dirty = past.length > 0 || !isNeutral(adj) || draftPts.length > 0;

  function close() {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Cerrar de todos modos?")) return;
    onClose();
  }

  // ---------- IA ----------
  async function aiAdjust(prompt: string) {
    if (!doc) return;
    setAiBusy(true); setAiNote(null);
    try {
      const { data } = await api.post("/imageai/adjust", { image: toDataUrl(doc.base), prompt }, { timeout: 90000 });
      setAdj({ ...NEUTRAL, ...data.adjust });
      const W = doc.base.width, H = doc.base.height;
      const blurs: Obj[] = (data.blur ?? []).map((b: { x: number; y: number; w: number; h: number }) => ({
        id: newId(), k: "blur", a: { x: b.x * W, y: b.y * H }, b: { x: (b.x + b.w) * W, y: (b.y + b.h) * H },
      }));
      if (blurs.length) commit({ ...doc, objects: [...doc.objects, ...blurs] });
      if (data.crop) { setTool("crop"); setCropRect({ x: data.crop.x * W, y: data.crop.y * H, w: data.crop.w * W, h: data.crop.h * H }); }
      setAiNote(data.note + (blurs.length ? ` (${blurs.length} zona(s) difuminada(s))` : "") + (data.crop ? " Revisa el recorte y pulsa «Aplicar recorte»." : ""));
    } catch (e) {
      setAiNote(apiErrorMessage(e, "No se pudo usar la IA."));
    } finally { setAiBusy(false); }
  }

  async function aiEdit(prompt: string) {
    if (!doc || !prompt.trim()) return;
    if (!confirm("La edición generativa CAMBIA el contenido de la foto (no solo los colores). No la uses si la imagen es evidencia que no debe alterarse. ¿Continuar?")) return;
    setAiBusy(true); setAiNote(null);
    try {
      const blob: Blob | null = await new Promise((res) => adjustCanvas(doc.base, adj).toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("No se pudo preparar la imagen.");
      const form = new FormData();
      form.append("file", blob, "foto.jpg");
      form.append("prompt", prompt);
      const { data } = await api.post("/imageai/edit", form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 240000 });
      const nb = await loadBase(data.image);
      const kx = nb.width / doc.base.width, ky = nb.height / doc.base.height;
      commit({ base: nb, objects: doc.objects.map((o) => mapObj(o, (p) => ({ x: p.x * kx, y: p.y * ky }))) });
      setAdj(NEUTRAL);
      setAiNote("Listo: la imagen fue modificada por la IA. Puedes deshacer con «Deshacer».");
    } catch (e) {
      setAiNote(apiErrorMessage(e, "No se pudo editar la imagen con IA."));
    } finally { setAiBusy(false); }
  }

  const smartLocal = () => setAdj({ ...NEUTRAL, auto: true, shadows: 30, highlights: 15, sharpen: 45, denoise: 20, saturation: 8 });

  // ---------- guardar (a resolución completa) ----------
  async function save() {
    if (!doc) return;
    setSaving(true); setSaveError(null);
    try {
      let objs = doc.objects;
      if (draftPts.length >= 2) {
        objs = [...objs, { id: newId(), k: "poly", pts: draftPts, closed: false, smooth: curve, dashed: dashedLine, arrow: false, color, w: width }];
      }
      await new Promise((r) => setTimeout(r, 30));
      const full = adjustCanvas(doc.base, adj);
      const out = document.createElement("canvas");
      out.width = full.width; out.height = full.height;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(full, 0, 0);
      renderObjects(ctx, objs, 1, unitOf(out), full);
      const blob: Blob | null = await new Promise((res) => out.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("No se pudo crear la imagen.");
      const form = new FormData();
      form.append("file", blob, "editada.jpg");
      const { data } = await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      onSaved(data.path, data.url);
      onClose();
    } catch (e) {
      setSaveError(apiErrorMessage(e, "No se pudo guardar la imagen editada."));
    } finally { setSaving(false); }
  }

  // ---------- atajos de teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.key === "Delete" || e.key === "Backspace") { selVertex != null && selPoly ? removeVertex(selVertex) : deleteSelected(); }
      else if (e.key === "Enter" && draftPts.length) finishLine();
      else if (e.key === "Escape") { setDraftPts([]); setMenu(null); setSelVertex(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ============================================================
  // INTERFAZ: todo el espacio para la imagen; botones pequeños y menús desplegables
  // ============================================================

  const ib = (active = false, extra = "") =>
    `inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[11px] font-semibold leading-none transition-colors disabled:opacity-40 ${
      active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    } ${extra}`;
  const mi = "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40";

  const TOOLS: [Tool, string, string][] = [
    ["select", "Mover", "Seleccionar y editar por puntos"],
    ["line", "Línea", "Línea por puntos (doble toque para terminar)"],
    ["arrow", "Flecha", "Flecha: arrastra"],
    ["rect", "Rect.", "Rectángulo: arrastra"],
    ["ellipse", "Óvalo", "Óvalo: arrastra"],
    ["text", "Texto", "Texto"],
    ["blur", "Difuminar", "Difuminar zona"],
    ["crop", "Recortar", "Recortar"],
  ];

  function pickTool(t: Tool) {
    setTool(t);
    setDraftPts([]); setDragShape(null); setSelVertex(null);
    if (t === "crop") startCrop(); else setCropRect(null);
    if (t !== "select") setSelId(null);
  }

  const showColors = drawTool || textMode || (tool === "select" && selected && selected.k !== "blur");
  const showWidth = (drawTool || selPoly) && !textMode;
  const hasContext = showColors || textMode || tool === "crop" || selected != null;
  const sel = "h-7 rounded-md border border-slate-300 bg-white px-1.5 text-[11px]";

  const slider = (label: string, key: keyof Adjust, min: number, max = 100) => (
    <label className="flex items-center gap-2 text-[11px] text-slate-600">
      <span className="w-16 shrink-0">{label}</span>
      <input type="range" min={min} max={max} value={Number(adj[key])} onChange={(e) => setAdj({ ...adj, [key]: Number(e.target.value) })} className="h-1 w-full" />
      <span className="w-7 text-right tabular-nums">{Number(adj[key])}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100" role="dialog" aria-label="Editar imagen">
      {/* Barra superior mínima */}
      <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-1.5">
        <button onClick={close} className={ib()} aria-label="Cerrar">Cerrar</button>
        <span className="hidden truncate px-1 text-xs font-semibold text-slate-600 sm:block">Editar imagen</span>
        <div className="flex-1" />
        {saveError && <span role="alert" className="max-w-[35%] truncate text-[11px] text-red-600" title={saveError}>{saveError}</span>}
        <button onClick={undo} disabled={!past.length} className={ib()} title="Deshacer (Ctrl+Z)">Deshacer</button>
        <button onClick={redo} disabled={!future.length} className={ib()} title="Rehacer (Ctrl+Y)">Rehacer</button>
        <button className={ib(panel === "ai", "gap-1")} onClick={() => setPanel(panel === "ai" ? null : "ai")} title="Mejorar o cambiar la imagen con IA">IA</button>
        <button className={ib(panel === "adjust" || !isNeutral(adj))} onClick={() => setPanel(panel === "adjust" ? null : "adjust")} title="Brillo, contraste, nitidez…">Ajustes</button>
        <div className="relative">
          <button className={ib(menu === "img")} onClick={() => setMenu(menu === "img" ? null : "img")} aria-haspopup="menu">Más ▾</button>
          {menu === "img" && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
              <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <button className={mi} onClick={() => { rotate(false); setMenu(null); }}>Girar a la izquierda</button>
                <button className={mi} onClick={() => { rotate(true); setMenu(null); }}>Girar a la derecha</button>
                <button className={mi} onClick={() => { setShowOrig(!showOrig); setMenu(null); }}>{showOrig ? "Ver con ajustes" : "Ver original"}</button>
                <button className={mi} disabled={!objects.length} onClick={() => { clearAll(); setMenu(null); }}>Quitar todas las marcas</button>
              </div>
            </>
          )}
        </div>
        <button onClick={save} disabled={saving || !doc} className="inline-flex h-7 shrink-0 items-center rounded-md bg-brand-600 px-3 text-[11px] font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>

      {/* Opciones de la herramienta: una sola fila fina, solo cuando hacen falta */}
      {hasContext && (
        <div className="relative flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white/90 px-1.5">
          {showColors && (
            <div className="flex shrink-0 items-center gap-1">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => changeColor(c)}
                  className={`h-4 w-4 rounded-full border-2 ${activeColor === c ? "border-brand-600 ring-2 ring-brand-300" : "border-slate-300"}`} style={{ background: c }} />
              ))}
              <input type="color" value={activeColor} onChange={(e) => changeColor(e.target.value)} className="h-5 w-6 cursor-pointer rounded border border-slate-300 p-0" aria-label="Otro color" />
            </div>
          )}
          {showWidth && (
            <select className={sel} value={selPoly?.w ?? width} onChange={(e) => changeWidth(Number(e.target.value))} aria-label="Grosor">
              {WIDTHS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {(drawTool || selPoly) && (
            <>
              <button type="button" className={ib(dashedVal)} onClick={toggleDashed} title="Convertir en línea punteada">Punteada</button>
              <button type="button" className={ib(curveVal)} onClick={toggleCurve} title="Suavizar: convierte los tramos rectos en curva (por ejemplo, un rectángulo en óvalo)">Curva</button>
            </>
          )}
          {selPoly && !selPoly.closed && (
            <button type="button" className={ib(selPoly.arrow)} onClick={() => patchPoly({ arrow: !selPoly.arrow })} title="Punta de flecha al final">Flecha</button>
          )}
          {tool === "line" && (
            <>
              <button className={ib()} onClick={finishLine} disabled={draftPts.length < 2}>Terminar</button>
              <button className={ib()} onClick={() => setDraftPts(draftPts.slice(0, -1))} disabled={!draftPts.length}>Quitar punto</button>
            </>
          )}
          {textMode && (
            <>
              <input type="text" className={`${sel} w-36 shrink-0`} placeholder="Escribe el texto..." value={textInput}
                onChange={(e) => { setTextInput(e.target.value); if (selected?.k === "text" && e.target.value.trim()) patchSelected({ text: e.target.value }); }} />
              <select className={sel} value={selected?.k === "text" ? selected.size : textSize} aria-label="Tamaño del texto"
                onChange={(e) => { const v = Number(e.target.value); setTextSize(v); if (selected?.k === "text") patchSelected({ size: v }); }}>
                {[18, 24, 28, 36, 44, 56, 72].map((v) => <option key={v} value={v}>{v} px</option>)}
              </select>
              <select className={sel} value={selected?.k === "text" ? selected.bg : textBg} aria-label="Fondo del texto"
                onChange={(e) => { const v = e.target.value as TextBg; setTextBg(v); if (selected?.k === "text") patchSelected({ bg: v }); }}>
                <option value="dark">Fondo oscuro</option><option value="light">Fondo claro</option><option value="none">Sin fondo</option>
              </select>
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600">
                <input type="checkbox" checked={selected?.k === "text" ? selected.bold : bold}
                  onChange={(e) => { setBold(e.target.checked); if (selected?.k === "text") patchSelected({ bold: e.target.checked }); }} />Negrita
              </label>
            </>
          )}
          {tool === "crop" && (
            <>
              <select className={sel} value={ratio ?? ""} onChange={(e) => changeRatio(e.target.value ? Number(e.target.value) : null)} aria-label="Proporción">
                {RATIOS.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
              </select>
              <button className={ib()} onClick={() => startCrop()}>Todo</button>
              <button className="inline-flex h-7 shrink-0 items-center rounded-md bg-brand-600 px-2.5 text-[11px] font-bold text-white disabled:opacity-50" onClick={applyCrop} disabled={!cropRect}>Aplicar recorte</button>
            </>
          )}
          {tool === "select" && selected && (
            <div className="relative ml-auto shrink-0">
              <button className={ib(menu === "more")} onClick={() => setMenu(menu === "more" ? null : "more")}>Más opciones ▾</button>
              {menu === "more" && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                  <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    {selPoly && <button className={mi} disabled={selVertex == null} onClick={() => { if (selVertex != null) removeVertex(selVertex); setMenu(null); }}>Quitar el punto elegido</button>}
                    {selPoly && selPoly.pts.length >= 3 && <button className={mi} onClick={() => { patchPoly({ closed: !selPoly.closed, arrow: selPoly.closed ? selPoly.arrow : false }); setMenu(null); }}>{selPoly.closed ? "Abrir figura" : "Cerrar figura"}</button>}
                    <button className={mi} onClick={() => { scaleSelected(1.15); setMenu(null); }}>Agrandar</button>
                    <button className={mi} onClick={() => { scaleSelected(0.87); setMenu(null); }}>Achicar</button>
                    <button className={mi} onClick={() => { duplicateSelected(); setMenu(null); }}>Duplicar</button>
                    <button className={`${mi} text-red-600`} onClick={() => { deleteSelected(); setMenu(null); }}>Borrar</button>
                    {selPoly && <p className="px-2.5 pb-1 pt-1 text-[10px] leading-snug text-slate-500">Arrastra los puntos para dar forma. El círculo con «+» entre dos puntos agrega uno nuevo. Doble toque sobre un punto lo quita.</p>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* Herramientas: columna delgada (en celular, fila deslizable) */}
        <div className="flex shrink-0 gap-1 overflow-auto border-slate-200 bg-white p-1 max-sm:border-b sm:w-[78px] sm:flex-col sm:border-r">
          {TOOLS.map(([t, label, title]) => (
            <button key={t} type="button" className={ib(tool === t, "sm:w-full sm:justify-start sm:px-2")} onClick={() => pickTool(t)} title={title} aria-label={title}>
              {label}
            </button>
          ))}
        </div>

        {/* Imagen: ocupa todo el espacio restante */}
        <div ref={areaRef} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-slate-200 p-[3px]">
          {loadError ? (
            <p role="alert" className="text-sm text-red-600">{loadError}</p>
          ) : !doc ? (
            <p className="text-sm text-slate-500">Cargando imagen...</p>
          ) : (
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick}
              className={`block shrink-0 bg-white shadow-lg ${tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
              style={{ width: fit?.w, height: fit?.h, touchAction: "none" }}
            />
          )}

          {panel === "adjust" && (
            <div className="absolute right-2 top-2 z-10 w-[min(300px,calc(100%-16px))] rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between"><b className="text-xs text-slate-700">Ajustes de imagen</b><button className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setPanel(null)}>Cerrar</button></div>
              <div className="space-y-1">
                {slider("Brillo", "brightness", -100)}{slider("Contraste", "contrast", -100)}{slider("Color", "saturation", -100)}
                {slider("Sombras", "shadows", 0)}{slider("Luces", "highlights", 0)}{slider("Calidez", "warmth", -100)}
                {slider("Nitidez", "sharpen", 0)}{slider("Menos ruido", "denoise", 0)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className={ib(adj.auto)} onClick={() => setAdj({ ...adj, auto: !adj.auto })}>Auto</button>
                <button className={ib(adj.gray)} onClick={() => setAdj({ ...adj, gray: !adj.gray })}>Blanco y negro</button>
                <button className={ib()} onClick={smartLocal} title="Niveles, sombras, nitidez y ruido en un clic">Mejora rápida</button>
                <button className={ib()} onClick={() => setAdj(NEUTRAL)} disabled={isNeutral(adj)}>Quitar ajustes</button>
              </div>
            </div>
          )}

          {panel === "ai" && (
            <div className="absolute right-2 top-2 z-10 w-[min(340px,calc(100%-16px))] rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl">
              <div className="mb-1.5 flex items-center justify-between"><b className="text-xs text-slate-700">Mejorar con IA</b><button className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setPanel(null)}>Cerrar</button></div>
              <textarea className="input min-h-[64px] text-xs" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Dime qué quieres: «aclara las sombras y enfoca el texto», «recorta al equipo», «difumina las caras»…" />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {AI_CHIPS.map((c) => <button key={c} className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] text-slate-600 hover:border-brand-400" onClick={() => setAiPrompt(c)}>{c}</button>)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="btn-primary px-3 py-1.5 text-xs" disabled={aiBusy || !aiStatus?.adjust} onClick={() => aiAdjust(aiPrompt)}>{aiBusy ? "Trabajando…" : "Analizar y ajustar"}</button>
                <button className="btn-secondary px-3 py-1.5 text-xs" onClick={smartLocal}>Mejora rápida (sin IA)</button>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
                {aiStatus?.adjust ? "La IA mira la foto y elige ajustes, recortes y zonas a difuminar sin inventar nada: segura para evidencias." : "IA no configurada en el servidor (falta ANTHROPIC_API_KEY): usa la mejora rápida."}
              </p>
              <div className="mt-2 border-t border-slate-200 pt-2">
                <b className="text-[11px] text-slate-700">Cambiar la imagen (generativa)</b>
                <div className="mt-1 flex flex-wrap gap-1">
                  {EDIT_CHIPS.map((c) => <button key={c} className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] text-slate-600 hover:border-brand-400" onClick={() => setAiPrompt(c)}>{c}</button>)}
                </div>
                <button className="btn-secondary mt-1.5 px-3 py-1.5 text-xs" disabled={aiBusy || !aiStatus?.edit || !aiPrompt.trim()} onClick={() => aiEdit(aiPrompt)}>Transformar con IA</button>
                <p className="mt-1 text-[10.5px] leading-snug text-slate-500">
                  {aiStatus?.edit ? "Modifica el contenido de la foto según tu instrucción. Se puede deshacer." : "No disponible: el servidor necesita OPENAI_API_KEY para editar imágenes."}
                </p>
              </div>
              {aiNote && <p className="mt-2 rounded-md bg-slate-100 p-2 text-[11px] text-slate-700">{aiNote}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

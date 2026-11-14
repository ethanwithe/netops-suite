import { ToolIcon } from "../components/ToolIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { iconSize, iconUrl, uploadIcon, useIcons } from "./icons";
import PropsPanel from "./Props";
import { fill, resolveDoc } from "./templates";
import { PAD_X } from "./fit";
import type { Fields } from "./templates";
import type { Cell, Doc, El, ImgEl, LineEl, TableEl, TextEl } from "./types";
import { bbox, isLine } from "./types";
import type { useUndo } from "./useUndo";

type Hist = ReturnType<typeof useUndo<Doc>>;
const PT = 1.2698;
const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const rad = (d: number) => (d * Math.PI) / 180;

type G =
  | { k: "move"; sx: number; sy: number; orig: Map<string, El>; moved: boolean }
  | { k: "resize"; id: string; hx: number; hy: number; sx: number; sy: number; orig: El; moved: boolean }
  | { k: "rotate"; id: string; cx: number; cy: number; orig: El; moved: boolean }
  | { k: "end"; id: string; which: 1 | 2; sx: number; sy: number; orig: LineEl; moved: boolean }
  | { k: "marquee"; sx: number; sy: number; add: boolean; base: string[] };

function shift(e: El, dx: number, dy: number): El {
  return isLine(e) ? { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy } : { ...e, x: e.x + dx, y: e.y + dy };
}

function label(e: El, icons: { id: string; name: string }[]): string {
  if (e.type === "text") return e.text.replace(/\s+/g, " ").trim().slice(0, 28) || "Texto";
  if (e.type === "image") return icons.find((i) => i.id === e.icon)?.name ?? "Icono";
  if (e.type === "rect") return e.text?.trim() ? e.text.slice(0, 28) : "Forma";
  if (e.type === "line") return "Línea";
  return "Tabla";
}

const dashCss = (d?: string) => (d === "dot" || d === "sysDot" ? "dotted" : d ? "dashed" : "solid");
const dashArray = (d: string | undefined, w: number) => {
  const m: Record<string, number[]> = { dash: [4, 3], lgDash: [8, 3], sysDash: [3, 1], dot: [1, 2], sysDot: [1, 2], dashDot: [4, 3, 1, 3] };
  return d && m[d] ? m[d].map((n) => n * Math.max(1, w)).join(" ") : undefined;
};

function TextLines({ text, size, lineH, spcBef, bold, italic, color, align, nowrap, family }: { family?: string; text: string; size: number; lineH?: number | null; spcBef?: number; bold?: boolean; italic?: boolean; color?: string; align?: string; nowrap?: boolean }) {
  const f = size * PT;
  return (
    <div style={{ fontFamily: family ?? "Arial, Helvetica, sans-serif", fontSize: f, fontWeight: bold ? 700 : 400, fontStyle: italic ? "italic" : "normal", color, textAlign: align === "c" ? "center" : align === "r" ? "right" : align === "j" ? "justify" : "left", whiteSpace: nowrap ? "pre" : "pre-wrap", wordBreak: "break-word", lineHeight: lineH ? `${lineH}px` : `${f * 1.17}px` }}>
      {text.split("\n").map((ln, i) => <div key={i} style={{ marginTop: i > 0 ? spcBef || 0 : 0, minHeight: lineH || f * 1.17 }}>{ln || " "}</div>)}
    </div>
  );
}

function Marker({ id, kind, color }: { id: string; kind: string; color: string }) {
  if (!kind || kind === "none") return null;
  const path = kind === "oval" ? <circle cx="5" cy="5" r="4" fill={color} /> : kind === "diamond" ? <path d="M1 5L5 1L9 5L5 9Z" fill={color} /> : kind === "arrow" ? <path d="M1 1L9 5L1 9" fill="none" stroke={color} strokeWidth="1.6" /> : <path d="M0 0L10 5L0 10Z" fill={color} />;
  return <marker id={id} viewBox="0 0 10 10" refX={kind === "oval" || kind === "diamond" ? 5 : 9} refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">{path}</marker>;
}

function ElView({ e, shown, icons }: { e: El; shown: El; icons: unknown }) {
  void icons;
  const common = { position: "absolute" as const, pointerEvents: "auto" as const };
  if (e.type === "line") {
    const l = e as LineEl;
    const hid = `mh-${l.id}`, tid = `mt-${l.id}`;
    return (
      <svg data-id={l.id} style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "visible", pointerEvents: "none" }}>
        <defs><Marker id={hid} kind={l.head ?? "none"} color={l.stroke} /><Marker id={tid} kind={l.tail ?? "none"} color={l.stroke} /></defs>
        <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.stroke} strokeWidth={l.strokeW} strokeDasharray={dashArray(l.dash, l.strokeW)} markerStart={l.head && l.head !== "none" ? `url(#${hid})` : undefined} markerEnd={l.tail && l.tail !== "none" ? `url(#${tid})` : undefined} />
        <line data-id={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={Math.max(16, l.strokeW + 10)} style={{ pointerEvents: "stroke" }} />
      </svg>
    );
  }
  const rot = (e as TextEl).rot ? { transform: `rotate(${(e as TextEl).rot}deg)` } : {};
  const box = { ...common, left: e.x, top: e.y, width: e.w, height: e.h, ...rot };
  if (e.type === "text") {
    const t = shown as TextEl;
    // Con color de fondo: la caja ya ajustada (fitText), con aire a los lados y el texto centrado en vertical, como en PPTX/PDF.
    const vAl = (v: string | undefined, dflt: string) => ((v ?? dflt) === "b" ? "flex-end" : (v ?? dflt) === "m" ? "center" : "flex-start");
    if (t.fill) return <div data-id={e.id} style={{ ...box, left: t.x, top: t.y, width: t.w, height: t.h, background: t.fill, boxSizing: "border-box", padding: `0 ${PAD_X}px`, display: "flex", alignItems: vAl(t.valign, "m") }}><div style={{ width: "100%" }}><TextLines {...t} /></div></div>;
    return <div data-id={e.id} style={{ ...box, background: "transparent", display: "flex", alignItems: vAl(t.valign, "t") }}><div style={{ width: "100%" }}><TextLines {...t} /></div></div>;
  }
  if (e.type === "rect" && !e.fill && !e.text?.trim()) {
    // Marco sin relleno: solo se puede elegir por el borde (así no tapa lo que hay debajo), como en PowerPoint.
    const sw = e.stroke && e.strokeW ? e.strokeW : 0;
    return (
      <svg data-id={e.id} style={{ ...box, overflow: "visible", pointerEvents: "none" }} width={e.w} height={e.h}>
        {sw > 0 && <rect x={sw / 2} y={sw / 2} width={Math.max(0, e.w - sw)} height={Math.max(0, e.h - sw)} fill="none" stroke={e.stroke!} strokeWidth={sw} strokeDasharray={dashArray(e.dash, sw)} />}
        <rect data-id={e.id} x={0} y={0} width={e.w} height={e.h} fill="none" stroke="transparent" strokeWidth={Math.max(16, sw + 10)} style={{ pointerEvents: "stroke" }} />
      </svg>
    );
  }
  if (e.type === "rect") {
    const r = shown as typeof e;
    return (
      <div data-id={e.id} style={{ ...box, boxSizing: "border-box", background: r.fill ?? "transparent", border: r.stroke && r.strokeW ? `${r.strokeW}px ${dashCss(r.dash)} ${r.stroke}` : "none", display: "flex", alignItems: r.valign === "b" ? "flex-end" : r.valign === "t" ? "flex-start" : "center" }}>
        {r.text?.trim() ? <div style={{ width: "100%" }}><TextLines text={r.text} size={r.size ?? 16} bold={r.bold} italic={r.italic} color={r.color ?? "#000"} align={r.align ?? "c"} /></div> : null}
      </div>
    );
  }
  if (e.type === "image") {
    return <img data-id={e.id} src={iconUrl((e as ImgEl).icon)} alt="" draggable={false} style={{ ...box, objectFit: "fill", userSelect: "none" }} />;
  }
  const t = shown as TableEl;
  return (
    <table data-id={e.id} style={{ ...box, tableLayout: "fixed", borderCollapse: "collapse", width: e.w, height: e.h }}>
      <colgroup>{t.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <tbody>
        {t.rows.map((row, r) => (
          <tr key={r} style={{ height: row.h }}>
            {row.cells.map((c: Cell, ci) => c.merged ? null : (
              <td key={ci} data-r={r} data-c={ci} colSpan={c.span || 1} style={{ border: "1px solid #fff", padding: 0, verticalAlign: c.valign === "t" ? "top" : c.valign === "b" ? "bottom" : "middle", overflow: "hidden", background: c.grad?.colors?.length ? `linear-gradient(${(c.grad.ang ?? 90) + 90}deg, ${c.grad.colors.join(",")})` : c.fill ?? "transparent" }}>
                <TextLines family={'Calibri, Carlito, "Liberation Sans", Arial, sans-serif'} text={c.text} size={c.size} bold={c.bold} italic={c.italic} color={c.color} align={c.align} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Editor({ doc, fields, hist }: { doc: Doc; fields: Fields; hist: Hist }) {
  const { icons } = useIcons();
  const shownDoc = useMemo(() => resolveDoc(doc, fields), [doc, fields]);
  const [sel, setSel] = useState<string[]>([]);
  const [selCell, setSelCell] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; r?: number; c?: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<"iconos" | "capas">("iconos");
  const [q, setQ] = useState("");
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [fit, setFit] = useState(0.5);
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const g = useRef<G | null>(null);
  const clip = useRef<El[]>([]);
  const docRef = useRef(doc); docRef.current = doc;
  const selRef = useRef(sel); selRef.current = sel;
  const fileIn = useRef<HTMLInputElement>(null);
  const scale = fit * zoom;
  const scaleRef = useRef(scale); scaleRef.current = scale;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.max(0.15, (el.clientWidth - 2) / doc.w)));
    ro.observe(el);
    setFit(Math.max(0.15, (el.clientWidth - 2) / doc.w));
    return () => ro.disconnect();
  }, [doc.w]);

  // Si el documento cambia por completo (otro cliente, otra plantilla), se limpia la selección.
  useEffect(() => { setSel((s) => s.filter((id) => doc.elements.some((e) => e.id === id))); }, [doc]);

  const els = doc.elements;
  const byId = (id: string) => els.find((e) => e.id === id);
  const setEls = (next: El[], mode: "commit" | "live" = "commit") => (mode === "commit" ? hist.commit : hist.live)({ ...docRef.current, elements: next });
  const patchIds = (ids: string[], fn: (e: El) => El, mode: "commit" | "live" = "commit") => setEls(docRef.current.elements.map((e) => (ids.includes(e.id) && !e.locked ? fn(e) : e)), mode);
  const one = sel.length === 1 ? byId(sel[0]) ?? null : null;

  const toStage = (cx: number, cy: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (cx - r.left) / scaleRef.current, y: (cy - r.top) / scaleRef.current };
  };

  const add = (el: El) => { setEls([...docRef.current.elements, el]); setSel([el.id]); setSelCell(null); };
  const addText = () => add({ id: uid(), type: "text", x: 760, y: 480, w: 400, h: 40, text: "Texto", align: "c", size: 20, bold: true, italic: false, color: "#000000", fill: null });
  const addRect = () => add({ id: uid(), type: "rect", x: 700, y: 400, w: 500, h: 300, fill: null, stroke: "#4F81BD", strokeW: 2, dash: "" });
  const addLine = (arrow: boolean) => add({ id: uid(), type: "line", x1: 760, y1: 540, x2: 1160, y2: 540, stroke: "#000000", strokeW: 3, dash: "", head: "none", tail: arrow ? "triangle" : "none" });
  async function addIcon(id: string, at?: { x: number; y: number }) {
    const s = await iconSize(id);
    const k = Math.min(1, 220 / Math.max(s.w, s.h)) || 1;
    const w = Math.max(24, Math.round(s.w * k)), h = Math.max(24, Math.round(s.h * k));
    const cx = at?.x ?? doc.w / 2, cy = at?.y ?? doc.h / 2;
    add({ id: uid(), type: "image", x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, icon: id });
  }
  async function upload(f: File | undefined) {
    if (!f) return;
    try { const ic = await uploadIcon(f); await addIcon(ic.id); } catch { alert("No se pudo subir el icono (PNG, JPG, WEBP o GIF, máximo 4 MB)."); }
  }

  const remove = () => { if (sel.length) { setEls(els.filter((e) => !sel.includes(e.id) || e.locked)); setSel([]); setSelCell(null); } };
  const duplicate = () => {
    const copies = els.filter((e) => sel.includes(e.id)).map((e) => ({ ...shift(e, 24, 24), id: uid(), locked: false }));
    if (copies.length) { setEls([...els, ...copies]); setSel(copies.map((c) => c.id)); }
  };
  const order = (how: "front" | "back" | "up" | "down") => {
    const ids = sel; if (!ids.length) return;
    const picked = els.filter((e) => ids.includes(e.id)), rest = els.filter((e) => !ids.includes(e.id));
    if (how === "front") return setEls([...rest, ...picked]);
    if (how === "back") return setEls([...picked, ...rest]);
    const arr = [...els];
    const idx = arr.map((e, i) => (ids.includes(e.id) ? i : -1)).filter((i) => i >= 0);
    if (how === "up") for (const i of [...idx].reverse()) { if (i < arr.length - 1 && !ids.includes(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; }
    else for (const i of idx) { if (i > 0 && !ids.includes(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]; }
    setEls(arr);
  };

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (mod && k === "z") { ev.preventDefault(); ev.shiftKey ? hist.redo() : hist.undo(); }
      else if (mod && k === "y") { ev.preventDefault(); hist.redo(); }
      else if (mod && k === "a") { ev.preventDefault(); setSel(docRef.current.elements.map((e) => e.id)); }
      else if (mod && k === "d") { ev.preventDefault(); duplicate(); }
      else if (mod && k === "c") { clip.current = docRef.current.elements.filter((e) => selRef.current.includes(e.id)); }
      else if (mod && k === "v") {
        if (!clip.current.length) return;
        ev.preventDefault();
        const copies = clip.current.map((e) => ({ ...shift(e, 24, 24), id: uid() }));
        clip.current = copies.map((c) => ({ ...c }));
        hist.commit({ ...docRef.current, elements: [...docRef.current.elements, ...copies] }); setSel(copies.map((c) => c.id));
      }
      else if (k === "delete" || k === "backspace") { if (selRef.current.length) { ev.preventDefault(); remove(); } }
      else if (k === "escape") { setSel([]); setSelCell(null); }
      else if (k.startsWith("arrow") && selRef.current.length) {
        ev.preventDefault();
        const s = ev.shiftKey ? 10 : 1;
        const dx = k === "arrowleft" ? -s : k === "arrowright" ? s : 0, dy = k === "arrowup" ? -s : k === "arrowdown" ? s : 0;
        patchIds(selRef.current, (e) => shift(e, dx, dy));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // se vuelve a enlazar en cada render para ver siempre el documento actual

  // ---------- ratón ----------
  function onDown(ev: React.PointerEvent) {
    if (editing || ev.button !== 0) return;
    const t = ev.target as Element;
    const p = toStage(ev.clientX, ev.clientY);
    const handle = t.closest("[data-handle]")?.getAttribute("data-handle");
    const id = t.closest("[data-id]")?.getAttribute("data-id") ?? null;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);

    if (handle && one) {
      if (handle === "rot") { const b = bbox(one); g.current = { k: "rotate", id: one.id, cx: b.x + b.w / 2, cy: b.y + b.h / 2, orig: one, moved: false }; }
      else if (handle === "p1" || handle === "p2") g.current = { k: "end", id: one.id, which: handle === "p1" ? 1 : 2, sx: p.x, sy: p.y, orig: one as LineEl, moved: false };
      else { const [hx, hy] = handle.split(",").map(Number); g.current = { k: "resize", id: one.id, hx, hy, sx: p.x, sy: p.y, orig: one, moved: false }; }
      return;
    }
    if (id) {
      const el = byId(id);
      if (!el) return;
      const td = t.closest("td");
      if (el.type === "table" && td) setSelCell({ r: Number(td.getAttribute("data-r")), c: Number(td.getAttribute("data-c")) }); else setSelCell(null);
      let ids = sel;
      if (ev.shiftKey) ids = sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id];
      else if (!sel.includes(id)) ids = [id];
      setSel(ids);
      if (!el.locked && ids.includes(id)) g.current = { k: "move", sx: p.x, sy: p.y, orig: new Map(els.filter((e) => ids.includes(e.id)).map((e) => [e.id, e])), moved: false };
      return;
    }
    setSelCell(null);
    g.current = { k: "marquee", sx: p.x, sy: p.y, add: ev.shiftKey, base: ev.shiftKey ? sel : [] };
    if (!ev.shiftKey) setSel([]);
  }

  function onMove(ev: React.PointerEvent) {
    const s = g.current; if (!s) return;
    const p = toStage(ev.clientX, ev.clientY);
    if (s.k === "marquee") {
      const r = { x: Math.min(s.sx, p.x), y: Math.min(s.sy, p.y), w: Math.abs(p.x - s.sx), h: Math.abs(p.y - s.sy) };
      setMarquee(r);
      const hit = docRef.current.elements.filter((e) => { const b = bbox(e); return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y; }).map((e) => e.id);
      setSel([...new Set([...s.base, ...hit])]);
      return;
    }
    const dx = p.x - ("sx" in s ? s.sx : 0), dy = p.y - ("sy" in s ? s.sy : 0);
    if (!s.moved) {
      if (s.k !== "rotate" && Math.hypot(dx, dy) * scaleRef.current < 3) return;
      s.moved = true; hist.begin();
    }
    const live = (fn: (e: El) => El, ids: string[]) => patchIds(ids, fn, "live");
    if (s.k === "move") {
      live((e) => shift(s.orig.get(e.id) ?? e, dx, dy), [...s.orig.keys()]);
    } else if (s.k === "end") {
      live(() => (s.which === 1 ? { ...s.orig, x1: s.orig.x1 + dx, y1: s.orig.y1 + dy } : { ...s.orig, x2: s.orig.x2 + dx, y2: s.orig.y2 + dy }), [s.id]);
    } else if (s.k === "rotate") {
      let a = (Math.atan2(p.y - s.cy, p.x - s.cx) * 180) / Math.PI + 90;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      live((e) => ({ ...e, rot: Math.round(((a % 360) + 360) % 360) } as El), [s.id]);
    } else if (s.k === "resize") {
      const o = s.orig as Exclude<El, LineEl>;
      const r = rad(o.type === "table" ? 0 : (o as TextEl).rot ?? 0);
      const ldx = dx * Math.cos(-r) - dy * Math.sin(-r), ldy = dx * Math.sin(-r) + dy * Math.cos(-r);
      let w = o.w + s.hx * ldx, h = o.h + s.hy * ldy;
      if (o.type === "image" && s.hx !== 0 && s.hy !== 0) { const k = Math.max(w / o.w, h / o.h); w = o.w * k; h = o.h * k; }
      w = Math.max(8, w); h = Math.max(8, h);
      const lcx = (s.hx * (w - o.w)) / 2, lcy = (s.hy * (h - o.h)) / 2;
      const cx = o.x + o.w / 2 + lcx * Math.cos(r) - lcy * Math.sin(r), cy = o.y + o.h / 2 + lcx * Math.sin(r) + lcy * Math.cos(r);
      live((e) => {
        const base = { ...(e as typeof o), x: cx - w / 2, y: cy - h / 2, w, h };
        if (o.type === "table") { const kx = w / o.w, ky = h / o.h; return { ...base, cols: o.cols.map((c) => c * kx), rows: o.rows.map((rw) => ({ ...rw, h: rw.h * ky })) } as El; }
        return base as El;
      }, [s.id]);
    }
  }
  function onUp() { g.current = null; setMarquee(null); }

  function onDbl(ev: React.MouseEvent) {
    const t = ev.target as Element;
    const id = t.closest("[data-id]")?.getAttribute("data-id");
    const el = id ? byId(id) : null;
    if (!el || el.locked) return;
    if (el.type === "text" || el.type === "rect") setEditing({ id: el.id });
    else if (el.type === "table") { const td = t.closest("td"); if (td) setEditing({ id: el.id, r: Number(td.getAttribute("data-r")), c: Number(td.getAttribute("data-c")) }); }
  }

  function commitEdit(value: string) {
    if (!editing) return;
    const e = byId(editing.id);
    setEditing(null);
    if (!e) return;
    if (e.type === "text" || e.type === "rect") {
      if (value !== fill(e.text ?? "", fields)) patchIds([e.id], (x) => ({ ...x, text: value } as El));
    } else if (e.type === "table" && editing.r !== undefined && editing.c !== undefined) {
      const cell = e.rows[editing.r]?.cells[editing.c];
      if (cell && value !== fill(cell.text, fields)) patchIds([e.id], (x) => ({ ...(x as TableEl), rows: (x as TableEl).rows.map((row, r) => (r !== editing.r ? row : { ...row, cells: row.cells.map((c, ci) => (ci === editing.c ? { ...c, text: value } : c)) })) }));
    }
  }

  function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    const id = ev.dataTransfer.getData("text/icon-id");
    if (id) { const p = toStage(ev.clientX, ev.clientY); void addIcon(id, p); }
  }

  // ---------- vista ----------
  const handles = () => {
    if (!one) return null;
    const hs = 12 / scale;
    if (one.type === "line") {
      return [[1, one.x1, one.y1], [2, one.x2, one.y2]].map(([n, x, y]) => (
        <div key={n} data-handle={`p${n}`} style={{ position: "absolute", left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, borderRadius: "50%", background: "#fff", border: `${2 / scale}px solid #0a84ff`, cursor: "move", pointerEvents: "auto" }} />
      ));
    }
    const o = one as Exclude<El, LineEl>;
    const rot = (o as TextEl).rot ?? 0;
    const pts: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    const cur = ["nwse", "ns", "nesw", "ew", "ew", "nesw", "ns", "nwse"];
    return (
      <div style={{ position: "absolute", left: o.x, top: o.y, width: o.w, height: o.h, transform: `rotate(${rot}deg)`, outline: `${1.5 / scale}px solid #0a84ff`, pointerEvents: "none" }}>
        {pts.map(([hx, hy], i) => (
          <div key={i} data-handle={`${hx},${hy}`} style={{ position: "absolute", left: `calc(${(hx + 1) * 50}% - ${hs / 2}px)`, top: `calc(${(hy + 1) * 50}% - ${hs / 2}px)`, width: hs, height: hs, background: "#fff", border: `${2 / scale}px solid #0a84ff`, borderRadius: 2 / scale, cursor: `${cur[i]}-resize`, pointerEvents: "auto" }} />
        ))}
        <div data-handle="rot" style={{ position: "absolute", left: `calc(50% - ${hs / 2}px)`, top: -34 / scale - hs / 2, width: hs, height: hs, borderRadius: "50%", background: "#0a84ff", cursor: "grab", pointerEvents: "auto" }} />
        <div style={{ position: "absolute", left: "50%", top: -34 / scale, width: 1 / scale, height: 34 / scale, background: "#0a84ff" }} />
      </div>
    );
  };

  const editBox = () => {
    if (!editing) return null;
    const e = byId(editing.id), se = shownDoc.elements.find((x) => x.id === editing.id);
    if (!e || !se) return null;
    let x = 0, y = 0, w = 0, h = 0, size = 12, value = "", bold = false, italic = false, color = "#000", align = "l", rot = 0;
    if (e.type === "text" || e.type === "rect") {
      const s = se as TextEl; x = e.x; y = e.y; w = e.w; h = e.h; size = s.size ?? 16; value = s.text ?? ""; bold = !!s.bold; italic = !!s.italic; color = s.color ?? "#000"; align = s.align ?? (e.type === "rect" ? "c" : "l"); rot = (e as TextEl).rot ?? 0;
    } else if (e.type === "table" && editing.r !== undefined && editing.c !== undefined) {
      const t = se as TableEl; const cell = t.rows[editing.r].cells[editing.c];
      x = e.x + e.cols.slice(0, editing.c).reduce((a, b) => a + b, 0); y = e.y + e.rows.slice(0, editing.r).reduce((a, r) => a + r.h, 0);
      w = e.cols.slice(editing.c, editing.c + (cell.span || 1)).reduce((a, b) => a + b, 0); h = e.rows[editing.r].h;
      size = cell.size; value = cell.text; bold = cell.bold; italic = cell.italic; color = cell.color; align = cell.align;
    } else return null;
    return (
      <textarea autoFocus defaultValue={value} onFocus={(ev) => ev.currentTarget.select()} onBlur={(ev) => commitEdit(ev.currentTarget.value)}
        onKeyDown={(ev) => { if (ev.key === "Escape") { ev.preventDefault(); setEditing(null); } if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) ev.currentTarget.blur(); }}
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{ position: "absolute", left: x - 2, top: y - 2, width: w + 4, minHeight: h + 4, padding: 2, boxSizing: "border-box", resize: "none", fontFamily: "Arial, Helvetica, sans-serif", fontSize: size * PT, lineHeight: 1.17, fontWeight: bold ? 700 : 400, fontStyle: italic ? "italic" : "normal", color, textAlign: align === "c" ? "center" : align === "r" ? "right" : align === "j" ? "justify" : "left", background: "rgba(255,255,255,.92)", outline: `${2 / scale}px solid #0a84ff`, border: 0, transform: `rotate(${rot}deg)`, zIndex: 50 }} />
    );
  };

  const q2 = q.trim().toLowerCase();
  const cats = [...new Set(icons.map((i) => i.categoria))];
  const btn = "btn-secondary px-3 py-1.5 text-xs";

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[240px_1fr_270px]">
      {/* Izquierda: iconos y capas */}
      <div className="card space-y-3 p-3 xl:max-h-[calc(100dvh-9rem)] xl:overflow-y-auto">
        <div className="seg w-full">
          <button className={`flex-1 ${tab === "iconos" ? "on" : ""}`} onClick={() => setTab("iconos")}>Iconos</button>
          <button className={`flex-1 ${tab === "capas" ? "on" : ""}`} onClick={() => setTab("capas")}>Capas</button>
        </div>
        {tab === "iconos" ? (
          <>
            <input className="input text-sm" placeholder="Buscar icono…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn-secondary w-full text-xs" onClick={() => fileIn.current?.click()}>+ Subir mi icono</button>
            <input ref={fileIn} type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            {cats.map((c) => {
              const list = icons.filter((i) => i.categoria === c && (!q2 || i.name.toLowerCase().includes(q2)));
              if (!list.length) return null;
              return (
                <div key={c}>
                  <p className="mb-1 text-[11px] font-semibold text-slate-500">{c}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {list.map((i) => (
                      <button key={i.id} type="button" title={`${i.name} (clic o arrastra al lienzo)`} draggable onDragStart={(e) => e.dataTransfer.setData("text/icon-id", i.id)} onClick={() => void addIcon(i.id)} className="flex h-14 items-center justify-center rounded-lg bg-slate-100/70 p-1 hover:bg-slate-200/80">
                        <img src={iconUrl(i.id)} alt={i.name} className="max-h-full max-w-full object-contain" draggable={false} />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {icons.length === 0 && <p className="text-xs text-slate-500">Cargando iconos…</p>}
          </>
        ) : (
          <ul className="space-y-0.5">
            {[...els].reverse().map((e) => (
              <li key={e.id} className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs ${sel.includes(e.id) ? "bg-brand-500/15 font-semibold" : "hover:bg-slate-100"}`}>
                <button className="min-w-0 flex-1 truncate text-left" onClick={(ev) => setSel(ev.shiftKey ? [...new Set([...sel, e.id])] : [e.id])}>{label(e, icons)}</button>
                <button className="text-slate-400 hover:text-slate-700" title={e.locked ? "Desbloquear" : "Bloquear"} onClick={() => setEls(els.map((x) => (x.id === e.id ? { ...x, locked: !x.locked } : x)))}>{e.locked ? "🔒" : "🔓"}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Centro: barra y lienzo */}
      <div className="min-w-0 space-y-2">
        <div className="card flex flex-wrap items-center gap-1.5 p-2">
          <button className={btn} onClick={addText}>Texto</button>
          <button className={btn} onClick={addRect} title="Forma (rectángulo)" aria-label="Forma"><ToolIcon name="rect" /></button>
          <button className={btn} onClick={() => addLine(false)} title="Línea" aria-label="Línea"><ToolIcon name="line" /></button>
          <button className={btn} onClick={() => addLine(true)} title="Flecha" aria-label="Flecha"><ToolIcon name="arrow" /></button>
          <span className="mx-1 h-5 w-px bg-slate-300" />
          <button className={btn} onClick={hist.undo} disabled={!hist.canUndo} title="Deshacer (Ctrl+Z)">↶</button>
          <button className={btn} onClick={hist.redo} disabled={!hist.canRedo} title="Rehacer (Ctrl+Y)">↷</button>
          <span className="mx-1 h-5 w-px bg-slate-300" />
          <button className={btn} onClick={duplicate} disabled={!sel.length} title="Duplicar (Ctrl+D)">Duplicar</button>
          <button className={btn} onClick={() => order("front")} disabled={!sel.length}>Al frente</button>
          <button className={btn} onClick={() => order("back")} disabled={!sel.length}>Al fondo</button>
          <button className="btn-danger px-3 py-1.5 text-xs" onClick={remove} disabled={!sel.length}>Eliminar</button>
          <span className="flex-1" />
          <button className={btn} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
          <button className={btn} onClick={() => setZoom(1)} title="Ajustar al ancho">{Math.round(scale * 100)}%</button>
          <button className={btn} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
        </div>
        <div ref={wrap} className="overflow-auto rounded-xl border border-slate-300 bg-slate-200/60" style={{ maxHeight: "calc(100dvh - 12rem)" }}>
          <div style={{ width: doc.w * scale, height: doc.h * scale, position: "relative" }}>
            <div ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
              style={{ position: "absolute", left: 0, top: 0, width: doc.w, height: doc.h, transform: `scale(${scale})`, transformOrigin: "0 0", background: "#fff", touchAction: "none", userSelect: "none", cursor: "default", boxShadow: "0 2px 12px rgba(0,0,0,.18)" }}>
              {els.map((e, i) => <ElView key={e.id} e={e} shown={shownDoc.elements[i]} icons={icons} />)}
              {sel.map((id) => { const e = byId(id); if (!e || sel.length === 1) return null; const b = bbox(e); return <div key={id} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, outline: `${1.5 / scale}px dashed #0a84ff`, pointerEvents: "none" }} />; })}
              {handles()}
              {marquee && <div style={{ position: "absolute", left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, background: "rgba(10,132,255,.12)", border: `${1 / scale}px solid #0a84ff`, pointerEvents: "none" }} />}
              {editBox()}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Clic para elegir · arrastra para mover · esquinas para cambiar tamaño · doble clic en un texto para escribir · Shift para elegir varios · Ctrl+Z deshace.</p>
      </div>

      {/* Derecha: propiedades */}
      <div className="card space-y-2 p-3 xl:max-h-[calc(100dvh-9rem)] xl:overflow-y-auto">
        <h3 className="text-sm font-semibold text-slate-800">{sel.length > 1 ? `${sel.length} elementos` : one ? label(one, icons) : "Propiedades"}</h3>
        {sel.length > 1 ? <p className="text-xs text-slate-500">Arrástralos juntos, duplícalos o elimínalos. Elige uno solo para editar sus detalles.</p> : (
          <PropsPanel el={one} selCell={selCell} setSelCell={setSelCell}
            p={(patch) => one && patchIds([one.id], (e) => ({ ...e, ...patch } as El))}
            onReplaceIcon={(id) => one && patchIds([one.id], (e) => ({ ...e, icon: id } as El))} />
        )}
      </div>
    </div>
  );
}

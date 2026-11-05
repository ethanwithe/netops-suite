import type { Cell, Dash, El, Head, ImgEl, LineEl, RectEl, TableEl, TextEl } from "./types";
import { iconUrl, useIcons } from "./icons";

type Patch = (p: Partial<El> | Record<string, unknown>) => void;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
    <span className="shrink-0">{label}</span>
    <span className="flex min-w-0 items-center gap-1">{children}</span>
  </label>
);

function Num({ v, on, step = 1, w = "w-[4.6rem]" }: { v: number; on: (n: number) => void; step?: number; w?: string }) {
  return <input type="number" step={step} className={`input ${w} px-2 py-1 text-xs`} value={Number.isFinite(v) ? Math.round(v * 100) / 100 : 0} onChange={(e) => on(Number(e.target.value))} />;
}

export function ColorInput({ v, on, none }: { v: string | null | undefined; on: (c: string | null) => void; none?: boolean }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(v || "") ? (v as string) : "#000000";
  return (
    <span className="flex items-center gap-1">
      <input type="color" value={hex} onChange={(e) => on(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-transparent p-0.5" aria-label="Color" />
      {none && <button type="button" className={`rounded px-1.5 py-0.5 text-[11px] ${v ? "text-slate-500 hover:bg-slate-100" : "bg-slate-200 text-slate-700"}`} onClick={() => on(null)}>Sin</button>}
    </span>
  );
}

const DASHES: [Dash, string][] = [["", "Continua"], ["dash", "Guiones"], ["lgDash", "Guiones largos"], ["sysDash", "Guiones cortos"], ["dot", "Puntos"], ["dashDot", "Guion y punto"]];
const HEADS: [Head, string][] = [["none", "Sin punta"], ["triangle", "Flecha"], ["arrow", "Flecha abierta"], ["stealth", "Flecha fina"], ["oval", "Círculo"], ["diamond", "Rombo"]];

function Align({ v, on }: { v: "l" | "c" | "r"; on: (a: "l" | "c" | "r") => void }) {
  return (
    <span className="seg">
      {(["l", "c", "r"] as const).map((a) => <button key={a} type="button" className={v === a ? "on" : ""} onClick={() => on(a)}>{a === "l" ? "Izq" : a === "c" ? "Centro" : "Der"}</button>)}
    </span>
  );
}

function TextStyle({ e, p }: { e: { size?: number; bold?: boolean; italic?: boolean; color?: string; align?: "l" | "c" | "r" }; p: Patch }) {
  return (
    <>
      <Row label="Tamaño"><Num v={e.size ?? 12} on={(n) => p({ size: Math.max(1, n) })} w="w-[4.6rem]" /></Row>
      <Row label="Estilo">
        <button type="button" className={`rounded px-2 py-1 text-xs font-bold ${e.bold ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => p({ bold: !e.bold })}>N</button>
        <button type="button" className={`rounded px-2 py-1 text-xs italic ${e.italic ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => p({ italic: !e.italic })}>K</button>
      </Row>
      <Row label="Color del texto"><ColorInput v={e.color} on={(c) => p({ color: c ?? "#000000" })} /></Row>
      <Row label="Alineación"><Align v={e.align ?? "l"} on={(a) => p({ align: a })} /></Row>
    </>
  );
}

export default function PropsPanel({ el, p, selCell, setSelCell, onReplaceIcon }: {
  el: El | null; p: Patch; selCell: { r: number; c: number } | null; setSelCell: (c: { r: number; c: number } | null) => void; onReplaceIcon: (id: string) => void;
}) {
  const { icons } = useIcons();
  if (!el) return <p className="text-xs text-slate-500">Elige un elemento del lienzo para editar su texto, color, tamaño o icono. Doble clic en un texto para escribir directamente.</p>;

  const pos = el.type === "line" ? null : (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-200 pt-2">
      <Row label="X"><Num v={el.x} on={(n) => p({ x: n })} /></Row>
      <Row label="Y"><Num v={el.y} on={(n) => p({ y: n })} /></Row>
      <Row label="Ancho"><Num v={el.w} on={(n) => p({ w: Math.max(1, n) })} /></Row>
      <Row label="Alto"><Num v={el.h} on={(n) => p({ h: Math.max(1, n) })} /></Row>
      <Row label="Giro °"><Num v={(el as TextEl).rot ?? 0} on={(n) => p({ rot: n })} /></Row>
    </div>
  );

  return (
    <div className="space-y-2">
      {el.type === "text" && (() => {
        const t = el as TextEl;
        return (
          <>
            <textarea className="input text-sm" rows={3} value={t.text} onChange={(e) => p({ text: e.target.value })} aria-label="Texto" />
            <TextStyle e={t} p={p} />
            <Row label="Fondo"><ColorInput v={t.fill} on={(c) => p({ fill: c })} none /></Row>
            <Row label="Sin saltos"><input type="checkbox" className="ios" checked={!!t.nowrap} onChange={(e) => p({ nowrap: e.target.checked })} /></Row>
          </>
        );
      })()}

      {el.type === "rect" && (() => {
        const r = el as RectEl;
        return (
          <>
            <Row label="Relleno"><ColorInput v={r.fill} on={(c) => p({ fill: c })} none /></Row>
            <Row label="Borde"><ColorInput v={r.stroke} on={(c) => p({ stroke: c })} none /></Row>
            <Row label="Grosor"><Num v={r.strokeW} on={(n) => p({ strokeW: Math.max(0, n) })} step={0.5} /></Row>
            <Row label="Trazo">
              <select className="input w-36 px-2 py-1 text-xs" value={r.dash ?? ""} onChange={(e) => p({ dash: e.target.value as Dash })}>{DASHES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Row>
            <textarea className="input text-sm" rows={2} placeholder="Texto dentro de la forma" value={r.text ?? ""} onChange={(e) => p({ text: e.target.value })} />
            {(r.text ?? "") !== "" && <TextStyle e={{ size: r.size ?? 16, bold: r.bold, italic: r.italic, color: r.color ?? "#000000", align: r.align ?? "c" }} p={p} />}
          </>
        );
      })()}

      {el.type === "line" && (() => {
        const l = el as LineEl;
        return (
          <>
            <Row label="Color"><ColorInput v={l.stroke} on={(c) => p({ stroke: c ?? "#000000" })} /></Row>
            <Row label="Grosor"><Num v={l.strokeW} on={(n) => p({ strokeW: Math.max(0.5, n) })} step={0.5} /></Row>
            <Row label="Trazo">
              <select className="input w-36 px-2 py-1 text-xs" value={l.dash ?? ""} onChange={(e) => p({ dash: e.target.value as Dash })}>{DASHES.map(([k, d]) => <option key={k} value={k}>{d}</option>)}</select>
            </Row>
            <Row label="Punta inicio">
              <select className="input w-36 px-2 py-1 text-xs" value={l.head ?? "none"} onChange={(e) => p({ head: e.target.value as Head })}>{HEADS.map(([k, d]) => <option key={k} value={k}>{d}</option>)}</select>
            </Row>
            <Row label="Punta final">
              <select className="input w-36 px-2 py-1 text-xs" value={l.tail ?? "none"} onChange={(e) => p({ tail: e.target.value as Head })}>{HEADS.map(([k, d]) => <option key={k} value={k}>{d}</option>)}</select>
            </Row>
          </>
        );
      })()}

      {el.type === "image" && (() => {
        const im = el as ImgEl;
        return (
          <>
            <p className="text-xs font-semibold text-slate-600">Cambiar icono</p>
            <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
              {icons.map((i) => (
                <button key={i.id} type="button" title={i.name} onClick={() => onReplaceIcon(i.id)} className={`flex h-12 items-center justify-center rounded-md p-0.5 hover:bg-slate-100 ${i.id === im.icon ? "ring-2 ring-brand-500" : ""}`}>
                  <img src={iconUrl(i.id)} alt={i.name} className="max-h-full max-w-full object-contain" draggable={false} />
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {el.type === "table" && (() => {
        const t = el as TableEl;
        const cell: Cell | undefined = selCell ? t.rows[selCell.r]?.cells[selCell.c] : undefined;
        const set = (patch: Partial<Cell>) => {
          if (!selCell) return;
          p({ rows: t.rows.map((row, r) => (r !== selCell.r ? row : { ...row, cells: row.cells.map((c, ci) => (ci === selCell.c ? { ...c, ...patch } : c)) })) });
        };
        return (
          <>
            {!cell ? <p className="text-xs text-slate-500">Haz clic en una celda de la tabla para editarla.</p> : (
              <>
                <p className="text-xs font-semibold text-slate-600">Celda fila {selCell!.r + 1}, columna {selCell!.c + 1}</p>
                <textarea className="input text-sm" rows={3} value={cell.text} onChange={(e) => set({ text: e.target.value })} aria-label="Texto de la celda" />
                <TextStyle e={cell} p={set as Patch} />
                <Row label="Fondo"><ColorInput v={cell.fill} on={(c) => set({ fill: c, grad: c ? null : cell.grad })} none /></Row>
              </>
            )}
            <div className="flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => {
                const last = t.rows[t.rows.length - 1];
                const h = last.h;
                p({ rows: [...t.rows, { h, cells: last.cells.map((c) => ({ ...c, text: "", span: 1, merged: false })) }], h: t.h + h });
              }}>+ Fila</button>
              <button type="button" className="btn-secondary text-xs" disabled={t.rows.length < 2} onClick={() => { const last = t.rows[t.rows.length - 1]; p({ rows: t.rows.slice(0, -1), h: t.h - last.h }); setSelCell(null); }}>− Fila</button>
            </div>
          </>
        );
      })()}

      {pos}
    </div>
  );
}

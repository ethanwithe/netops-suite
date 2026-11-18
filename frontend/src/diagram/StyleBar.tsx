import { ColorInput } from "./Props";
import { FONTS, TEXT_PRESETS } from "./fonts";
import type { Dash, Head } from "./types";

export const DASHES: [Dash, string][] = [["", "Continua"], ["dash", "Punteada (guiones)"], ["lgDash", "Guiones largos"], ["sysDash", "Guiones cortos"], ["dot", "Puntos"], ["dashDot", "Guion y punto"]];
export const HEADS: [Head, string][] = [["none", "Sin punta"], ["triangle", "Flecha"], ["arrow", "Flecha abierta"], ["stealth", "Flecha fina"], ["oval", "Círculo"], ["diamond", "Rombo"]];

type V = Record<string, unknown>;
const sel = "input !h-8 !min-h-0 w-auto px-2 py-0 text-xs";
const Lbl = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <label className="flex items-center gap-1 text-[11px] text-slate-600"><span>{t}</span>{children}</label>
);

/** Barra de estilo que cambia según lo que se dibuja o elige: línea/flecha, forma o texto. */
export default function StyleBar({ kind, v, on, hint }: { kind: "line" | "shape" | "text"; v: V; on: (patch: V) => void; hint?: string }) {
  const num = (k: string, step = 1, min = 0) => (
    <input type="number" step={step} min={min} className={`${sel} w-16`} value={Number(v[k] ?? 0)} onChange={(e) => on({ [k]: Math.max(min, Number(e.target.value)) })} />
  );
  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-1.5 p-2">
      {kind === "line" && (
        <>
          <Lbl t="Color"><ColorInput v={v.stroke as string} on={(c) => on({ stroke: c ?? "#000000" })} /></Lbl>
          <Lbl t="Grosor">{num("strokeW", 0.5, 0.5)}</Lbl>
          <Lbl t="Trazo">
            <select className={sel} value={(v.dash as string) ?? ""} onChange={(e) => on({ dash: e.target.value })}>{DASHES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Lbl>
          <Lbl t="Inicio">
            <select className={sel} value={(v.head as string) ?? "none"} onChange={(e) => on({ head: e.target.value })}>{HEADS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Lbl>
          <Lbl t="Final">
            <select className={sel} value={(v.tail as string) ?? "none"} onChange={(e) => on({ tail: e.target.value })}>{HEADS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Lbl>
        </>
      )}
      {kind === "shape" && (
        <>
          <Lbl t="Relleno"><ColorInput v={v.fill as string | null} on={(c) => on({ fill: c })} none /></Lbl>
          <Lbl t="Borde"><ColorInput v={v.stroke as string | null} on={(c) => on({ stroke: c })} none /></Lbl>
          <Lbl t="Grosor">{num("strokeW", 0.5)}</Lbl>
          <Lbl t="Trazo">
            <select className={sel} value={(v.dash as string) ?? ""} onChange={(e) => on({ dash: e.target.value })}>{DASHES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Lbl>
        </>
      )}
      {kind === "text" && (
        <>
          <Lbl t="Estilo">
            <select className={sel} value="" onChange={(e) => { const p = TEXT_PRESETS.find((x) => x.name === e.target.value); if (p) on(p.patch); }}>
              <option value="">Elegir…</option>{TEXT_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </Lbl>
          <Lbl t="Letra">
            <select className={sel} value={(v.font as string) || "Arial"} onChange={(e) => on({ font: e.target.value })} style={{ fontFamily: (v.font as string) || "Arial" }}>
              {FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>{f.name}</option>)}
            </select>
          </Lbl>
          <Lbl t="Tamaño">{num("size", 1, 1)}</Lbl>
          <button type="button" className={`rounded px-2 py-1 text-xs font-bold ${v.bold ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => on({ bold: !v.bold })} title="Negrita">N</button>
          <button type="button" className={`rounded px-2 py-1 text-xs italic ${v.italic ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => on({ italic: !v.italic })} title="Cursiva">K</button>
          <Lbl t="Color"><ColorInput v={v.color as string} on={(c) => on({ color: c ?? "#000000" })} /></Lbl>
          <Lbl t="Fondo"><ColorInput v={v.fill as string | null} on={(c) => on({ fill: c })} none /></Lbl>
        </>
      )}
      {hint && <span className="ml-auto text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

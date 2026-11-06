import { useState } from "react";
import { api, apiErrorMessage } from "../api/client";

/** Reporte que arma Bit para el administrador (barras, línea, tabla o ficha). */
export interface Dash {
  title: string;
  type: "bar" | "line" | "table" | "profile";
  unit?: string;
  labels?: string[];
  series?: { name: string; values: number[] }[];
  columns?: string[];
  rows?: (string | number)[][];
  cards?: { label: string; value: string }[];
  facts?: string[];
  spec?: { report: string; params: Record<string, string> };
}

function Bars({ labels, values, unit }: { labels: string[]; values: number[]; unit?: string }) {
  const max = Math.max(1, ...values);
  if (!values.length) return <p className="text-xs text-slate-500">Sin datos en este período.</p>;
  return (
    <div className="space-y-1">
      {labels.map((l, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="w-24 shrink-0 truncate text-slate-600" title={l}>{l}</span>
          <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (values[i] / max) * 100)}%`, background: "linear-gradient(90deg, rgb(var(--accent2)), rgb(var(--accent)))" }} />
          </div>
          <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-slate-700" title={unit}>{Number.isInteger(values[i]) ? values[i] : values[i].toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

function Line({ labels, values }: { labels: string[]; values: number[] }) {
  const W = 320, H = 110, P = 6;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [P + (i * (W - 2 * P)) / Math.max(1, values.length - 1), H - P - (v / max) * (H - 2 * P)]);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de línea">
        <path d={`${path} L${pts[pts.length - 1]?.[0] ?? P},${H - P} L${P},${H - P} Z`} fill="rgb(var(--accent) / .12)" />
        <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => values[i] > 0 && <circle key={i} cx={p[0]} cy={p[1]} r="2.2" fill="rgb(var(--accent))" />)}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500"><span>{labels[0]}</span><span>máx. {max}</span><span>{labels[labels.length - 1]}</span></div>
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>{columns.map((c) => <th key={c} className="px-2 py-1 font-semibold">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="px-2 py-1 text-slate-700">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function BitDash({ d, onPin, onRemove }: { d: Dash; onPin?: boolean; onRemove?: () => void }) {
  const [pinned, setPinned] = useState(false);
  const [err, setErr] = useState("");
  async function pin() {
    if (!d.spec) return;
    try { await api.post("/mascot/reports", { title: d.title, report: d.spec.report, params: d.spec.params }); setPinned(true); }
    catch (e) { setErr(apiErrorMessage(e, "No se pudo fijar.")); }
  }
  const hasSeries = !!d.series?.[0]?.values?.length;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white/70 p-3">
      <div className="flex items-start gap-2">
        <h4 className="flex-1 text-[12.5px] font-semibold leading-tight text-slate-800">{d.title}</h4>
        {onPin && d.spec && <button type="button" disabled={pinned} onClick={() => void pin()} className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] font-medium text-slate-600 hover:border-cyan2-500 disabled:opacity-60">{pinned ? "Fijado ✓" : "Fijar"}</button>}
        {onRemove && <button type="button" onClick={onRemove} className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] font-medium text-red-600 hover:bg-red-50">Quitar</button>}
      </div>
      {d.cards && d.cards.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {d.cards.map((c) => <div key={c.label} className="rounded-lg bg-slate-100/80 px-2 py-1.5"><p className="text-[10px] text-slate-500">{c.label}</p><p className="text-sm font-bold text-slate-800">{c.value}</p></div>)}
        </div>
      )}
      {d.type === "line" && hasSeries && <Line labels={d.labels ?? []} values={d.series![0].values} />}
      {(d.type === "bar" || d.type === "profile") && hasSeries && <Bars labels={d.labels ?? []} values={d.series![0].values} unit={d.unit} />}
      {d.facts && d.facts.length > 0 && <p className="text-[11px] text-slate-600"><b>Lo que Bit sabe de esta persona:</b> {d.facts.join(" · ")}</p>}
      {d.columns && d.columns.length > 0 && d.rows && d.rows.length > 0 && <Table columns={d.columns} rows={d.rows} />}
      {err && <p className="text-[11px] text-red-600">{err}</p>}
    </div>
  );
}

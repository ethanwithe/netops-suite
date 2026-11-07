import { useCallback, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import BitDash from "../mascot/BitDash";
import type { Dash } from "../mascot/BitDash";

interface Pin { id: string; title: string; spec: { report: string; params: Record<string, string> } }
const CATALOG: { report: string; label: string }[] = [
  { report: "resumen", label: "Resumen general" }, { report: "actividad_usuarios", label: "Acciones por usuario" },
  { report: "actividad_dias", label: "Acciones por día" }, { report: "acciones", label: "Tipos de acción" },
  { report: "clientes_usuarios", label: "Puntos por usuario" }, { report: "clientes_meses", label: "Clientes por mes" },
  { report: "ingresos", label: "Ingresos al sistema" },
];

/** Reportes fijados desde el chat con Bit; se recalculan cada vez que abres la pantalla. */
export default function BitReportsPage() {
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [data, setData] = useState<Record<string, Dash>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: list } = await api.get<Pin[]>("/mascot/reports");
      setPins(list);
      for (const p of list) {
        api.post<Dash>("/mascot/report", p.spec).then((r) => setData((d) => ({ ...d, [p.id]: { ...r.data, spec: p.spec } }))).catch(() => {});
      }
    } catch (e) { setError(apiErrorMessage(e, "No se pudieron cargar los reportes.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add(report: string) {
    const label = CATALOG.find((c) => c.report === report)?.label ?? report;
    try { await api.post("/mascot/reports", { title: label, report, params: {} }); await load(); } catch (e) { setError(apiErrorMessage(e, "No se pudo agregar.")); }
  }
  async function remove(id: string) { await api.delete(`/mascot/reports/${id}`).catch(() => {}); setPins((p) => p?.filter((x) => x.id !== id) ?? null); }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">Reportes de Bit</h2>
        <p className="text-sm text-slate-500">Pídele a Bit un dashboard («¿cómo va Juan este mes?», «compara la actividad del equipo») y fíjalo aquí con el botón <b>Fijar</b>. Se actualiza cada vez que entras.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {CATALOG.map((c) => <button key={c.report} type="button" className="btn-secondary text-xs" onClick={() => void add(c.report)}>+ {c.label}</button>)}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {pins && pins.length === 0 && <div className="card text-sm text-slate-500">Aún no hay reportes fijados. Agrega uno de arriba o pídeselo a Bit.</div>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {pins?.map((p) => (data[p.id] ? <BitDash key={p.id} d={{ ...data[p.id], title: p.title || data[p.id].title }} onRemove={() => void remove(p.id)} /> : <div key={p.id} className="card text-xs text-slate-500">Calculando «{p.title}»…</div>))}
      </div>
    </div>
  );
}

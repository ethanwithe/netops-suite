import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { GRUPOS, fabricaOf, grupoOf, templateFor } from "../diagram/groups";
import type { OptionInfo } from "../diagram/groups";
import type { Doc } from "../diagram/types";
import { useAuth } from "../store/auth";
import { createOption, deleteOption, fetchOption, useDiagramOptions } from "../store/diagramOptions";

/** Una marca (Cisco, Huawei, Fortinet): sus gráficas, y crear más copiando de las que ya hay. */
export default function GraficaGroupPage() {
  const { grupo = "" } = useParams();
  const g = grupoOf(grupo);
  const { me } = useAuth();
  const navigate = useNavigate();
  const { list } = useDiagramOptions();
  const [nombre, setNombre] = useState("");
  const [from, setFrom] = useState(`${grupo}-gpon-ont`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all: OptionInfo[] = useMemo(() => [
    ...GRUPOS.flatMap((x) => [
      ...fabricaOf(x.id),
      ...list.filter((o) => o.grupo === x.id && o.custom).map((o) => ({ id: o.id, grupo: x.id, slug: o.id.slice(x.id.length + 1), label: o.nombre, custom: true })),
    ]),
  ], [list]);
  if (!g) return <Navigate to="/grafica/cisco" replace />;
  const mine = all.filter((o) => o.grupo === grupo);
  const labelOf = (o: OptionInfo) => `${grupoOf(o.grupo)?.label.replace("Gráficas ", "")} · ${o.label}`;

  async function create() {
    if (!nombre.trim()) { setError("Escribe un nombre para la nueva opción."); return; }
    setBusy(true); setError(null);
    try {
      // copia el diseño vigente de la opción elegida (el publicado para todos o, si no hay, el de fábrica)
      let doc: Doc = templateFor(from, "").doc;
      try { const r = await fetchOption(from); doc = r.published ?? r.base ?? doc; } catch { /* se usa el de fábrica */ }
      const row = await createOption(grupo, nombre.trim(), doc);
      navigate(`/grafica/${grupo}/${row.id.slice(grupo.length + 1)}`);
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo crear la opción."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">{g.label}</h2>
        <p className="text-sm text-slate-500">Elige el tipo de gráfica. Los iconos se comparten entre todas las marcas.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mine.map((o) => (
          <div key={o.id} className="card flex items-center justify-between gap-2 !p-3">
            <Link to={`/grafica/${o.grupo}/${o.slug}`} className="min-w-0 flex-1 font-semibold text-slate-800 hover:text-brand-600">{o.label}</Link>
            {o.custom && me?.role === "superadmin" && (
              <button className="text-xs text-red-500 hover:underline" onClick={async () => {
                if (confirm(`¿Borrar la opción «${o.label}»?`)) { try { await deleteOption(o.id); } catch (e) { setError(apiErrorMessage(e, "No se pudo borrar.")); } }
              }}>Borrar</button>
            )}
          </div>
        ))}
      </div>

      <div className="card space-y-2 !p-3">
        <h3 className="text-sm font-semibold text-slate-700">Crear otra opción</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input className="input" placeholder="Nombre (por ejemplo: Internet con radio enlace)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Copiar el diseño de">
            {all.map((o) => <option key={o.id} value={o.id}>Copiar de: {labelOf(o)}</option>)}
          </select>
          <button className="btn-primary" onClick={() => void create()} disabled={busy}>{busy ? "Creando..." : "Crear opción"}</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}


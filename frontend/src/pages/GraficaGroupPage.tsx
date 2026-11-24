import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { fabricaOf, shortLabel, templateFor } from "../diagram/groups";
import type { OptionInfo } from "../diagram/groups";
import type { Doc } from "../diagram/types";
import { useAuth } from "../store/auth";
import { createOption, deleteGroup, deleteOption, fetchOption, renameLabel, useDiagramOptions, useGrupos } from "../store/diagramOptions";

/** Una marca (Cisco, Huawei, Fortinet): sus gráficas, y crear más copiando de las que ya hay. */
export default function GraficaGroupPage() {
  const { grupo = "" } = useParams();
  const { me } = useAuth();
  const navigate = useNavigate();
  const { list, layout, loaded } = useDiagramOptions();
  const grupos = useGrupos();
  const isSuper = me?.role === "superadmin";
  const [nombre, setNombre] = useState("");
  const [from, setFrom] = useState(`${grupo}-gpon-ont`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const g = grupos.find((x) => x.id === grupo);
  const all: OptionInfo[] = useMemo(() => [
    ...grupos.flatMap((x) => [
      ...fabricaOf(x.id, layout.labels),
      ...list.filter((o) => o.grupo === x.id && o.custom).map((o) => ({ id: o.id, grupo: x.id, slug: o.id.slice(x.id.length + 1), label: o.nombre, custom: true })),
    ]),
  ], [list, grupos, layout]);
  if (!g) return loaded ? <Navigate to="/grafica/cisco" replace /> : null;
  const mine = all.filter((o) => o.grupo === grupo);
  const labelOf = (o: OptionInfo) => `${shortLabel(grupos.find((x) => x.id === o.grupo))} · ${o.label}`;

  /** Superadmin: cambiar el nombre de una marca u opción (también las de fábrica). */
  async function rename(id: string, current: string, what: string) {
    const name = prompt(`Nuevo nombre de ${what}:`, current);
    if (!name?.trim() || name.trim() === current) return;
    try { await renameLabel(id, name.trim()); } catch (e) { setError(apiErrorMessage(e, "No se pudo cambiar el nombre.")); }
  }
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
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="page-title break-words">{g.label}</h2>
          <p className="text-sm text-slate-500">Elige el tipo de gráfica. Los iconos se comparten entre todas las marcas.</p>
        </div>
        {isSuper && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary text-xs" onClick={() => void rename(g.id, g.label, "esta opción de Gráfica")}>Cambiar nombre</button>
            {g.custom && (
              <button className="btn-secondary text-xs !text-red-600" onClick={async () => {
                if (!confirm(`¿Borrar «${g.label}» con todas sus gráficas? No se puede deshacer.`)) return;
                try { await deleteGroup(g.id); navigate("/grafica/cisco"); } catch (e) { setError(apiErrorMessage(e, "No se pudo borrar.")); }
              }}>Borrar esta opción</button>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mine.map((o) => (
          <div key={o.id} className="card flex items-center justify-between gap-2 !p-3">
            <Link to={`/grafica/${o.grupo}/${o.slug}`} className="min-w-0 flex-1 break-words font-semibold text-slate-800 hover:text-brand-600">{o.label}</Link>
            {isSuper && <button className="text-xs text-brand-600 hover:underline" onClick={() => void rename(o.id, o.label, "esta gráfica")}>Renombrar</button>}
            {o.custom && isSuper && (
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


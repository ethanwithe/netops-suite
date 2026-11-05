import { useRef, useState } from "react";
import { apiErrorMessage } from "../api/client";
import { deleteIcon, iconUrl, renameIcon, uploadIcon, useIcons } from "../diagram/icons";
import type { IconInfo } from "../diagram/types";
import { useAuth } from "../store/auth";

/** Biblioteca de iconos de la ventana Gráfica: los del sistema (idénticos al diagrama de ejemplo) y los que suba cada usuario. */
export default function DiagramIconsPage() {
  const { icons, loaded } = useIcons();
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Mis iconos");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const cats = [...new Set(icons.map((i) => i.categoria))];
  const q2 = q.trim().toLowerCase();

  async function upload(fs: FileList | null) {
    setError(null);
    for (const f of Array.from(fs ?? [])) {
      try { await uploadIcon(f, "", cat); } catch (e) { setError(apiErrorMessage(e, `No se pudo subir ${f.name}.`)); }
    }
  }
  const canEdit = (i: IconInfo) => !!me?.is_admin || i.mine;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="page-title">Iconos</h2>
          <p className="text-sm text-slate-500">Todos los iconos disponibles para tus diagramas. Sube los tuyos (PNG con fondo transparente se ve mejor) y úsalos desde el editor.</p>
        </div>
        <input className="input w-44" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input w-36" list="cats" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría para los nuevos" />
        <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <button className="btn-primary text-sm" onClick={() => file.current?.click()}>Subir iconos</button>
        <input ref={file} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loaded && <p className="text-sm text-slate-500">Cargando…</p>}
      {cats.map((c) => {
        const list = icons.filter((i) => i.categoria === c && (!q2 || i.name.toLowerCase().includes(q2)));
        if (!list.length) return null;
        return (
          <section key={c} className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-600">{c} <span className="font-normal text-slate-400">({list.length})</span></h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {list.map((i) => (
                <div key={i.id} className="card space-y-2 p-3">
                  <div className="flex h-24 items-center justify-center rounded-lg bg-slate-100/70 p-2">
                    <img src={iconUrl(i.id)} alt={i.name} className="max-h-full max-w-full object-contain" />
                  </div>
                  <p className="truncate text-xs font-medium text-slate-700" title={i.name}>{i.name}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{i.builtin ? "Del sistema" : i.mine ? "Mío" : "De otro usuario"}</span>
                    {canEdit(i) && (
                      <span className="flex gap-2">
                        <button className="hover:text-slate-700" onClick={() => { const n = prompt("Nombre del icono:", i.name); if (n && n.trim()) void renameIcon(i.id, n.trim(), i.categoria); }}>Renombrar</button>
                        <button className="text-red-500 hover:underline" onClick={() => { if (confirm(`¿Borrar el icono «${i.name}»? Los diagramas que lo usan lo perderán.`)) void deleteIcon(i.id).catch((e) => alert(apiErrorMessage(e, "No se pudo borrar."))); }}>Borrar</button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

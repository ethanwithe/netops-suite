import { useEffect, useMemo, useRef, useState } from "react";
import ImageUpload from "./ImageUpload";
import { addExtra, patchCell, removeExtra, resolveOpcion, updateExtra } from "../store/photoReportStore";
import type { ExtraPhoto, FotoTipo, Opcion, Section } from "../store/photoReportStore";

const newId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Foto de la carpeta: puede venir de una celda del reporte (la del PDF) o ser una foto extra. */
export interface GalleryItem {
  key: string;
  kind: "cell" | "extra";
  id: string;
  sid?: string;
  nombre: string;
  url: string;
  /** Foto tal como estaba antes de editarla. */
  originalUrl?: string;
  edited: boolean;
  lado: string;
}

interface Props {
  tipo: FotoTipo;
  extras: ExtraPhoto[];
  sections: Section[];
  opciones: Opcion[];
  cliente: string;
  onEdit: (item: GalleryItem) => void;
}

/**
 * Carpeta de evidencia: TODAS las fotos (las de las celdas del PDF, editadas y originales, y las extras) en desplegables.
 * Un desplegable por cada opción del reporte (Site, PDI, POP, Cliente y las que agregues); clic en una miniatura = visor grande.
 */
export default function ExtraGallery({ tipo, extras, sections, opciones, cliente, onEdit }: Props) {
  const items = useMemo<GalleryItem[]>(() => {
    const out: GalleryItem[] = [];
    for (const sec of sections) {
      const lado = resolveOpcion(sec.lado, opciones).id;
      for (const c of sec.cells) {
        if (!c.imagePath) continue;
        out.push({ key: `c:${sec.id}:${c.id}`, kind: "cell", id: c.id, sid: sec.id, nombre: c.descripcion, url: c.imageUrl, originalUrl: c.originalUrl || undefined, edited: !!c.originalPath, lado });
      }
    }
    for (const e of extras) {
      out.push({ key: `e:${e.id}`, kind: "extra", id: e.id, nombre: e.nombre, url: e.url, originalUrl: e.originalUrl || undefined, edited: !!e.originalPath, lado: resolveOpcion(e.lado, opciones).id });
    }
    return out;
  }, [sections, extras, opciones]);

  const groups = opciones.map((o) => o.id);

  const [viewer, setViewer] = useState<{ keys: string[]; key: string } | null>(null);
  const lastId = useRef("");

  return (
    <div className="space-y-2">
      {groups.map((gid, gi) => {
        const g = opciones[gi];
        const list = items.filter((x) => x.lado === gid);
        return (
          <details key={`${gi}-${gid}`} className="rounded-lg border border-slate-200" open={list.length > 0 && list.length <= 12}>
            <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700">
              {g.label}
              <span className="text-xs font-normal text-slate-400">({list.length} fotos)</span>
            </summary>
            <div className="space-y-2 border-t border-slate-100 p-3">
              <Grid list={list} onOpen={(key) => setViewer({ keys: list.map((x) => x.key), key })} onRemove={(it) => removeItem(tipo, it)} />
              <ImageUpload
                key={`${gid}-${list.length}`}
                compact
                multiple
                cliente={cliente}
                label={`Agregar fotos a ${g.label}...`}
                onUploaded={(p, u) => { if (!p) return; lastId.current = newId(); addExtra(tipo, { id: lastId.current, nombre: "", path: p, url: u, lado: gid }); }}
                onStampRaw={(raw, lines) => {
                  if (lastId.current) updateExtra(tipo, lastId.current, { rawPath: raw.path, rawUrl: raw.url, stampLines: lines });
                }}
              />
            </div>
          </details>
        );
      })}

      {viewer && (
        <Viewer tipo={tipo} items={items} keys={viewer.keys} startKey={viewer.key} opciones={opciones} onEdit={onEdit} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

/** Quita la foto: una extra se borra; la de una celda solo se vacía (la celda queda para volver a tomarla). */
function removeItem(tipo: FotoTipo, it: GalleryItem) {
  if (!confirm(it.kind === "cell" ? "¿Quitar la foto de esta celda? La celda queda vacía y deja de salir en el PDF." : "¿Quitar esta foto?")) return;
  if (it.kind === "extra") removeExtra(tipo, it.id);
  else if (it.sid) patchCell(tipo, it.sid, it.id, { imagePath: "", imageUrl: "", originalPath: "", originalUrl: "", rawPath: "", rawUrl: "", stampLines: undefined, stampPos: undefined, incluir: false });
}

function Grid({ list, onOpen, onRemove }: { list: GalleryItem[]; onOpen: (key: string) => void; onRemove: (it: GalleryItem) => void }) {
  if (!list.length) return <p className="text-xs text-slate-400">Sin fotos todavía.</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-8">
      {list.map((e, i) => (
        <div key={e.key} className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          <button type="button" onClick={() => onOpen(e.key)} className="h-full w-full" title={e.nombre || "Ver foto"}>
            <img src={e.url} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
          </button>
          <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
          {e.edited && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-brand-600/90 px-1 text-[9px] font-semibold text-white">editada</span>}
          <button type="button" onClick={() => onRemove(e)} aria-label="Quitar foto" title="Quitar foto"
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold leading-none text-white shadow hover:bg-red-700">×</button>
        </div>
      ))}
    </div>
  );
}

function Viewer({ tipo, items, keys, startKey, opciones, onEdit, onClose }: {
  tipo: FotoTipo; items: GalleryItem[]; keys: string[]; startKey: string; opciones: Opcion[];
  onEdit: (item: GalleryItem) => void; onClose: () => void;
}) {
  const [cur, setCur] = useState(startKey);
  const [showOrig, setShowOrig] = useState(false);
  const list = keys.map((k) => items.find((e) => e.key === k)).filter((e): e is GalleryItem => !!e);
  const idx = Math.max(0, list.findIndex((e) => e.key === cur));
  const e = list[idx];

  useEffect(() => { if (!list.length) onClose(); }, [list.length, onClose]);
  useEffect(() => { setShowOrig(false); }, [cur]);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement || ev.target instanceof HTMLTextAreaElement) return;
      if (ev.key === "Escape") onClose();
      if (ev.key === "ArrowRight" && idx < list.length - 1) setCur(list[idx + 1].key);
      if (ev.key === "ArrowLeft" && idx > 0) setCur(list[idx - 1].key);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [idx, list, onClose]);
  useEffect(() => { document.getElementById(`ex-th-${cur}`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }, [cur]);

  if (!e) return null;
  const hasOrig = e.edited && !!e.originalUrl;

  function remove() {
    if (!e) return;
    const next = list[idx + 1] ?? list[idx - 1];
    const before = items.length;
    removeItem(tipo, e);
    if (next && before) setCur(next.key);
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/90" role="dialog" aria-label="Visor de fotos">
      <div className="flex flex-wrap items-center gap-2 p-2 text-white">
        <span className="text-xs">{idx + 1} / {list.length}</span>
        <input className="input h-8 min-w-[140px] flex-1 text-slate-800"
          placeholder={e.kind === "cell" ? "Texto sobre la foto" : "Nombre de la foto"} value={e.nombre}
          onChange={(ev) => (e.kind === "extra" ? updateExtra(tipo, e.id, { nombre: ev.target.value }) : e.sid && patchCell(tipo, e.sid, e.id, { descripcion: ev.target.value }))} />
        {e.kind === "extra" ? (
          <select className="input h-8 w-44 text-slate-800" value={e.lado} onChange={(ev) => updateExtra(tipo, e.id, { lado: ev.target.value })}>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        ) : (
          <span className="rounded bg-white/15 px-2 py-1 text-xs">{opciones.find((o) => o.id === e.lado)?.label ?? ""} (celda del reporte)</span>
        )}
        {hasOrig && (
          <button className="btn-secondary text-xs" onClick={() => setShowOrig(!showOrig)}>{showOrig ? "Ver editada" : "Ver original"}</button>
        )}
        <button className="btn-secondary text-xs" onClick={() => onEdit(e)} title="Editar la foto y mover o agrandar el sello">Editar</button>
        <button className="btn-secondary text-xs text-red-600" onClick={remove}>Quitar</button>
        <button className="btn-primary text-xs" onClick={onClose}>Cerrar</button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
        <button className="absolute left-2 z-10 rounded-full bg-white/20 px-3 py-2 text-white disabled:opacity-30" disabled={idx === 0} onClick={() => setCur(list[idx - 1].key)} aria-label="Anterior">‹</button>
        <img src={showOrig && e.originalUrl ? e.originalUrl : e.url} alt={e.nombre} className="max-h-full max-w-full object-contain" />
        {showOrig && <span className="absolute bottom-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Original sin editar</span>}
        <button className="absolute right-2 z-10 rounded-full bg-white/20 px-3 py-2 text-white disabled:opacity-30" disabled={idx === list.length - 1} onClick={() => setCur(list[idx + 1].key)} aria-label="Siguiente">›</button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto bg-black/60 p-2">
        {list.map((x, i) => (
          <div key={x.key} id={`ex-th-${x.key}`} className={`relative h-16 w-20 shrink-0 overflow-hidden rounded border-2 ${x.key === cur ? "border-brand-400" : "border-transparent opacity-70"}`}>
            <button type="button" onClick={() => setCur(x.key)} className="h-full w-full" aria-label={`Foto ${i + 1}`}>
              <img src={x.url} alt="" className="h-full w-full object-cover" />
            </button>
            <button type="button" aria-label="Quitar foto" onClick={() => removeItem(tipo, x)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold leading-none text-white">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

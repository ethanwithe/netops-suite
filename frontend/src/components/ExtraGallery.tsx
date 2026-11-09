import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import ImageUpload from "./ImageUpload";
import { addExtra, removeExtra, resolveOpcion, updateExtra } from "../store/photoReportStore";
import type { ExtraPhoto, FotoTipo, Opcion } from "../store/photoReportStore";
import { STAMP_ARROW, STAMP_ORDER, getStampPos, setStampPos, stampImage } from "../utils/photoStamp";
import type { StampPos } from "../utils/photoStamp";
import { compressForUpload } from "../utils/imageCompress";

/** Vuelve a poner el sello en otra esquina a partir de la foto sin sello. Devuelve la nueva foto ya subida. */
export async function restampFromRaw(rawUrl: string, lines: string[], pos: StampPos): Promise<{ path: string; url: string }> {
  const r = await fetch(rawUrl, { credentials: "same-origin" });
  if (!r.ok) throw new Error("No se pudo leer la foto original.");
  const blob = await r.blob();
  const stamped = await stampImage(new File([blob], "foto.jpg", { type: blob.type || "image/jpeg" }), lines, pos);
  const form = new FormData();
  form.append("file", await compressForUpload(stamped));
  const { data } = await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
  return { path: data.path, url: data.url };
}

/** Esquina siguiente a la que está guardada (se recuerda para las próximas fotos). */
export function nextStampPos(): StampPos {
  const cur = getStampPos();
  const next = STAMP_ORDER[(STAMP_ORDER.indexOf(cur) + 1) % STAMP_ORDER.length];
  setStampPos(next);
  return next;
}

const newId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

interface Props {
  tipo: FotoTipo;
  extras: ExtraPhoto[];
  opciones: Opcion[];
  cliente: string;
  onEdit: (id: string, url: string) => void;
}

/** Fotos de la carpeta de evidencia: dos desplegables (Cliente y Site) con las fotos en cuadrícula; clic = visor grande. */
export default function ExtraGallery({ tipo, extras, opciones, cliente, onEdit }: Props) {
  const groups = useMemo(() => ["cliente", "site"].map((id) => opciones.find((o) => o.id === id)).filter((o): o is Opcion => !!o), [opciones]);
  const groupIds = new Set(groups.map((g) => g.id));
  const others = extras.filter((e) => !groupIds.has(resolveOpcion(e.lado, opciones).id));
  const [viewer, setViewer] = useState<{ ids: string[]; id: string } | null>(null);
  const lastId = useRef("");

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const list = extras.filter((e) => resolveOpcion(e.lado, opciones).id === g.id);
        return (
          <details key={g.id} className="rounded-lg border border-slate-200" open={list.length > 0 && list.length <= 12}>
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700">
              {g.label} <span className="text-xs font-normal text-slate-400">({list.length} fotos)</span>
            </summary>
            <div className="space-y-2 border-t border-slate-100 p-3">
              <Grid list={list} onOpen={(id) => setViewer({ ids: list.map((x) => x.id), id })} />
              <ImageUpload
                key={`${g.id}-${list.length}`}
                compact
                multiple
                cliente={cliente}
                label={`Agregar fotos a ${g.label}...`}
                onUploaded={(p, u) => { if (!p) return; lastId.current = newId(); addExtra(tipo, { id: lastId.current, nombre: "", path: p, url: u, lado: g.id }); }}
                onStampRaw={(raw, lines) => {
                  if (lastId.current) updateExtra(tipo, lastId.current, { rawPath: raw.path, rawUrl: raw.url, stampLines: lines });
                }}
              />
            </div>
          </details>
        );
      })}

      {others.length > 0 && (
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700">
            Otras opciones <span className="text-xs font-normal text-slate-400">({others.length} fotos)</span>
          </summary>
          <div className="border-t border-slate-100 p-3">
            <Grid list={others} onOpen={(id) => setViewer({ ids: others.map((x) => x.id), id })} />
          </div>
        </details>
      )}

      {viewer && (
        <Viewer
          tipo={tipo}
          extras={extras}
          ids={viewer.ids}
          startId={viewer.id}
          opciones={opciones}
          onEdit={onEdit}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

function Grid({ list, onOpen }: { list: ExtraPhoto[]; onOpen: (id: string) => void }) {
  if (!list.length) return <p className="text-xs text-slate-400">Sin fotos todavía.</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-8">
      {list.map((e, i) => (
        <button key={e.id} type="button" onClick={() => onOpen(e.id)} className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100" title={e.nombre || "Ver foto"}>
          <img src={e.url} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
          <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
          {e.originalPath && <span className="absolute bottom-1 right-1 rounded bg-brand-600/90 px-1 text-[9px] font-semibold text-white">editada</span>}
        </button>
      ))}
    </div>
  );
}

function Viewer({ tipo, extras, ids, startId, opciones, onEdit, onClose }: {
  tipo: FotoTipo; extras: ExtraPhoto[]; ids: string[]; startId: string; opciones: Opcion[];
  onEdit: (id: string, url: string) => void; onClose: () => void;
}) {
  const [cur, setCur] = useState(startId);
  const [busy, setBusy] = useState(false);
  const list = ids.map((id) => extras.find((e) => e.id === id)).filter((e): e is ExtraPhoto => !!e);
  const idx = Math.max(0, list.findIndex((e) => e.id === cur));
  const e = list[idx];

  useEffect(() => { if (!list.length) onClose(); }, [list.length, onClose]);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
      if (ev.key === "Escape") onClose();
      if (ev.key === "ArrowRight" && idx < list.length - 1) setCur(list[idx + 1].id);
      if (ev.key === "ArrowLeft" && idx > 0) setCur(list[idx - 1].id);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [idx, list, onClose]);
  useEffect(() => { document.getElementById(`ex-th-${cur}`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }, [cur]);

  if (!e) return null;

  async function moveStamp() {
    if (!e?.rawUrl || !e.stampLines) return;
    if (e.originalPath && !confirm("Esta foto tiene dibujos o ediciones. Al mover el sello se vuelve a la foto original y esas ediciones se pierden. ¿Continuar?")) return;
    setBusy(true);
    try {
      const r = await restampFromRaw(e.rawUrl, e.stampLines, nextStampPos());
      updateExtra(tipo, e.id, { path: r.path, url: r.url, originalPath: "", originalUrl: "" });
    } catch (er) {
      alert(er instanceof Error ? er.message : "No se pudo mover el sello.");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!e || !confirm("¿Quitar esta foto?")) return;
    const next = list[idx + 1] ?? list[idx - 1];
    removeExtra(tipo, e.id);
    if (next) setCur(next.id);
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/90" role="dialog" aria-label="Visor de fotos">
      <div className="flex flex-wrap items-center gap-2 p-2 text-white">
        <span className="text-xs">{idx + 1} / {list.length}</span>
        <input className="input h-8 min-w-[140px] flex-1 text-slate-800" placeholder="Nombre de la foto" value={e.nombre} onChange={(ev) => updateExtra(tipo, e.id, { nombre: ev.target.value })} />
        <select className="input h-8 w-44 text-slate-800" value={resolveOpcion(e.lado, opciones).id} onChange={(ev) => updateExtra(tipo, e.id, { lado: ev.target.value })}>
          {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className="btn-secondary text-xs" onClick={() => onEdit(e.id, e.url)}>Editar</button>
        {e.rawUrl && e.stampLines && (
          <button className="btn-secondary text-xs" disabled={busy} onClick={moveStamp} title="Pasa el sello a la siguiente esquina">
            {busy ? "Moviendo..." : `Mover sello ${STAMP_ARROW[getStampPos()]}`}
          </button>
        )}
        <button className="btn-secondary text-xs text-red-600" onClick={remove}>Quitar</button>
        <button className="btn-primary text-xs" onClick={onClose}>Cerrar</button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
        <button className="absolute left-2 z-10 rounded-full bg-white/20 px-3 py-2 text-white disabled:opacity-30" disabled={idx === 0} onClick={() => setCur(list[idx - 1].id)} aria-label="Anterior">‹</button>
        <img src={e.url} alt={e.nombre} className="max-h-full max-w-full object-contain" />
        <button className="absolute right-2 z-10 rounded-full bg-white/20 px-3 py-2 text-white disabled:opacity-30" disabled={idx === list.length - 1} onClick={() => setCur(list[idx + 1].id)} aria-label="Siguiente">›</button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto bg-black/60 p-2">
        {list.map((x, i) => (
          <button key={x.id} id={`ex-th-${x.id}`} type="button" onClick={() => setCur(x.id)} className={`h-16 w-20 shrink-0 overflow-hidden rounded border-2 ${x.id === cur ? "border-brand-400" : "border-transparent opacity-70"}`} aria-label={`Foto ${i + 1}`}>
            <img src={x.url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

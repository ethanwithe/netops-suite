import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "./ImageUpload";
import { addExtra, mapExtras, patchCell, removeExtra, resolveOpcion, updateExtra } from "../store/photoReportStore";
import type { Cell, ExtraPhoto, FotoTipo, Opcion, Section } from "../store/photoReportStore";

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
  sot?: string;
  onEdit: (item: GalleryItem) => void;
}

const CLEAR_CELL: Partial<Cell> = { imagePath: "", imageUrl: "", originalPath: "", originalUrl: "", rawPath: "", rawUrl: "", stampLines: undefined, stampPos: undefined, incluir: false };
const cellOf = (sections: Section[], it: GalleryItem) => sections.find((x) => x.id === it.sid)?.cells.find((c) => c.id === it.id);
const extraFromCell = (c: Cell, lado: string, extra: Partial<ExtraPhoto> = {}): ExtraPhoto => ({
  id: newId(), nombre: c.descripcion, path: c.imagePath, url: c.imageUrl, originalPath: c.originalPath || "", originalUrl: c.originalUrl || "",
  rawPath: c.rawPath, rawUrl: c.rawUrl, stampLines: c.stampLines, stampPos: c.stampPos, lado, ...extra,
});

/** A la papelera: no se pierde, se puede restaurar. Las fotos de celdas del PDF dejan la celda vacía. */
export function trashItems(tipo: FotoTipo, list: GalleryItem[], sections: Section[]) {
  const ids = new Set(list.filter((i) => i.kind === "extra").map((i) => i.id));
  const fromCells: ExtraPhoto[] = [];
  for (const it of list) {
    if (it.kind !== "cell" || !it.sid) continue;
    const c = cellOf(sections, it);
    if (!c) continue;
    fromCells.push(extraFromCell(c, it.lado, { trashed: true, fromSid: it.sid, fromCid: it.id }));
    patchCell(tipo, it.sid, it.id, CLEAR_CELL);
  }
  mapExtras(tipo, (l) => [...l.map((e) => (ids.has(e.id) ? { ...e, trashed: true } : e)), ...fromCells]);
}

/** Mover (o copiar) a otra opción. Una foto de celda pasa a la carpeta de esa opción y sale del PDF. */
function moveItems(tipo: FotoTipo, list: GalleryItem[], lado: string, sections: Section[], copy: boolean) {
  const ids = new Set(list.filter((i) => i.kind === "extra").map((i) => i.id));
  const add: ExtraPhoto[] = [];
  for (const it of list) {
    if (it.kind !== "cell" || !it.sid) continue;
    const c = cellOf(sections, it);
    if (!c) continue;
    add.push(extraFromCell(c, lado));
    if (!copy) patchCell(tipo, it.sid, it.id, CLEAR_CELL);
  }
  mapExtras(tipo, (l) => [
    ...l.map((e) => (ids.has(e.id) && !copy ? { ...e, lado } : e)),
    ...(copy ? l.filter((e) => ids.has(e.id)).map((e) => ({ ...e, id: newId(), lado })) : []),
    ...add,
  ]);
}

function deleteForever(tipo: FotoTipo, list: GalleryItem[], sections: Section[]) {
  const ids = new Set(list.filter((i) => i.kind === "extra").map((i) => i.id));
  for (const it of list) if (it.kind === "cell" && it.sid && cellOf(sections, it)) patchCell(tipo, it.sid, it.id, CLEAR_CELL);
  mapExtras(tipo, (l) => l.filter((e) => !ids.has(e.id)));
}

function restoreExtra(tipo: FotoTipo, e: ExtraPhoto, sections: Section[]) {
  const cell = e.fromSid && e.fromCid ? sections.find((x) => x.id === e.fromSid)?.cells.find((c) => c.id === e.fromCid) : undefined;
  if (cell && !cell.imagePath) {
    patchCell(tipo, e.fromSid!, e.fromCid!, {
      imagePath: e.path, imageUrl: e.url, originalPath: e.originalPath || "", originalUrl: e.originalUrl || "",
      rawPath: e.rawPath, rawUrl: e.rawUrl, stampLines: e.stampLines, stampPos: e.stampPos, incluir: true,
    });
    removeExtra(tipo, e.id);
  } else {
    updateExtra(tipo, e.id, { trashed: false, fromSid: undefined, fromCid: undefined });
  }
}

/**
 * Carpeta de evidencia: TODAS las fotos (las de las celdas del PDF, editadas y originales, y las extras).
 * Dos carpetas, cada una con su desplegable para elegir la opción (Cliente, Site, POP, PDI y las que agregues).
 * Selección múltiple: mantener pulsado (celular), Ctrl/Mayús-clic o arrastrar un recuadro (mouse). Mover, copiar, descargar, papelera, borrar.
 */
export default function ExtraGallery({ tipo, extras, sections, opciones, cliente, sot = "", onEdit }: Props) {
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
      if (e.trashed) continue;
      out.push({ key: `e:${e.id}`, kind: "extra", id: e.id, nombre: e.nombre, url: e.url, originalUrl: e.originalUrl || undefined, edited: !!e.originalPath, lado: resolveOpcion(e.lado, opciones).id });
    }
    return out;
  }, [sections, extras, opciones]);
  const trashed = useMemo(() => extras.filter((e) => e.trashed), [extras]);
  const extrasRef = useRef(extras);
  extrasRef.current = extras;

  // Dos carpetas con su desplegable para elegir la opción. Se recuerda lo elegido.
  const [pick, setPick] = useState<[string, string]>(() => {
    try {
      const j = JSON.parse(localStorage.getItem("netops.carpeta.sel") || "null") as string[] | null;
      if (Array.isArray(j) && j.length === 2) return [j[0], j[1]];
    } catch { /* ignorar */ }
    return ["cliente", "site"];
  });
  const ids = opciones.map((o) => o.id);
  const fix = (id: string, other: string) => (ids.includes(id) ? id : ids.find((x) => x !== other) ?? ids[0]);
  const sel2: [string, string] = [fix(pick[0], pick[1]), fix(pick[1], pick[0])];
  const choose = (i: 0 | 1, id: string) => {
    const n: [string, string] = i === 0 ? [id, sel2[1]] : [sel2[0], id];
    setPick(n);
    try { localStorage.setItem("netops.carpeta.sel", JSON.stringify(n)); } catch { /* ignorar */ }
  };

  const [viewer, setViewer] = useState<{ keys: string[]; key: string } | null>(null);
  const lastId = useRef("");

  // ----- selección múltiple -----
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selMode, setSelMode] = useState(false);
  const anchor = useRef<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = useMemo(() => items.filter((x) => sel2.includes(x.lado)), [items, sel2[0], sel2[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // lo que ya no existe (se movió, se borró) sale de la selección
  useEffect(() => {
    setSel((o) => {
      const keep = new Set([...o].filter((k) => items.some((x) => x.key === k)));
      return keep.size === o.size ? o : keep;
    });
  }, [items]);
  useEffect(() => { if (!sel.size && !selMode) anchor.current = null; }, [sel, selMode]);
  const chosen = items.filter((x) => sel.has(x.key));
  const clearSel = () => { setSel(new Set()); setSelMode(false); };
  const toggle = (key: string) => setSel((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const onPick = (it: GalleryItem, list: GalleryItem[], mods: { shift: boolean; ctrl: boolean }) => {
    if (mods.shift && anchor.current) {
      const a = list.findIndex((x) => x.key === anchor.current), b = list.findIndex((x) => x.key === it.key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSel((o) => new Set([...o, ...list.slice(lo, hi + 1).map((x) => x.key)]));
        setSelMode(true);
        return;
      }
    }
    anchor.current = it.key;
    setSelMode(true);
    toggle(it.key);
  };

  useEffect(() => {
    if (!sel.size && !selMode) return;
    const k = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement) return;
      if (ev.key === "Escape") clearSel();
      else if ((ev.key === "a" || ev.key === "A") && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); setSel(new Set(visible.map((x) => x.key))); }
      else if ((ev.key === "Delete" || ev.key === "Backspace") && sel.size) { ev.preventDefault(); doTrash(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  function doTrash() { if (!chosen.length) return; trashItems(tipo, chosen, sections); setMsg(`${chosen.length} foto(s) a la papelera.`); clearSel(); }
  function doDelete() {
    if (!chosen.length || !confirm(`¿Borrar DEFINITIVAMENTE ${chosen.length} foto(s)? No se puede deshacer.${chosen.some((c) => c.kind === "cell") ? " Las de celdas del PDF dejan la celda vacía." : ""}`)) return;
    deleteForever(tipo, chosen, sections); setMsg(`${chosen.length} foto(s) borradas.`); clearSel();
  }
  function doMove(lado: string, copy: boolean) {
    if (!chosen.length || !lado) return;
    const label = opciones.find((o) => o.id === lado)?.label ?? lado;
    if (!copy && chosen.some((c) => c.kind === "cell") && !confirm(`Las fotos que están en celdas del PDF pasarán a la carpeta «${label}» y dejarán de salir en el PDF. ¿Continuar?`)) return;
    moveItems(tipo, chosen, lado, sections, copy);
    setMsg(`${chosen.length} foto(s) ${copy ? "copiadas" : "movidas"} a ${label}.`);
    clearSel();
  }
  async function doZip() {
    if (!chosen.length) return;
    setBusy(true);
    try {
      const { data } = await api.post("/photos/evidence-zip", {
        sot, cliente,
        items: chosen.map((c, i) => ({
          nombre: c.nombre || `foto ${i + 1}`,
          path: pathOf(c, sections, extras), original_path: originalPathOf(c, sections, extras),
          lado_label: opciones.find((o) => o.id === c.lado)?.label ?? "",
        })),
      });
      const a = document.createElement("a");
      a.href = data.url; a.download = data.filename; document.body.appendChild(a); a.click(); a.remove();
      setMsg(`ZIP listo (${data.total} fotos).`);
    } catch (e) { setMsg(apiErrorMessage(e, "No se pudo crear el ZIP.")); }
    finally { setBusy(false); }
  }

  // Foto quitada desde el visor de la cámara (aún en segundo plano): se ubica por su archivo.
  function discardByPath(path: string, mode: "trash" | "delete") {
    const e = extrasRef.current.find((x) => x.path === path);
    if (!e) return;
    if (mode === "delete") removeExtra(tipo, e.id); else updateExtra(tipo, e.id, { trashed: true });
  }

  return (
    <div className="space-y-2">
      {(sel.size > 0 || selMode) && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-300 bg-white/95 p-2 text-xs shadow backdrop-blur">
          <b className="mr-1 text-sm text-slate-800">{sel.size} seleccionada{sel.size === 1 ? "" : "s"}</b>
          <button className="btn-secondary text-xs" onClick={() => setSel(new Set(visible.map((x) => x.key)))}>Todas</button>
          <button className="btn-secondary text-xs" onClick={() => setSel(new Set(visible.filter((x) => !sel.has(x.key)).map((x) => x.key)))}>Invertir</button>
          <button className="btn-secondary text-xs" onClick={() => setSel(new Set())} disabled={!sel.size}>Ninguna</button>
          <span className="mx-1 hidden h-5 w-px bg-slate-300 sm:block" />
          <select className="input h-8 w-auto text-xs" value="" disabled={!sel.size} aria-label="Mover a" onChange={(e) => doMove(e.target.value, false)}>
            <option value="">Mover a…</option>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className="input h-8 w-auto text-xs" value="" disabled={!sel.size} aria-label="Copiar a" onChange={(e) => doMove(e.target.value, true)}>
            <option value="">Copiar a…</option>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button className="btn-secondary text-xs" onClick={() => void doZip()} disabled={!sel.size || busy}>{busy ? "Preparando…" : "Descargar ZIP"}</button>
          <button className="btn-secondary text-xs" onClick={doTrash} disabled={!sel.size}>Papelera</button>
          <button className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40" onClick={doDelete} disabled={!sel.size}>Borrar definitivo</button>
          <button className="ml-auto rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100" onClick={clearSel} aria-label="Salir de la selección">Listo ✕</button>
        </div>
      )}
      {msg && <p className="text-xs text-emerald-700" role="status">{msg} <button className="ml-1 underline" onClick={() => setMsg(null)}>ok</button></p>}

      {([0, 1] as const).map((i) => {
        const gid = sel2[i];
        const g = opciones.find((o) => o.id === gid) ?? opciones[0];
        const list = items.filter((x) => x.lado === gid);
        return (
          <Panel key={i} title={
            <select value={gid} onChange={(e) => choose(i, e.target.value)} aria-label={`Carpeta ${i + 1}`}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700">
              {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          } count={list.length} extra={list.length > 0 && (
            <button type="button" className="rounded-md px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
              onClick={() => { setSelMode(true); setSel((o) => new Set([...o, ...list.map((x) => x.key)])); }}>Seleccionar todas</button>
          )}>
            <div className="space-y-2 p-3">
              <Grid list={list} sel={sel} selMode={selMode} onOpen={(key) => setViewer({ keys: list.map((x) => x.key), key })}
                onPick={(it, mods) => onPick(it, list, mods)} onMarquee={(keys, add) => { setSelMode(true); setSel((o) => new Set(add ? [...o, ...keys] : keys)); }}
                onRemove={(it) => { trashItems(tipo, [it], sections); setMsg("Foto a la papelera."); }} />
              {list.length > 0 && !selMode && <p className="text-[11px] text-slate-400">Para elegir varias: mantén pulsada una foto (celular) o arrastra un recuadro / usa Ctrl o Mayús + clic (laptop).</p>}
              <ImageUpload
                key={gid}
                compact
                multiple
                cliente={cliente}
                label={`Agregar fotos a ${g.label}...`}
                onUploaded={(p, u) => { if (!p) return; lastId.current = newId(); addExtra(tipo, { id: lastId.current, nombre: "", path: p, url: u, lado: gid }); }}
                onStampRaw={(raw, lines) => {
                  if (lastId.current) updateExtra(tipo, lastId.current, { rawPath: raw.path, rawUrl: raw.url, stampLines: lines });
                }}
                onDiscard={discardByPath}
              />
            </div>
          </Panel>
        );
      })}

      {trashed.length > 0 && (
        <Panel title={<span className="text-sm font-semibold text-slate-700">Papelera</span>} count={trashed.length} startOpen={false} extra={
          <>
            <button type="button" className="rounded-md px-2 py-1 text-xs text-brand-600 hover:bg-brand-50" onClick={() => trashed.forEach((e) => restoreExtra(tipo, e, sections))}>Restaurar todo</button>
            <button type="button" className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              onClick={() => { if (confirm(`¿Vaciar la papelera (${trashed.length} fotos)? No se puede deshacer.`)) mapExtras(tipo, (l) => l.filter((e) => !e.trashed)); }}>Vaciar</button>
          </>
        }>
          <div className="grid grid-cols-3 gap-1.5 p-3 sm:grid-cols-5 lg:grid-cols-8">
            {trashed.map((e) => (
              <div key={e.id} className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                <img src={e.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover opacity-70" />
                <div className="absolute inset-x-0 bottom-0 flex gap-0.5 bg-black/55 p-0.5">
                  <button type="button" className="flex-1 rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-800" onClick={() => restoreExtra(tipo, e, sections)}>Restaurar</button>
                  <button type="button" aria-label="Borrar definitivo" className="rounded bg-red-600 px-1.5 text-[10px] font-bold text-white" onClick={() => { if (confirm("¿Borrar definitivamente esta foto?")) removeExtra(tipo, e.id); }}>×</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {viewer && (
        <Viewer tipo={tipo} items={items} sections={sections} keys={viewer.keys} startKey={viewer.key} opciones={opciones} onEdit={onEdit} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

const pathOf = (c: GalleryItem, sections: Section[], extras: ExtraPhoto[]) => (c.kind === "extra" ? extras.find((e) => e.id === c.id)?.path : cellOf(sections, c)?.imagePath) ?? "";
const originalPathOf = (c: GalleryItem, sections: Section[], extras: ExtraPhoto[]) => (c.kind === "extra" ? extras.find((e) => e.id === c.id)?.originalPath : cellOf(sections, c)?.originalPath) ?? "";

function Panel({ title, count, extra, children, startOpen = true }: { title: React.ReactNode; count: number; extra?: React.ReactNode; children: React.ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {title}
        <span className="text-xs text-slate-400">({count} fotos)</span>
        <span className="ml-auto flex items-center gap-1">
          {extra}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Plegar" : "Desplegar"}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">{open ? "▲" : "▼"}</button>
        </span>
      </div>
      {open && <div className="border-t border-slate-100">{children}</div>}
    </div>
  );
}

function Grid({ list, sel, selMode, onOpen, onPick, onMarquee, onRemove }: {
  list: GalleryItem[]; sel: Set<string>; selMode: boolean; onOpen: (key: string) => void;
  onPick: (it: GalleryItem, mods: { shift: boolean; ctrl: boolean }) => void;
  onMarquee: (keys: string[], additive: boolean) => void; onRemove: (it: GalleryItem) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; t: number; key: string } | null>(null);
  const long = useRef(false);
  const drag = useRef<{ x: number; y: number; add: boolean } | null>(null);
  const dragged = useRef(false);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  if (!list.length) return <p className="text-xs text-slate-400">Sin fotos todavía.</p>;

  const clearPress = () => { if (press.current) window.clearTimeout(press.current.t); press.current = null; };
  const down = (ev: React.PointerEvent<HTMLDivElement>, it: GalleryItem) => {
    long.current = false;
    if (ev.pointerType === "mouse") {
      if (ev.button !== 0) return;
      const b = box.current!.getBoundingClientRect();
      drag.current = { x: ev.clientX - b.left, y: ev.clientY - b.top, add: ev.ctrlKey || ev.metaKey || ev.shiftKey };
      dragged.current = false;
      return;
    }
    // dedo: mantener pulsado = empezar a seleccionar
    clearPress();
    const t = window.setTimeout(() => {
      long.current = true;
      try { navigator.vibrate?.(20); } catch { /* sin vibración */ }
      onPick(it, { shift: false, ctrl: false });
    }, 420);
    press.current = { x: ev.clientX, y: ev.clientY, t, key: it.key };
  };
  const move = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (press.current && Math.hypot(ev.clientX - press.current.x, ev.clientY - press.current.y) > 9) clearPress();   // es un desplazamiento, no un toque largo
    const d = drag.current;
    if (!d || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const x = ev.clientX - b.left, y = ev.clientY - b.top;
    if (!dragged.current && Math.hypot(x - d.x, y - d.y) < 6) return;
    dragged.current = true;
    const r = { x: Math.min(x, d.x), y: Math.min(y, d.y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) };
    setRect(r);
    const keys: string[] = [];
    box.current.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => {
      const q = el.getBoundingClientRect();
      const ex = q.left - b.left, ey = q.top - b.top;
      if (ex < r.x + r.w && ex + q.width > r.x && ey < r.y + r.h && ey + q.height > r.y) keys.push(el.dataset.key!);
    });
    onMarquee(keys, d.add);
  };
  const up = () => { clearPress(); drag.current = null; setRect(null); };
  const click = (ev: React.MouseEvent, it: GalleryItem) => {
    if (dragged.current) { dragged.current = false; ev.preventDefault(); return; }
    if (long.current) { long.current = false; ev.preventDefault(); return; }
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || selMode) onPick(it, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey });
    else onOpen(it.key);
  };

  return (
    <div ref={box} className="relative grid select-none grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-8" style={{ WebkitTouchCallout: "none" }}
      onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => { clearPress(); }}>
      {list.map((e, i) => {
        const on = sel.has(e.key);
        return (
          <div key={e.key} data-key={e.key} onPointerDown={(ev) => down(ev, e)} onContextMenu={(ev) => ev.preventDefault()}
            className={`group relative aspect-square overflow-hidden rounded-md border bg-slate-100 ${on ? "border-brand-500 ring-2 ring-brand-500" : "border-slate-200"}`}>
            <button type="button" onClick={(ev) => click(ev, e)} className="h-full w-full touch-manipulation" title={e.nombre || "Ver foto"} aria-pressed={selMode ? on : undefined}>
              <img src={e.url} alt="" loading="lazy" decoding="async" draggable={false} className={`h-full w-full object-cover transition ${on ? "scale-95" : "group-hover:scale-105"}`} />
            </button>
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
            {e.edited && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-brand-600/90 px-1 text-[9px] font-semibold text-white">editada</span>}
            {(selMode || on) ? (
              <span className={`pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full border-2 text-[11px] font-bold ${on ? "border-brand-600 bg-brand-600 text-white" : "border-white bg-black/30 text-transparent"}`}>✓</span>
            ) : (
              <button type="button" onClick={() => onRemove(e)} aria-label="Mandar a la papelera" title="Mandar a la papelera"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold leading-none text-white shadow hover:bg-red-700">×</button>
            )}
          </div>
        );
      })}
      {rect && <div className="pointer-events-none absolute z-10 border border-brand-500 bg-brand-500/20" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
    </div>
  );
}

function Viewer({ tipo, items, sections, keys, startKey, opciones, onEdit, onClose }: {
  tipo: FotoTipo; items: GalleryItem[]; sections: Section[]; keys: string[]; startKey: string; opciones: Opcion[];
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
    trashItems(tipo, [e], sections);
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
        <button className="btn-secondary text-xs text-red-600" onClick={remove}>A la papelera</button>
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
            <button type="button" aria-label="Quitar foto" onClick={() => trashItems(tipo, [x], sections)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold leading-none text-white">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

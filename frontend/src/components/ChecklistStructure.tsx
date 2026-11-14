import { useState } from "react";
import { apiErrorMessage } from "../api/client";
import { Grip } from "../utils/dragSort";
import type { CkData, CkItem, CkParam, CkSection, CkType } from "../store/checklistTypes";

const uid = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const INP = "input !py-1 text-xs";
const BTN = "btn-secondary !px-2 !py-0.5 text-xs disabled:opacity-30";
const NUM = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-200 text-[11px] font-bold text-slate-700";

const move = <T,>(arr: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/** Arrastrar y soltar: coloca el elemento `from` antes/después de `to` (por posición). */
function dropIdx<T,>(arr: T[], from: number, to: number, after: boolean): T[] {
  if (from === to || from < 0 || to < 0) return arr;
  const rest = arr.filter((_, i) => i !== from);
  const t = to > from ? to - 1 : to;
  rest.splice(t + (after ? 1 : 0), 0, arr[from]);
  return rest;
}

/** Mueve un ítem antes/después de otro, aunque esté en otra sección. */
function moveItemTo(q: CkData, id: string, target: string, after: boolean): CkData {
  if (id === target) return q;
  const item = q.sections.flatMap((s) => s.items).find((x) => x.id === id);
  if (!item) return q;
  const removed = q.sections.map((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
  let done = false;
  const out = removed.map((s) => {
    const j = s.items.findIndex((x) => x.id === target);
    if (j < 0) return s;
    done = true;
    const items = [...s.items];
    items.splice(j + (after ? 1 : 0), 0, item);
    return { ...s, items };
  });
  return done ? { ...q, sections: out } : q;
}

/** Edita todo el checklist: nombre, secciones, ítems (texto/foto + comando) y parámetros. */
export default function ChecklistStructure({
  type, onSave, onDelete, isSuper, onPublish, onSetBase, onRestore,
}: {
  type: CkType;
  onSave: (nombre: string, data: CkData) => Promise<void>;
  onDelete: () => Promise<void>;
  isSuper?: boolean;
  onPublish?: (nombre: string, data: CkData) => Promise<void>;
  onSetBase?: (nombre: string, data: CkData) => Promise<void>;
  onRestore?: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState(type.nombre);
  const [d, setD] = useState<CkData>(() => JSON.parse(JSON.stringify(type.data)));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setSec = (si: number, fn: (s: CkSection) => CkSection) =>
    setD((p) => ({ ...p, sections: p.sections.map((s, i) => (i === si ? fn(s) : s)) }));
  const setItem = (si: number, ii: number, patch: Partial<CkItem>) =>
    setSec(si, (s) => ({ ...s, items: s.items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) }));
  const setParam = (pi: number, patch: Partial<CkParam>) =>
    setD((p) => ({ ...p, params: p.params.map((x, i) => (i === pi ? { ...x, ...patch } : x)) }));

  async function run(fn: () => Promise<void>, ok: string, fail: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(apiErrorMessage(e, fail));
    } finally {
      setBusy(false);
    }
  }
  const nm = () => nombre.trim() || type.nombre;
  const save = () => run(() => onSave(nm(), d), "Guardado (solo en tu cuenta)", "No se pudo guardar.");
  const publish = () => confirm("¿Actualizar este checklist para TODOS los usuarios con lo que ves ahora?") &&
    run(() => onPublish!(nm(), d), "Actualizado para todos", "No se pudo actualizar para todos.");
  const setBase = () => confirm("¿Poner esto como diseño base? También pasa a ser la versión de todos, y «Restaurar» volverá a esto.") &&
    run(() => onSetBase!(nm(), d), "Diseño base guardado", "No se pudo fijar el diseño base.");
  const restore = () => confirm("¿Restaurar al diseño base? Se pierden tus cambios no publicados de este checklist.") &&
    run(() => onRestore!(), "Restaurado al diseño base", "No se pudo restaurar.");

  return (
    <div className="space-y-2">
      <div className="card space-y-2 !p-3">
        <p className="text-xs text-slate-500">
          Aquí cambias cómo es este checklist. En los comandos puedes usar parámetros como <code>{"{WAN}"}</code>,{" "}
          <code>{"{NEXTHOP}"}</code>, <code>{"{REMOTE}"}</code>… (se piden al inicio). Un ítem sin comando es solo captura manual
          (por ejemplo Speedtest o iperf).
        </p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,2fr)_9rem_9rem_minmax(0,2.4fr)]">
          <label className="col-span-2 block text-sm lg:col-span-1">
            <span className="mb-0.5 block text-xs font-medium text-slate-500">Nombre del checklist</span>
            <input className="input w-full" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-0.5 block text-xs font-medium text-slate-500">Servicio</span>
            <select className="input w-full" value={d.servicio} onChange={(e) => setD({ ...d, servicio: e.target.value as CkData["servicio"] })}>
              <option value="internet">Internet</option>
              <option value="rpv">RPV</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-0.5 block text-xs font-medium text-slate-500">Marca del equipo</span>
            <select className="input w-full" value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })}>
              <option value="huawei">Huawei</option>
              <option value="cisco">Cisco</option>
              <option value="fortinet">Fortinet</option>
              <option value="otro">Otra</option>
            </select>
          </label>
          <label className="col-span-2 block text-sm lg:col-span-1">
            <span className="mb-0.5 block text-xs font-medium text-slate-500">Comandos de preparación (uno por línea)</span>
            <textarea className="input h-[38px] w-full resize-y font-mono text-xs" value={d.setup.join("\n")}
              onChange={(e) => setD({ ...d, setup: e.target.value.split("\n") })} />
          </label>
        </div>
      </div>

      <div className="card space-y-1.5 !p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Parámetros que se piden al inicio</h3>
          <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setD({ ...d, params: [...d.params, { key: "NUEVO", label: "Nuevo parámetro", default: "" }] })}>+ Parámetro</button>
        </div>
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {d.params.map((p, i) => (
            <div key={i} data-dnd="param" data-dnd-id={String(i)} className="min-w-0 space-y-1 rounded border border-slate-200 px-1.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <Grip kind="param" id={String(i)} label="Arrastra para cambiar el orden" onDrop={(t, a) => setD((q) => ({ ...q, params: dropIdx(q.params, i, Number(t), a) }))} />
                <span className={NUM}>{i + 1}</span>
                <input className={`${INP} min-w-0 flex-1 font-mono`} value={p.key} title="Nombre usado en los comandos: {NOMBRE}" placeholder="NOMBRE"
                  onChange={(e) => setParam(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
                <button className={BTN} title="Quitar" onClick={() => setD({ ...d, params: d.params.filter((_, j) => j !== i) })}>✕</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="min-w-0 text-[10px] text-slate-500">Descripción
                  <input className={`${INP} mt-0.5 w-full`} value={p.label} placeholder="Texto que verás" onChange={(e) => setParam(i, { label: e.target.value })} />
                </label>
                <label className="min-w-0 text-[10px] text-slate-500">Por defecto
                  <input className={`${INP} mt-0.5 w-full`} value={p.default} placeholder="Valor inicial" onChange={(e) => setParam(i, { default: e.target.value })} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {d.sections.map((sec, si) => (
        <div key={sec.id} data-dnd="section" data-dnd-id={sec.id} className="card space-y-1.5 !p-3">
          <div className="flex items-center gap-1.5">
            <Grip kind="section" id={sec.id} label="Arrastra para mover la sección" onDrop={(t, a) => setD((q) => ({ ...q, sections: dropIdx(q.sections, q.sections.findIndex((x) => x.id === sec.id), q.sections.findIndex((x) => x.id === t), a) }))} />
            <span className={`${NUM} !w-7 bg-sky-600 text-white`} title={`Sección en posición ${si + 1}`}>{si + 1}</span>
            <input className={`${INP} min-w-0 flex-1 font-semibold`} value={sec.titulo} onChange={(e) => setSec(si, (s) => ({ ...s, titulo: e.target.value }))} />
            <span className="hidden text-[11px] text-slate-400 sm:inline">{sec.items.length} ítems</span>
            <button className={BTN} disabled={si === 0} onClick={() => setD({ ...d, sections: move(d.sections, si, -1) })} title="Subir sección">↑</button>
            <button className={BTN} disabled={si === d.sections.length - 1} onClick={() => setD({ ...d, sections: move(d.sections, si, 1) })} title="Bajar sección">↓</button>
            <button className={BTN} title="Quitar sección" onClick={() => confirm("¿Borrar la sección y sus ítems?") && setD({ ...d, sections: d.sections.filter((_, j) => j !== si) })}>✕</button>
          </div>
          {sec.items.map((it, ii) => (
            <div key={it.id} data-dnd="item" data-dnd-id={it.id} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-1.5 rounded border border-slate-200 px-1.5 py-1 lg:grid-cols-[auto_auto_minmax(0,1fr)_5rem_auto_minmax(0,1.5fr)_auto]">
              <Grip kind="item" id={it.id} label="Arrastra para mover el ítem (también a otra sección)" onDrop={(t, a) => setD((q) => moveItemTo(q, it.id, t, a))} />
              <span className={`${NUM} !w-9`} title={`Posición ${si + 1}.${ii + 1}`}>{si + 1}.{ii + 1}</span>
              <input className={`${INP} min-w-0`} value={it.nombre} placeholder="Título del ítem" onChange={(e) => setItem(si, ii, { nombre: e.target.value })} />
              <div className="col-start-4 row-start-1 flex gap-1 lg:hidden">
                <button className={BTN} disabled={ii === 0} onClick={() => setSec(si, (s) => ({ ...s, items: move(s.items, ii, -1) }))}>↑</button>
                <button className={BTN} disabled={ii === sec.items.length - 1} onClick={() => setSec(si, (s) => ({ ...s, items: move(s.items, ii, 1) }))}>↓</button>
                <button className={BTN} onClick={() => setSec(si, (s) => ({ ...s, items: s.items.filter((_, j) => j !== ii) }))}>✕</button>
              </div>
              <select className={`${INP} col-span-2 w-full lg:col-span-1`} value={it.modo} onChange={(e) => setItem(si, ii, { modo: e.target.value as CkItem["modo"] })}>
                <option value="texto">Texto</option>
                <option value="foto">Foto</option>
              </select>
              <label className="col-span-2 flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-600 lg:col-span-1" title="Solo se captura mientras se satura el enlace">
                <input type="checkbox" checked={!!it.sat} onChange={(e) => setItem(si, ii, { sat: e.target.checked })} /> Sat.
              </label>
              <input className={`${INP} col-span-4 min-w-0 font-mono lg:col-span-1`} value={it.cmd} placeholder="Comando (vacío = captura manual)" onChange={(e) => setItem(si, ii, { cmd: e.target.value })} />
              <div className="hidden gap-1 lg:flex">
                <button className={BTN} title="Subir" disabled={ii === 0} onClick={() => setSec(si, (s) => ({ ...s, items: move(s.items, ii, -1) }))}>↑</button>
                <button className={BTN} title="Bajar" disabled={ii === sec.items.length - 1} onClick={() => setSec(si, (s) => ({ ...s, items: move(s.items, ii, 1) }))}>↓</button>
                <button className={BTN} title="Quitar" onClick={() => setSec(si, (s) => ({ ...s, items: s.items.filter((_, j) => j !== ii) }))}>✕</button>
              </div>
            </div>
          ))}
          <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setSec(si, (s) => ({ ...s, items: [...s.items, { id: uid(), nombre: "NUEVO ÍTEM", modo: "foto", cmd: "" }] }))}>+ Ítem</button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn-secondary text-sm" onClick={() => setD({ ...d, sections: [...d.sections, { id: uid(), titulo: "NUEVA SECCIÓN", items: [] }] })}>+ Sección</button>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
          <button
            className="text-sm text-red-500 hover:underline"
            disabled={busy}
            onClick={async () => {
              if (confirm("¿Borrar este checklist completo? No se puede deshacer.")) {
                try { await onDelete(); } catch (e) { setMsg(apiErrorMessage(e, "No se pudo borrar.")); }
              }
            }}
          >
            Borrar checklist
          </button>
          {onRestore && <button className="btn-secondary text-sm" onClick={restore} disabled={busy} title="Vuelve a la versión base de este checklist">Restaurar a diseño base</button>}
          {isSuper && onSetBase && <button className="btn-secondary text-sm" onClick={setBase} disabled={busy} title="Solo superadmin">Poner como diseño base</button>}
          {isSuper && onPublish && <button className="btn-secondary text-sm" onClick={publish} disabled={busy} title="Solo superadmin">Actualizar cambios para todos</button>}
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}

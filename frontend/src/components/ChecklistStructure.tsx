import { useState } from "react";
import { apiErrorMessage } from "../api/client";
import type { CkData, CkItem, CkParam, CkSection, CkType } from "../store/checklistTypes";

const uid = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const move = <T,>(arr: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/** Edita todo el checklist: nombre, secciones, ítems (texto/foto + comando) y parámetros. */
export default function ChecklistStructure({
  type, onSave, onDelete,
}: {
  type: CkType;
  onSave: (nombre: string, data: CkData) => Promise<void>;
  onDelete: () => Promise<void>;
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

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(nombre.trim() || type.nombre, d);
      setMsg("✔ Guardado");
    } catch (e) {
      setMsg(apiErrorMessage(e, "No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <p className="text-xs text-slate-500">
          Aquí cambias cómo es este checklist. En los comandos puedes usar parámetros como <code>{"{WAN}"}</code>,{" "}
          <code>{"{NEXTHOP}"}</code>, <code>{"{REMOTE}"}</code>… (se piden al inicio). Un ítem sin comando es solo captura manual
          (por ejemplo Speedtest o iperf).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-3">
            <span className="mb-1 block text-xs font-medium text-slate-500">Nombre del checklist</span>
            <input className="input w-full" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Servicio</span>
            <select className="input w-full" value={d.servicio} onChange={(e) => setD({ ...d, servicio: e.target.value as CkData["servicio"] })}>
              <option value="internet">Internet</option>
              <option value="rpv">RPV</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Marca del equipo</span>
            <select className="input w-full" value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })}>
              <option value="huawei">Huawei</option>
              <option value="cisco">Cisco</option>
              <option value="fortinet">Fortinet</option>
              <option value="otro">Otra</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Comandos de preparación (uno por línea)</span>
            <textarea className="input h-16 w-full font-mono text-xs" value={d.setup.join("\n")}
              onChange={(e) => setD({ ...d, setup: e.target.value.split("\n") })} />
          </label>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Parámetros que se piden al inicio</h3>
          <button className="btn-secondary text-xs" onClick={() => setD({ ...d, params: [...d.params, { key: "NUEVO", label: "Nuevo parámetro", default: "" }] })}>➕ Parámetro</button>
        </div>
        {d.params.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input className="input w-32 font-mono text-xs" value={p.key} title="Nombre usado en los comandos: {NOMBRE}"
              onChange={(e) => setParam(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} />
            <input className="input min-w-[160px] flex-1" value={p.label} placeholder="Texto que verás" onChange={(e) => setParam(i, { label: e.target.value })} />
            <input className="input w-36" value={p.default} placeholder="Valor por defecto" onChange={(e) => setParam(i, { default: e.target.value })} />
            <button className="btn-secondary text-xs" onClick={() => setD({ ...d, params: d.params.filter((_, j) => j !== i) })}>🗑</button>
          </div>
        ))}
      </div>

      {d.sections.map((sec, si) => (
        <div key={sec.id} className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-[200px] flex-1 font-semibold" value={sec.titulo} onChange={(e) => setSec(si, (s) => ({ ...s, titulo: e.target.value }))} />
            <button className="btn-secondary text-xs" onClick={() => setD({ ...d, sections: move(d.sections, si, -1) })} title="Subir sección">↑</button>
            <button className="btn-secondary text-xs" onClick={() => setD({ ...d, sections: move(d.sections, si, 1) })} title="Bajar sección">↓</button>
            <button className="btn-secondary text-xs" onClick={() => confirm("¿Borrar la sección y sus ítems?") && setD({ ...d, sections: d.sections.filter((_, j) => j !== si) })}>🗑</button>
          </div>
          {sec.items.map((it, ii) => (
            <div key={it.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2">
              <input className="input min-w-[200px] flex-1" value={it.nombre} placeholder="Título del ítem" onChange={(e) => setItem(si, ii, { nombre: e.target.value })} />
              <select className="input w-24" value={it.modo} onChange={(e) => setItem(si, ii, { modo: e.target.value as CkItem["modo"] })}>
                <option value="texto">Texto</option>
                <option value="foto">Foto</option>
              </select>
              <input className="input min-w-[220px] flex-1 font-mono text-xs" value={it.cmd} placeholder="Comando (vacío = solo captura manual)" onChange={(e) => setItem(si, ii, { cmd: e.target.value })} />
              <button className="btn-secondary text-xs" onClick={() => setSec(si, (s) => ({ ...s, items: move(s.items, ii, -1) }))}>↑</button>
              <button className="btn-secondary text-xs" onClick={() => setSec(si, (s) => ({ ...s, items: move(s.items, ii, 1) }))}>↓</button>
              <button className="btn-secondary text-xs" onClick={() => setSec(si, (s) => ({ ...s, items: s.items.filter((_, j) => j !== ii) }))}>🗑</button>
            </div>
          ))}
          <button className="btn-secondary text-xs" onClick={() => setSec(si, (s) => ({ ...s, items: [...s.items, { id: uid(), nombre: "NUEVO ÍTEM", modo: "foto", cmd: "" }] }))}>➕ Ítem</button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn-secondary text-sm" onClick={() => setD({ ...d, sections: [...d.sections, { id: uid(), titulo: "NUEVA SECCIÓN", items: [] }] })}>➕ Sección</button>
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
            🗑 Borrar checklist
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}

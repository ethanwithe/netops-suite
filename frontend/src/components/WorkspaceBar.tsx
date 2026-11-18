import { useState } from "react";
import { setAutosave } from "../store/autosave";
import type { VersionInfo, WsApi } from "../store/workspaces";

/** Aviso y estado del guardado automático por SOT (ver store/workspaces.ts). */
export default function WorkspaceBar({ ws }: { ws: WsApi }) {
  if (ws.conflict) {
    const c = ws.conflict;
    const fmt = (iso: string) => new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
    const when = c.updated_at ? fmt(c.updated_at) : "";
    const hasSaved = !!c.updated_at;
    const hasTemp = c.temp !== undefined;
    const tempWhen = c.tempAt ? new Date(c.tempAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "";
    return (
      <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm text-amber-900" role="alert">
        <p>
          {c.shrink
            ? <><b>Lo que tienes en pantalla tiene mucho menos que lo ya guardado de la SOT {c.sot}.</b> No se guardó para no perder datos. Elige con cuál seguir (lo otro queda en «Recuperar copias anteriores»).</>
            : hasTemp
              ? <><b>Quedaron cambios sin subir de la SOT {c.sot}</b> guardados temporalmente en este equipo{tempWhen ? ` (${tempWhen})` : ""}{hasSaved ? `, y en el servidor hay otra versión${when ? ` (${when})` : ""}` : ""}. Elige con cuál seguir.</>
              : <><b>Hay datos guardados de la SOT {c.sot} en esta ventana</b>{when ? ` (${when})` : ""}: fotos, textos y opciones. ¿Quieres traerlos para seguir editando?</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {hasTemp && <button type="button" className="btn-primary text-xs" onClick={ws.loadTemp}>{c.shrink ? "Seguir con lo de pantalla" : "Recuperar lo temporal"}</button>}
          {hasSaved && <button type="button" className={hasTemp ? "btn-secondary text-xs" : "btn-primary text-xs"} onClick={ws.load}>Cargar lo guardado</button>}
          {!hasTemp && <button type="button" className="btn-secondary text-xs" onClick={ws.keepMine} title="Lo que tienes en pantalla reemplazará lo guardado para esta SOT (lo anterior queda en copias anteriores)">Seguir con lo que tengo</button>}
        </div>
      </div>
    );
  }
  const txt = !ws.hasSot
    ? "Escribe la SOT para poder guardar lo de esta ventana en «Datos de cliente» (fotos, textos y PDF)."
    : ws.status?.kind === "saving" ? "Guardando…"
    : ws.dirty ? (ws.autosave ? "Guardando en unos segundos…" : "Cambios sin guardar")
    : ws.status?.kind === "saved" ? `Guardado en Datos de cliente · ${ws.status.at}`
    : ws.offline || ws.status?.kind === "error" ? "Sin conexión: todo queda guardado temporal en este equipo y se sube solo al volver Internet."
    : ws.autosave ? "Guardado automático activado para esta SOT." : "Guardado automático apagado: usa «Guardar».";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-slate-600" title="Si lo apagas, solo se guarda cuando pulses «Guardar» o aceptes guardar al cambiar de cliente o de ventana">
        <button type="button" role="switch" aria-checked={ws.autosave} onClick={() => setAutosave(!ws.autosave)}
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${ws.autosave ? "bg-emerald-500" : "bg-slate-300"}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${ws.autosave ? "left-3.5" : "left-0.5"}`} />
        </button>
        Guardar en automático: <b>{ws.autosave ? "Sí" : "No"}</b>
      </label>
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" disabled={!ws.hasSot} onClick={() => void ws.save()}>Guardar</button>
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => void ws.clear()} title="Vacía la pantalla para otro cliente; lo guardado no se borra">Limpiar</button>
      <p className={`text-[11px] ${ws.offline || ws.status?.kind === "error" ? "text-amber-600" : ws.dirty && !ws.autosave ? "font-medium text-amber-600" : "text-slate-500"}`} aria-live="polite">☁ {txt}</p>
      {ws.hasSot && <Versions ws={ws} />}
    </div>
  );
}

/** «Recuperar»: lista las copias anteriores de esta ventana para volver a una si algo se borró por error. */
function Versions({ ws }: { ws: WsApi }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [msg, setMsg] = useState("");
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) { try { setList(await ws.versions()); } catch { setList([]); } }
  }
  async function pick(v: VersionInfo) {
    if (!confirm("¿Volver a esta copia? Lo que tienes ahora también queda guardado como copia.")) return;
    try { await ws.recover(v.id); setMsg("Copia recuperada."); setOpen(false); } catch { setMsg("No se pudo recuperar."); }
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  return (
    <span className="relative">
      <button type="button" className="text-[11px] text-brand-600 hover:underline" onClick={toggle}>Recuperar copias anteriores</button>
      {msg && <span className="ml-2 text-[11px] text-emerald-600">{msg}</span>}
      {open && (
        <div className="card absolute left-0 z-30 mt-1 max-h-64 w-64 space-y-1 overflow-y-auto p-2">
          {list === null ? <p className="text-xs text-slate-500">Cargando…</p> : list.length === 0 ? <p className="text-xs text-slate-500">Todavía no hay copias anteriores.</p> : list.map((v) => (
            <button key={v.id} type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-100" onClick={() => void pick(v)}>
              {fmt(v.saved_at)} <span className="text-slate-400">{v.saved_by}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

import { useState } from "react";
import type { VersionInfo, WsApi } from "../store/workspaces";

/** Aviso y estado del guardado automático por SOT (ver store/workspaces.ts). */
export default function WorkspaceBar({ ws }: { ws: WsApi }) {
  if (ws.conflict) {
    const when = ws.conflict.updated_at ? new Date(ws.conflict.updated_at + (ws.conflict.updated_at.endsWith("Z") ? "" : "Z")).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "";
    return (
      <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm text-amber-900" role="alert">
        <p>
          <b>Hay datos guardados de la SOT {ws.conflict.sot} en esta ventana</b>{when ? ` (${when})` : ""}: fotos, textos y opciones. ¿Quieres traerlos para seguir editando?
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-xs" onClick={ws.load}>Cargar lo guardado</button>
          <button type="button" className="btn-secondary text-xs" onClick={ws.keepMine} title="Lo que tienes en pantalla reemplazará lo guardado para esta SOT">Seguir con lo que tengo</button>
        </div>
      </div>
    );
  }
  const txt = !ws.hasSot
    ? "Escribe la SOT y todo lo de esta ventana se guarda solo en «Datos de cliente» (fotos, textos y PDF)."
    : ws.status?.kind === "saving" ? "Guardando…"
    : ws.status?.kind === "saved" ? `Guardado automático en Datos de cliente · ${ws.status.at}`
    : ws.status?.kind === "error" ? "No se pudo guardar (sin conexión). Se reintenta con el próximo cambio."
    : "Guardado automático activado para esta SOT.";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className={`text-[11px] ${ws.status?.kind === "error" ? "text-red-600" : "text-slate-500"}`} aria-live="polite">☁ {txt}</p>
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

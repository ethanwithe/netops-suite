import { useEffect, useState } from "react";
import { listOps, resolveConflict, syncNow, useSyncStatus } from "../sync/engine";
import type { QueuedOp, SyncState } from "../sync/engine";

const LABEL: Record<SyncState, string> = {
  LOCAL: "Solo en este equipo", PENDING_SYNC: "Pendiente de subir", SYNCING: "Subiendo…", SYNCED: "Sincronizado", SYNC_ERROR: "Error", CONFLICT: "Conflicto",
};
const COLOR: Record<SyncState, string> = {
  LOCAL: "bg-slate-200 text-slate-700", PENDING_SYNC: "bg-amber-100 text-amber-800", SYNCING: "bg-sky-100 text-sky-800",
  SYNCED: "bg-emerald-100 text-emerald-800", SYNC_ERROR: "bg-red-100 text-red-700", CONFLICT: "bg-orange-200 text-orange-900",
};

function ago(iso: string): string {
  if (!iso) return "todavía no";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}

/** Indicador global: conexión, pendientes, fotos, última sincronización, errores y «Sincronizar ahora». */
export default function SyncIndicator() {
  const st = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    const load = () => { void listOps().then((o) => { if (!dead) setOps(o); }); };
    load();
    const t = window.setInterval(load, 2000);
    return () => { dead = true; window.clearInterval(t); };
  }, [open, st.pendingOps, st.pendingPhotos, st.running]);

  const pending = st.pendingOps + st.pendingPhotos;
  const tone = !st.online ? "bg-slate-500" : st.conflicts.length ? "bg-orange-500" : st.errors || st.needsLogin ? "bg-red-500" : pending ? "bg-amber-500" : "bg-emerald-500";
  const text = !st.online ? "Sin conexión" : st.running ? "Sincronizando…" : st.conflicts.length ? `${st.conflicts.length} conflicto${st.conflicts.length > 1 ? "s" : ""}` : pending ? `${pending} pendiente${pending > 1 ? "s" : ""}` : "Sincronizado";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold" title="Estado de conexión y sincronización" aria-expanded={open}>
        <span className={`h-2 w-2 rounded-full ${tone} ${st.running ? "animate-pulse" : ""}`} />
        <span className="hidden sm:inline">{text}</span>
      </button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-[min(22rem,92vw)] space-y-2 p-3 text-xs" role="dialog" aria-label="Sincronización">
          <div className="flex items-center justify-between">
            <b className="text-sm">{st.online ? "En línea" : "Sin conexión"}</b>
            <button type="button" className="btn-primary !px-2.5 !py-1 text-xs" disabled={!st.online || st.running} onClick={() => void syncNow(true)}>{st.running ? "Sincronizando…" : "Sincronizar ahora"}</button>
          </div>
          <ul className="space-y-0.5 text-slate-600">
            <li>Registros pendientes: <b>{st.pendingOps}</b></li>
            <li>Fotografías pendientes: <b>{st.pendingPhotos}</b></li>
            <li>Última sincronización: <b>{ago(st.lastSync)}</b></li>
          </ul>
          {!st.online && <p className="rounded bg-slate-100 p-2 text-slate-600">Puedes seguir trabajando: todo se guarda en este equipo y se sube solo al volver Internet.</p>}
          {(st.lastError || st.needsLogin) && <p className="rounded bg-red-50 p-2 text-red-700">{st.lastError}</p>}
          {ops.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {ops.map((o) => (
                <div key={o.op_id} className="rounded border border-slate-200 p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{o.label}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${COLOR[o.state]}`}>{LABEL[o.state]}</span>
                  </div>
                  {o.error && <p className="mt-0.5 text-red-600">{o.error}</p>}
                  {o.state === "CONFLICT" && (
                    <div className="mt-1 space-y-1">
                      <p className="text-orange-800">{o.reason === "shrink" ? "Lo de este equipo tiene mucho menos que lo guardado." : o.reason === "duplicate_sot" ? "Ya existe un cliente con esa SOT." : "Otro dispositivo cambió esto mientras trabajabas sin conexión."}</p>
                      <div className="flex gap-1.5">
                        <button type="button" className="btn-primary !px-2 !py-0.5 text-[11px]" onClick={() => void resolveConflict(o.op_id, "mine")} title="Lo de este equipo reemplaza lo del servidor (lo anterior queda en copias anteriores)">Usar lo mío</button>
                        <button type="button" className="btn-secondary !px-2 !py-0.5 text-[11px]" onClick={() => void resolveConflict(o.op_id, "theirs")} title="Se descarta lo de este equipo y se queda lo del servidor">Usar lo del servidor</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

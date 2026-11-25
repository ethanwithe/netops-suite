import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { setAutoSync, useSyncStatus } from "../sync/engine";
import SyncIndicator from "./SyncIndicator";
import CloudStatus from "./CloudStatus";

interface CloudBrief { enabled: boolean; paused?: boolean; state?: string; running?: boolean; linked?: boolean; conflicts?: unknown[] }

/**
 * Interruptor de sincronización en la barra superior: encendido = sincroniza solo en cuanto hay Internet (y al volver);
 * apagado = en pausa. Al encenderlo sincroniza en ese momento. El detalle (pendientes, conflictos, reparar…) está
 * en el botón «i» y se cierra al tocar fuera o con Esc: nada queda flotando.
 */
export default function SyncToggle() {
  const st = useSyncStatus();
  const desktop = !!import.meta.env.VITE_DESKTOP;
  const [cloud, setCloud] = useState<CloudBrief | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => { try { setCloud((await api.get<CloudBrief>("/cloud/status")).data); } catch { /* sin datos */ } }, []);
  useEffect(() => {
    if (!desktop) return;
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [desktop, load]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const cloudOn = desktop && !!cloud?.enabled;
  const on = st.auto && !(cloudOn && cloud?.paused);
  const cloudProblem = cloudOn && (cloud?.state === "conflict" || cloud?.state === "error" || cloud?.state === "needs_login");
  const pending = st.pendingOps + st.pendingPhotos + st.pendingOutputs;
  const problem = st.conflicts.length > 0 || st.errors > 0 || st.needsLogin || cloudProblem;
  const busy = st.running || (cloudOn && !!cloud?.running);

  async function toggle() {
    const next = !on;
    setAutoSync(next);                               // web: pausa o reanuda (al encender sincroniza ya)
    if (cloudOn) { try { await api.post("/cloud/pause", { paused: !next }); } catch { /* se reintenta al abrir */ } void load(); }
  }

  const text = !on ? "Apagada" : !st.online ? "Sin conexión" : busy ? "Sincronizando…" : problem ? "Revisar" : pending ? `${pending} pendiente${pending > 1 ? "s" : ""}` : "Al día";
  const dot = !on ? "bg-slate-400" : !st.online ? "bg-slate-500" : problem ? "bg-orange-500" : pending ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="relative" ref={box}>
      <div className="flex items-center gap-1.5 rounded-full border border-white/20 py-0.5 pl-2 pr-1 text-[11px] font-semibold">
        <button type="button" role="switch" aria-checked={on} onClick={() => void toggle()} className="flex items-center gap-1.5"
          title={on ? "Sincronización automática encendida: toca para apagarla" : "Sincronización apagada: toca para encenderla y sincronizar ahora"}>
          <span className={`h-2 w-2 rounded-full ${dot} ${busy && on ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{text}</span>
          <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-500/60"}`} aria-hidden="true">
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "left-3.5" : "left-0.5"}`} />
          </span>
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Detalle de la sincronización"
          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${problem ? "bg-orange-500 text-white" : "bg-white/15"}`}>{problem ? "!" : "i"}</button>
      </div>
      {open && (
        <div className="pop-mobile card absolute right-0 z-50 mt-2 max-h-[80vh] w-[min(24rem,92vw)] space-y-2 overflow-y-auto p-3 text-xs text-slate-800" role="dialog" aria-label="Sincronización">
          <div className="flex items-center justify-between">
            <b className="text-sm">Sincronización {on ? "encendida" : "apagada"}</b>
            <button type="button" className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>
          </div>
          <SyncIndicator embedded />
          {desktop && <CloudStatus embedded />}
        </div>
      )}
    </div>
  );
}

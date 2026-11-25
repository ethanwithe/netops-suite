import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface Conflict { entity: string; id: string; label: string; reason: string; server_updated_at: string; server_deleted: boolean }
interface Cloud { enabled: boolean; url?: string; linked?: boolean; state?: string; running?: boolean; last_sync?: string; error?: string; pending?: number; conflicts?: Conflict[]; user?: string; sent?: number; received?: number; local?: { clients: number } }

const TEXT: Record<string, string> = {
  synced: "Nube: sincronizado", syncing: "Nube: sincronizando…", offline: "Nube: sin conexión (se sube solo al volver)",
  conflict: "Nube: hay conflictos", error: "Nube: error", needs_login: "Nube: inicia sesión con Internet", unlinked: "Nube: sin vincular", idle: "Nube",
};
const TONE: Record<string, string> = {
  synced: "bg-emerald-500", syncing: "bg-sky-500 animate-pulse", offline: "bg-slate-400", conflict: "bg-orange-500", error: "bg-red-500", needs_login: "bg-red-500", unlinked: "bg-slate-400", idle: "bg-slate-400",
};

/** Solo en la app de escritorio: estado de la sincronización con la nube y resolución de conflictos. */
export default function CloudStatus() {
  const [c, setC] = useState<Cloud | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { try { setC((await api.get<Cloud>("/cloud/status")).data); } catch { /* sin datos */ } }, []);
  useEffect(() => {
    if (!import.meta.env.VITE_DESKTOP) return;
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);
  if (!import.meta.env.VITE_DESKTOP || !c?.enabled) return null;
  const state = c.running ? "syncing" : (c.state ?? "idle");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setMsg("");
    try { await fn(); await load(); } catch (e) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setMsg(d || "No se pudo completar.");
    } finally { setBusy(false); }
  }
  const when = c.last_sync ? new Date(c.last_sync).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "todavía no";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold" title={TEXT[state]} aria-expanded={open}>
        <span className={`h-2 w-2 rounded-full ${TONE[state]}`} />
        <span className="hidden sm:inline">☁ {state === "conflict" ? `${c.conflicts?.length ?? 0} conflicto(s)` : state === "synced" ? "Nube" : TEXT[state].replace("Nube: ", "")}</span>
      </button>
      {open && (
        <div className="pop-mobile card absolute right-0 z-50 mt-2 w-[min(24rem,92vw)] space-y-2 p-3 text-xs text-slate-800" role="dialog" aria-label="Nube">
          <div className="flex items-center justify-between gap-2">
            <b className="text-sm">{TEXT[state]}</b>
            <button type="button" className="btn-primary !px-2.5 !py-1 text-xs" disabled={busy || !c.linked} onClick={() => void run(() => api.post("/cloud/sync"))}>{busy ? "Sincronizando…" : "Sincronizar ahora"}</button>
          </div>
          <p className="text-slate-600">Cuenta: <b>{c.user}</b> · Clientes en este equipo: <b>{c.local?.clients ?? 0}</b> · Última vez: subió <b>{c.sent ?? 0}</b>, bajó <b>{c.received ?? 0}</b></p>
          <button type="button" className="btn-secondary !px-2 !py-1 text-xs" disabled={busy || !c.linked} title="Vuelve a comparar todo con la nube desde cero. No borra nada."
            onClick={() => void run(() => api.post("/cloud/repair"))}>Reparar: volver a comparar todo</button>
          <p className="text-slate-600">Servidor: <span className="font-mono">{c.url}</span><br />Última sincronización: <b>{when}</b></p>
          {!c.linked && <p className="text-amber-700">Esta cuenta aún no está vinculada con la nube. Cierra sesión y entra con tu usuario de la nube teniendo Internet.</p>}
          {state === "needs_login" && <p className="text-amber-700">La sesión con la nube venció. Cierra sesión y vuelve a entrar con Internet; lo que hiciste está guardado y se sube después.</p>}
          {c.error && state !== "synced" && <p className="text-red-600">{c.error}</p>}
          {!!c.conflicts?.length && (
            <div className="space-y-2">
              <p className="font-semibold text-orange-800">Se cambió lo mismo aquí y en la nube. Elige cuál conservar (nada se pisa solo):</p>
              {c.conflicts.map((k) => (
                <div key={k.entity + k.id} className="rounded border border-orange-200 bg-orange-50 p-2">
                  <p className="font-medium">{k.label}</p>
                  {k.reason === "duplicate_sot" && <p className="text-slate-600">Esa SOT ya existe en la nube con otro registro.</p>}
                  {k.server_deleted && <p className="text-slate-600">En la nube fue eliminado.</p>}
                  <div className="mt-1 flex gap-2">
                    <button type="button" className="btn-secondary !px-2 !py-0.5 text-xs" disabled={busy || k.reason === "duplicate_sot"} onClick={() => void run(() => api.post("/cloud/resolve", { entity: k.entity, id: k.id, resolution: "mine" }))}>Quedarme con lo de este equipo</button>
                    <button type="button" className="btn-secondary !px-2 !py-0.5 text-xs" disabled={busy} onClick={() => void run(() => api.post("/cloud/resolve", { entity: k.entity, id: k.id, resolution: "theirs" }))}>Usar lo de la nube</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="text-red-600">{msg}</p>}
        </div>
      )}
    </div>
  );
}

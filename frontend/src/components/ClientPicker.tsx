import { useEffect, useState } from "react";
import { apiErrorMessage } from "../api/client";
import { listClients } from "../store/clients";
import type { ClientRecord } from "../store/clients";

/** Elige un cliente guardado (por SOT o nombre) para rellenar los datos de la ventana. */
export default function ClientPicker({ onPick }: { onPick: (c: ClientRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setErr("");
    let alive = true;
    const t = window.setTimeout(() => {
      listClients({ q }).then((r) => { if (alive) setRows(r.slice(0, 50)); })
        .catch((e) => { if (alive) { setRows([]); setErr(apiErrorMessage(e, "No se pudo cargar la lista de clientes.")); } })
        .finally(() => { if (alive) setLoading(false); });
    }, q ? 250 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [open, q, tick]);

  return (
    <div className="relative">
      <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(!open)}>
        Elegir cliente guardado
      </button>
      {open && (
        <div className="pop-mobile absolute left-0 top-full z-20 mt-1 w-[min(92vw,26rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <input className="input w-full" autoFocus placeholder="Buscar por SOT o nombre..." value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {loading && <li className="px-2 py-1 text-xs text-slate-400">Buscando...</li>}
            {!loading && err && (
              <li className="px-2 py-1 text-xs text-red-600">{err} <button type="button" className="underline" onClick={() => setTick((n) => n + 1)}>Reintentar</button></li>
            )}
            {!loading && !err && rows.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">{q ? "Ningún cliente coincide con esa búsqueda." : "No hay clientes guardados para tu cuenta todavía."}</li>}
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                  onClick={() => { onPick(c); setOpen(false); }}>
                  <span className="font-medium">SOT {c.sot}</span> · {c.nombre || "(sin nombre)"}
                  <span className="block text-[11px] text-slate-400">{c.fecha}{c.cid ? ` · CID ${c.cid}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

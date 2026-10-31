import { useEffect, useState } from "react";
import { listClients } from "../store/clients";
import type { ClientRecord } from "../store/clients";

/** Elige un cliente guardado (por SOT o nombre) para rellenar los datos de la ventana. */
export default function ClientPicker({ onPick }: { onPick: (c: ClientRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = window.setTimeout(() => {
      listClients({ q }).then((r) => setRows(r.slice(0, 30))).catch(() => setRows([])).finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, q]);

  return (
    <div className="relative">
      <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(!open)}>
        👥 Elegir cliente guardado
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-[min(92vw,26rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <input className="input w-full" autoFocus placeholder="Buscar por SOT o nombre..." value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {loading && <li className="px-2 py-1 text-xs text-slate-400">Buscando...</li>}
            {!loading && rows.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">No hay clientes guardados todavía.</li>}
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

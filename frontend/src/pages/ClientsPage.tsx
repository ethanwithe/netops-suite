import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import Spinner from "../components/Spinner";
import { usePersistentState } from "../store/persistentState";
import { createClient, deleteClient, listClients, updateClient } from "../store/clients";
import type { ClientInput, ClientRecord } from "../store/clients";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** /clientes (todos, con buscador) y /clientes/:year (por meses). */
export default function ClientsPage() {
  const { year } = useParams();
  const y = year ? Number(year) : undefined;
  const [rows, setRows] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [month, setMonth] = usePersistentState(`clients.month.${y ?? "all"}`, new Date().getMonth() + 1);
  const [editing, setEditing] = useState<ClientRecord | "new" | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    return listClients({ year: y, q })
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(apiErrorMessage(e, "No se pudieron cargar los clientes.")))
      .finally(() => setLoading(false));
  }, [y, q]);

  useEffect(() => {
    const t = window.setTimeout(() => void reload(), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [reload, q]);

  const perMonth = useMemo(() => {
    const c = Array(12).fill(0);
    for (const r of rows) {
      const m = Number((r.fecha || "").slice(5, 7));
      if (m >= 1 && m <= 12) c[m - 1]++;
    }
    return c;
  }, [rows]);

  const shown = y ? rows.filter((r) => Number((r.fecha || "").slice(5, 7)) === month) : rows;
  const defaultDate = y ? `${y}-${String(month).padStart(2, "0")}-${String(Math.min(new Date().getDate(), 28)).padStart(2, "0")}` : new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{y ? `Clientes ${y}` : "Datos de clientes"}</h2>
        <p className="text-sm text-slate-500">
          Cada cliente se guarda por <b>SOT</b>, nombre y fecha, y queda en el año y el mes de la <b>fecha de sus datos</b> (no la de creación).
          Lo que se agregue de esa SOT en cualquier ventana (IPs, CID, reportes generados…) se suma aquí solo.
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-2">
        <input className="input min-w-[200px] flex-1" placeholder="Buscar por SOT, nombre, CID o proyecto..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary text-sm" onClick={() => setEditing("new")}>Agregar cliente</button>
      </div>

      {y && (
        <div className="flex flex-wrap gap-2">
          {MESES.map((m, i) => (
            <button key={m} className={`${month === i + 1 ? "btn-primary" : "btn-secondary"} text-xs`} onClick={() => setMonth(i + 1)}>
              {m} <span className="opacity-70">({perMonth[i]})</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <Spinner /> : shown.length === 0 ? (
        <div className="card text-sm text-slate-500">
          {q ? "Sin resultados." : y ? `No hay clientes en ${MESES[month - 1]} ${y}.` : "Aún no hay clientes. Agrega uno, o escribe una SOT en el reporte fotográfico o el checklist y se guardará solo."}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((c) => (
            <ClientCard key={c.id} c={c} onEdit={() => setEditing(c)} showMonth={!y} />
          ))}
        </div>
      )}

      {editing && (
        <ClientEditor
          initial={editing === "new" ? undefined : editing}
          defaultDate={defaultDate}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}

function ClientCard({ c, onEdit, showMonth }: { c: ClientRecord; onEdit: () => void; showMonth: boolean }) {
  const [open, setOpen] = useState(false);
  const m = Number(c.fecha.slice(5, 7));
  const datos = Object.entries(c.datos || {});
  return (
    <div className="card space-y-2">
      <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen(!open)}>
        <span className="font-semibold text-slate-800">SOT {c.sot}</span>
        <span className="flex-1 min-w-[160px] text-slate-700">{c.nombre || <i className="text-slate-400">(sin nombre)</i>}</span>
        <span className="text-xs text-slate-500">{c.fecha}{showMonth && m ? ` · ${MESES[m - 1]}` : ""}</span>
        <span className="text-xs">{open ? "Ocultar" : "Ver"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 pt-2 text-sm">
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <p><span className="text-slate-500">CID:</span> {c.cid || "—"}</p>
            <p><span className="text-slate-500">PROY:</span> {c.proy || "—"}</p>
            <p className="sm:col-span-2"><span className="text-slate-500">CONTRATA:</span> {c.contrata || "—"}</p>
          </div>
          {datos.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500">Datos asociados (IPs, interfaces…)</p>
              <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {datos.map(([k, v]) => <li key={k} className="font-mono text-xs"><b>{k}:</b> {v}</li>)}
              </ul>
            </div>
          )}
          {c.reportes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500">Reportes generados</p>
              <ul className="space-y-0.5">
                {c.reportes.map((r, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-slate-400">{r.generado} · {r.nombre || r.tipo} · </span>
                    {r.url ? <a className="text-brand-600 hover:underline break-all" href={r.url} target="_blank" rel="noreferrer">{r.filename}</a> : r.filename}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn-secondary text-xs" onClick={onEdit}>Editar</button>
        </div>
      )}
    </div>
  );
}

function ClientEditor({ initial, defaultDate, onClose, onSaved }: {
  initial?: ClientRecord; defaultDate: string; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<ClientInput>({
    sot: initial?.sot ?? "", nombre: initial?.nombre ?? "", fecha: initial?.fecha ?? defaultDate,
    cid: initial?.cid ?? "", proy: initial?.proy ?? "", contrata: initial?.contrata ?? "",
  });
  const [datos, setDatos] = useState<[string, string][]>(Object.entries(initial?.datos ?? {}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function save() {
    if (!f.sot.trim()) { setError("La SOT es obligatoria."); return; }
    setBusy(true);
    setError(null);
    const body = { ...f, datos: Object.fromEntries(datos.filter(([k]) => k.trim())) };
    try {
      if (initial) await updateClient(initial.id, body);
      else await createClient(body);
      onSaved();
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo guardar."));
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !confirm(`¿Borrar el cliente SOT ${initial.sot}? No se puede deshacer.`)) return;
    setBusy(true);
    try { await deleteClient(initial.id); onSaved(); navigate(0); } catch (e) { setError(apiErrorMessage(e, "No se pudo borrar.")); setBusy(false); }
  }

  const field = (label: string, key: keyof ClientInput, type = "text", cls = "") => (
    <label className={`block text-sm ${cls}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input type={type} className="input w-full" value={(f[key] as string) ?? ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8">
      <div className="card w-full max-w-2xl space-y-3">
        <h3 className="text-lg font-semibold text-slate-800">{initial ? "Editar cliente" : "Agregar cliente"}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("SOT", "sot")}
          {field("Fecha (define el año y el mes)", "fecha", "date")}
          {field("Nombre del cliente", "nombre", "text", "sm:col-span-2")}
          {field("CID", "cid")}
          {field("PROY", "proy")}
          {field("CONTRATA", "contrata", "text", "sm:col-span-2")}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Datos asociados (IPs, interfaces…)</p>
            <button className="btn-secondary text-xs" onClick={() => setDatos([...datos, ["", ""]])}>+ Dato</button>
          </div>
          {datos.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <input className="input w-36 font-mono text-xs" placeholder="Nombre (IP WAN)" value={k} onChange={(e) => setDatos(datos.map((d, j) => (j === i ? [e.target.value, d[1]] : d)))} />
              <input className="input flex-1" placeholder="Valor" value={v} onChange={(e) => setDatos(datos.map((d, j) => (j === i ? [d[0], e.target.value] : d)))} />
              <button className="btn-secondary text-xs" onClick={() => setDatos(datos.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {initial ? <button className="text-sm text-red-500 hover:underline" onClick={remove} disabled={busy}>Borrar cliente</button> : <span />}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando..." : "Guardar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

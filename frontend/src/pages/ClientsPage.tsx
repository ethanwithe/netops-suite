import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiErrorMessage, setActingClient } from "../api/client";
import Spinner from "../components/Spinner";
import { usePersistentState } from "../store/persistentState";
import { createClient, deleteClient, listClients, listTrash, restoreClient, updateClient } from "../store/clients";
import { adminPurge, adminRestore, exportClientUrl, exportClientsUrl, FORMATS, listAllClients, listUsers, mergeClients, setParticipants } from "../store/admin";
import type { AdminUser } from "../store/admin";
import { can, useAuth } from "../store/auth";
import type { ClientInput, ClientRecord } from "../store/clients";
import { deleteWorkspace, listWorkspaces, requestOpen } from "../store/workspaces";
import type { WorkspaceInfo } from "../store/workspaces";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** /clientes (mis clientes), /clientes/:year (por meses) y, para administradores, /admin/clientes (clientes de todos). */
export default function ClientsPage({ all = false }: { all?: boolean }) {
  const { me } = useAuth();
  const { year } = useParams();
  const y = year ? Number(year) : undefined;
  const [rows, setRows] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [month, setMonth] = usePersistentState(`clients.month.${y ?? "all"}`, new Date().getMonth() + 1);
  const [editing, setEditing] = useState<ClientRecord | "new" | null>(null);
  const [trash, setTrash] = useState(false);
  const [userId, setUserId] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  useEffect(() => { if (all) listUsers().then(setUsers).catch(() => undefined); }, [all]);

  const reload = useCallback(() => {
    setLoading(true);
    const req = all
      ? listAllClients({ user_id: userId || undefined, month: monthFilter || undefined, year: y, q, deleted: trash })
      : trash ? listTrash() : listClients({ year: y, q });
    return req
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(apiErrorMessage(e, "No se pudieron cargar los clientes.")))
      .finally(() => setLoading(false));
  }, [y, q, all, trash, userId, monthFilter]);

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

  const shown = y && !all && !trash ? rows.filter((r) => Number((r.fecha || "").slice(5, 7)) === month) : rows;
  const defaultDate = y ? `${y}-${String(month).padStart(2, "0")}-${String(Math.min(new Date().getDate(), 28)).padStart(2, "0")}` : new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{all ? "Clientes de todos" : trash ? "Papelera" : y ? `Clientes ${y}` : "Mis clientes"}</h2>
        {all && <p className="text-sm text-slate-500">Todos los clientes de todos los usuarios. Aquí puedes verlos, editarlos, asociarlos a varios usuarios (el punto se reparte) y descargarlos.</p>}
        {trash && <p className="text-sm text-slate-500">Lo que se borró queda aquí y se puede recuperar.</p>}
        {!all && !trash && <p className="text-sm text-slate-500">
          Cada cliente se guarda por <b>SOT</b>, nombre y fecha, y queda en el año y el mes de la <b>fecha de sus datos</b> (no la de creación).
          Lo que se agregue de esa SOT en cualquier ventana (IPs, CID, reportes generados…) se suma aquí solo.
        </p>}
      </div>

      <div className="card flex flex-wrap items-center gap-2">
        <input className="input min-w-[200px] flex-1" placeholder="Buscar por SOT, nombre, CID o proyecto..." value={q} onChange={(e) => setQ(e.target.value)} />
        {all && (
          <>
            <select className="input w-auto" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Usuario">
              <option value="">Todos los usuarios</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </select>
            <input type="month" className="input w-auto" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} aria-label="Mes" />
          </>
        )}
        {!trash && <button className="btn-primary text-sm" onClick={() => setEditing("new")}>Agregar cliente</button>}
        <button className={`${trash ? "btn-primary" : "btn-secondary"} text-sm`} onClick={() => setTrash(!trash)}>{trash ? "Salir de la papelera" : "Papelera"}</button>
        {can(me, "exportar") && !trash && (
          <ExportMenu label="Descargar lista" urlFor={(f) => exportClientsUrl({ format: f, scope: all ? "all" : "mine", user_id: userId, month: monthFilter || (y && !all ? `${y}-${String(month).padStart(2, "0")}` : ""), year: monthFilter ? undefined : y, q })} />
        )}
      </div>

      {y && !all && !trash && (
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
            <ClientCard key={c.id} c={c} onEdit={() => setEditing(c)} showMonth={!y} all={all} trash={trash} users={users} onChanged={() => void reload()} twins={all && !trash ? rows.filter((x) => x.sot === c.sot && x.id !== c.id) : []} />
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

function ClientCard({ c, onEdit, showMonth, all, trash, users, onChanged, twins = [] }: { c: ClientRecord; onEdit: () => void; showMonth: boolean; all: boolean; trash: boolean; users: AdminUser[]; onChanged: () => void; twins?: ClientRecord[] }) {
  const { me } = useAuth();
  const [assoc, setAssoc] = useState(false);
  const [open, setOpen] = useState(false);
  const m = Number(c.fecha.slice(5, 7));
  const datos = Object.entries(c.datos || {});
  const navigate = useNavigate();
  const [wins, setWins] = useState<WorkspaceInfo[]>([]);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    listWorkspaces(c.sot).then((w) => { if (!dead) setWins(w); }).catch(() => undefined);
    return () => { dead = true; };
  }, [open, c.sot]);
  const when = (iso: string) => (iso ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "");
  return (
    <div className="card space-y-2">
      <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen(!open)}>
        <span className="font-semibold text-slate-800">SOT {c.sot}</span>
        <span className="flex-1 min-w-[160px] text-slate-700">{c.nombre || <i className="text-slate-400">(sin nombre)</i>}</span>
        <span className="text-xs text-slate-500">{c.fecha}{showMonth && m ? ` · ${MESES[m - 1]}` : ""}</span>
        {(c.participants?.length ?? 0) > 0 && (all || c.shared) && (
          <span className="text-xs text-slate-500">{c.participants!.map((p) => p.name).join(" + ")}{c.shared ? ` · ${c.point} c/u` : ""}</span>
        )}
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
          <div>
            <p className="text-xs font-medium text-slate-500">Trabajo guardado (fotos, textos, opciones) — ábrelo para seguir editando</p>
            {wins.length === 0 ? (
              <p className="text-xs text-slate-400">Todavía no hay ventanas guardadas para esta SOT. Se guardan solas al escribir la SOT en el reporte fotográfico, el CheckList o Poder Judicial.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {wins.map((w) => (
                  <li key={w.key} className="flex flex-wrap items-center gap-2 text-xs">
                    <button className="btn-secondary px-2.5 py-1 text-xs" disabled={!w.route} onClick={() => { setActingClient(c.mine ? null : { id: c.id, sot: c.sot }); requestOpen(c.sot, w.key); navigate(w.route); }}>
                      Abrir · {w.label || w.key}
                    </button>
                    <span className="text-slate-400">{when(w.updated_at)}</span>
                    <button className="text-red-500 hover:underline" onClick={() => { if (confirm(`¿Borrar lo guardado de «${w.label || w.key}» para la SOT ${c.sot}?`)) void deleteWorkspace(c.sot, w.key).then(() => setWins((x) => x.filter((q) => q.key !== w.key))); }}>borrar</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          {c.shared && !all && <p className="text-xs text-emerald-600">Hecho junto con: {c.participants!.filter((p) => p.id !== me?.id).map((p) => p.name).join(", ")} (1 punto repartido: {c.point} cada uno)</p>}
          <div className="flex flex-wrap items-center gap-2">
            {trash ? (
              <>
                <button className="btn-primary text-xs" onClick={() => void (all ? adminRestore(c.id) : restoreClient(c.id)).then(onChanged).catch((e) => alert(apiErrorMessage(e, "No se pudo recuperar.")))}>Recuperar</button>
                {all && <button className="text-xs text-red-500 hover:underline" onClick={() => { if (confirm(`¿Eliminar DEFINITIVAMENTE la SOT ${c.sot} con todo su trabajo guardado?`)) void adminPurge(c.id).then(onChanged); }}>Eliminar definitivamente</button>}
              </>
            ) : (
              <>
                <button className="btn-secondary text-xs" onClick={onEdit}>Editar</button>
                {all && <button className="btn-secondary text-xs" onClick={() => setAssoc(true)}>Asociar usuarios</button>}
                {all && twins.length > 0 && (
                  <button className="btn-secondary text-xs" title="Hay otro registro con esta misma SOT: se junta todo en este y los participantes se suman"
                    onClick={() => { if (confirm(`La SOT ${c.sot} está repetida (${twins.length + 1} registros). ¿Unirlos en este? Se suman participantes, datos, reportes y ventanas guardadas.`)) void (async () => { try { for (const t of twins) await mergeClients(t.id, c.id); onChanged(); } catch (e) { alert(apiErrorMessage(e, "No se pudo unir.")); } })(); }}>
                    Unir repetidas ({twins.length + 1})
                  </button>
                )}
                {can(me, "exportar") && <ExportMenu label="Descargar" urlFor={(f) => exportClientUrl(c.id, f)} />}
              </>
            )}
          </div>
        </div>
      )}
      {assoc && <AssocEditor c={c} users={users} onClose={() => setAssoc(false)} onSaved={() => { setAssoc(false); onChanged(); }} />}
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
    if (!initial || !confirm(`¿Enviar el cliente SOT ${initial.sot} a la papelera? Podrás recuperarlo.`)) return;
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
    <div className="sheet-wrap fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8">
      <div className="card sheet w-full max-w-2xl space-y-3">
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

function ExportMenu({ label, urlFor }: { label: string; urlFor: (format: string) => string }) {
  return (
    <details className="relative">
      <summary className="btn-secondary cursor-pointer list-none text-xs">{label} ▾</summary>
      <div className="card absolute right-0 z-30 mt-1 flex min-w-[150px] flex-col gap-1 p-2">
        {FORMATS.map(([f, name]) => (
          <a key={f} className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" href={urlFor(f)} download>{name} (.{f})</a>
        ))}
      </div>
    </details>
  );
}

function AssocEditor({ c, users, onClose, onSaved }: { c: ClientRecord; users: AdminUser[]; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState<string[]>((c.participants ?? []).map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function save() {
    if (sel.length === 0) { setError("Elige al menos un usuario."); return; }
    setBusy(true);
    try { await setParticipants(c.id, sel); onSaved(); } catch (e) { setError(apiErrorMessage(e, "No se pudo guardar.")); setBusy(false); }
  }
  return (
    <div className="sheet-wrap fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8">
      <div className="card sheet w-full max-w-md space-y-3">
        <h3 className="text-lg font-semibold text-slate-800">Quién hizo la SOT {c.sot}</h3>
        <p className="text-xs text-slate-500">Cada cliente vale 1 punto. Con {sel.length || 1} participante(s) cada uno recibe {+(1 / Math.max(1, sel.length)).toFixed(3)}. Todos los elegidos verán y podrán editar este cliente.</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {users.filter((u) => u.active || sel.includes(u.id)).map((u) => (
            <li key={u.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggle(u.id)} /> {u.full_name || u.username} <span className="text-xs text-slate-400">@{u.username}</span></label></li>
          ))}
        </ul>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

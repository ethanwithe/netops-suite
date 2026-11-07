import { useMemo, useState } from "react";
import { apiErrorMessage } from "../api/client";
import { addAgenda, fmtWhen, fromLocalInput, patchAgenda, removeAgenda, toLocalInput, useAgenda } from "../store/agenda";
import type { AgendaItem, AgendaKind } from "../store/agenda";

const KIND: Record<AgendaKind, { label: string; icon: string }> = {
  recordatorio: { label: "Recordatorio", icon: "⏰" },
  tarea: { label: "Tarea", icon: "✓" },
  evento: { label: "Evento", icon: "📅" },
};

/** Agenda personal. Bit también la maneja por voz o chat: «recuérdame mañana a las 9 llamar al cliente». */
export default function AgendaPage() {
  const { items, loaded } = useAgenda();
  const [tab, setTab] = useState<"pend" | "hechos">("pend");
  const [kind, setKind] = useState<AgendaKind>("recordatorio");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const shown = useMemo(() => items.filter((i) => (tab === "hechos" ? i.done : !i.done)), [items, tab]);
  const late = (i: AgendaItem) => !i.done && !!i.due_at && new Date(i.due_at).getTime() < now;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (kind !== "tarea" && !when) { setError("Elige la fecha y hora."); return; }
    setError(null);
    try {
      await addAgenda({ kind, title: title.trim(), due_at: fromLocalInput(when) });
      setTitle(""); setWhen("");
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    } catch (err) { setError(apiErrorMessage(err, "No se pudo guardar.")); }
  }
  const act = (fn: () => Promise<unknown>) => void fn().catch((err) => setError(apiErrorMessage(err, "No se pudo completar la acción.")));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">Agenda</h2>
        <p className="text-sm text-slate-500">Recordatorios, tareas y eventos. Bit te avisa cuando llega la hora (con la página abierta) y también puedes pedírselos hablando o escribiendo.</p>
      </div>

      <form onSubmit={add} className="card flex flex-wrap items-end gap-3">
        <div className="seg">
          {(Object.keys(KIND) as AgendaKind[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{KIND[k].label}</button>
          ))}
        </div>
        <label className="min-w-[220px] flex-1 text-xs text-slate-500">¿Qué?
          <input className="input mt-0.5 block w-full" value={title} maxLength={200} placeholder="Llamar al cliente de Maxi Mobility" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">{kind === "tarea" ? "Fecha límite (opcional)" : "Cuándo"}
          <input className="input mt-0.5 block" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <button className="btn-primary text-sm" disabled={!title.trim()}>Agregar</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="seg">
        <button type="button" className={tab === "pend" ? "on" : ""} onClick={() => setTab("pend")}>Pendientes</button>
        <button type="button" className={tab === "hechos" ? "on" : ""} onClick={() => setTab("hechos")}>Hechos</button>
      </div>

      {!loaded ? null : shown.length === 0 ? (
        <div className="card text-sm text-slate-500">{tab === "pend" ? "No tienes pendientes. Dile a Bit «recuérdame…» o agrega uno arriba." : "Aún no has completado nada."}</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={i.id} className="card flex items-center gap-3 !py-3">
              <button type="button" aria-label={i.done ? "Marcar pendiente" : "Marcar hecho"} onClick={() => act(() => patchAgenda(i.id, { done: !i.done }))}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${i.done ? "border-green-500 bg-green-500 text-white" : "border-slate-300 text-transparent hover:border-brand-500"}`}>✓</button>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${i.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{KIND[i.kind].icon} {i.title}</p>
                <p className={`text-xs ${late(i) ? "font-semibold text-red-600" : "text-slate-500"}`}>{KIND[i.kind].label} · {fmtWhen(i.due_at)}{late(i) ? " · vencido" : ""}</p>
              </div>
              {i.due_at && !i.done && (
                <input className="input w-44 text-xs max-sm:hidden" type="datetime-local" value={toLocalInput(i.due_at)} aria-label="Cambiar fecha y hora"
                  onChange={(e) => e.target.value && act(() => patchAgenda(i.id, { due_at: fromLocalInput(e.target.value) as string }))} />
              )}
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => act(() => removeAgenda(i.id))}>Borrar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

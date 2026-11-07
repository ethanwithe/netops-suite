import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface Item { id: string; kind: string; label: string; text: string; weight: number }
const KINDS: [string, string][] = [["proyecto", "Proyecto / cliente"], ["comando", "Comando"], ["config", "Configuración"], ["preferencia", "Preferencia"], ["rutina", "Rutina"]];

/** Lo que Bit aprendió de tu trabajo (proyectos, comandos, configuraciones, preferencias) y las rutinas que detectó. Se puede revisar y borrar. */
export default function BitMemories() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [routines, setRoutines] = useState<string[]>([]);
  const [kind, setKind] = useState("comando");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api.get<{ items: Item[]; routines: string[] }>("/mascot/memories").then((r) => { setItems(r.data.items); setRoutines(r.data.routines); }).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = (items ?? []).reduce<Record<string, Item[]>>((a, i) => { (a[i.label] ??= []).push(i); return a; }, {});

  async function add() {
    if (text.trim().length < 3) return;
    setErr("");
    try { await api.post("/mascot/memories", { kind, text: text.trim() }); setText(""); load(); }
    catch (e) { setErr((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || "No se pudo guardar."); }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="mb-1 flex items-center justify-between">
        <b className="text-slate-700">Mi memoria de trabajo</b>
        {!!items?.length && <button type="button" className="text-red-600 hover:underline" onClick={async () => { if (confirm("¿Borrar toda la memoria de trabajo de Bit?")) { await api.delete("/mascot/memories"); load(); } }}>Olvidar</button>}
      </div>
      <p className="mb-1 text-[10.5px] leading-snug text-slate-500">Bit aprende solo de lo que haces y le cuentas: proyectos, comandos, configuraciones y preferencias. No guarda contraseñas ni claves.</p>
      {routines.length > 0 && (
        <div className="mb-1.5 rounded bg-sky-50 p-1.5 text-[11px] text-sky-800">
          <b>Rutinas que detecté:</b>
          <ul className="list-disc pl-4">{routines.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {items === null ? <p className="text-slate-400">Cargando…</p> : !items.length ? <p className="text-slate-500">Aún no aprendí nada de tu trabajo. Úsame, o enséñame abajo.</p> : (
        <div className="max-h-48 space-y-1.5 overflow-auto">
          {Object.entries(groups).map(([label, list]) => (
            <div key={label}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
              <ul className="space-y-0.5">
                {list.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-2">
                    <span className={i.kind === "comando" ? "font-mono text-[10.5px]" : ""}>{i.text}{i.weight > 1 && <em className="ml-1 text-slate-400">×{i.weight}</em>}</span>
                    <button type="button" className="shrink-0 text-slate-400 hover:text-red-600" onClick={async () => { await api.delete(`/mascot/memories/${i.id}`); load(); }}>Quitar</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 space-y-1">
        <select className="input w-full py-1 text-[11px]" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="flex gap-1">
          <input className="input min-w-0 flex-1 py-1 text-[11px]" placeholder="Enséñale algo…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-[11px]" onClick={() => void add()} disabled={text.trim().length < 3}>Guardar</button>
        </div>
      </div>
      {err && <p className="mt-1 text-[10.5px] text-red-600">{err}</p>}
    </div>
  );
}

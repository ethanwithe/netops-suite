import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistentState } from "../store/persistentState";
import Spinner from "./Spinner";

interface Port { id: string; nombre: string; mac: string; motor: string }
interface Item {
  id: number; nombre: string; activo: boolean; src_mac: string; dst_mac: string; src_ip: string; dst_ip: string;
  size: number; mbps: number; mbps_rev?: number | null; ttl: number;
}
interface Flow {
  id: number; nombre: string; objetivo_mbps: number; tx: number; rx: number; tx_mbps: number; rx_mbps: number;
  pico_tx: number; pico_rx: number; perdida: number; lat_ms: number | null; lat_max: number | null; jitter_ms: number | null;
}
interface Status { corriendo: boolean; segundos: number; duracion: number; error: string; flujos: Flow[]; total_tx_mbps?: number; total_rx_mbps?: number }

const newItem = (id: number, port?: Port): Item => ({
  id, nombre: `ICMP ${id}`, activo: true, src_mac: port?.mac || "", dst_mac: "ff:ff:ff:ff:ff:ff",
  src_ip: "10.0.0.1", dst_ip: "10.0.0.2", size: 1024, mbps: 100, mbps_rev: null, ttl: 64,
});

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/trafficgen" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d?.detail === "string" ? d.detail : `Error ${r.status}`);
  return d as T;
}

const MAC_RE = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;
const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const okIp = (s: string) => IP_RE.test(s.trim()) && s.trim().split(".").every((n) => +n <= 255);

function itemError(it: Item): string | null {
  if (!MAC_RE.test(it.src_mac.trim())) return "MAC de origen inválida";
  if (!MAC_RE.test(it.dst_mac.trim())) return "MAC de destino inválida";
  if (!okIp(it.src_ip)) return "IP de origen inválida";
  if (!okIp(it.dst_ip)) return "IP de destino inválida";
  if (!(it.mbps > 0)) return "Ancho de banda inválido";
  return null;
}

/** Generador de tráfico por puerto (estilo Ostinato): elige el puerto, «Configurar puerto» (bidireccional) y «Crear ítem». */
export default function TrafficGenPanel({ onRunning }: { onRunning?: (r: boolean) => void }) {
  const [ports, setPorts] = useState<Port[]>([]);
  const [motivo, setMotivo] = useState("");
  const [port, setPort] = usePersistentState("tg.puerto", "");
  const [bidir, setBidir] = usePersistentState("tg.bidir", true);
  const [configured, setConfigured] = usePersistentState("tg.configurado", false);
  const [items, setItems] = usePersistentState<Item[]>("tg.items", []);
  const [dur, setDur] = usePersistentState("tg.dur", "60");
  const [edit, setEdit] = useState<Item | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const loadPorts = useCallback(async () => {
    try {
      const d = await api<{ ports: Port[]; motivo: string }>("/puertos");
      setPorts(d.ports); setMotivo(d.motivo);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void loadPorts(); }, [loadPorts]);

  const running = !!st?.corriendo;
  useEffect(() => { onRunning?.(running); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const poll = async () => { try { setSt(await api<Status>("/estado")); } catch { /* reintenta */ } };
    void poll();
    timer.current = window.setInterval(() => void poll(), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  const cur = ports.find((p) => p.id === port);
  const start = async () => {
    setErr(""); setBusy(true);
    try {
      const act = items.filter((i) => i.activo);
      for (const i of act) { const m = itemError(i); if (m) throw new Error(`${i.nombre}: ${m}`); }
      setSt(await api<Status>("/iniciar", {
        puerto: port, bidireccional: bidir, duracion: Math.max(0, parseInt(dur) || 0),
        items: act.map((i) => ({ ...i, mbps_rev: i.mbps_rev || null })),
      }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const stop = async () => { setBusy(true); try { setSt(await api<Status>("/detener", {})); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const saveItem = () => {
    if (!edit) return;
    const m = itemError(edit);
    if (m) { setErr(m); return; }
    setErr("");
    setItems((p) => p.some((x) => x.id === edit.id) ? p.map((x) => x.id === edit.id ? edit : x) : [...p, edit]);
    setEdit(null);
  };
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setEdit((e) => e ? { ...e, [k]: v } : e);
  const nextId = () => Math.max(0, ...items.map((i) => i.id)) + 1;
  const total = (items.filter((i) => i.activo).reduce((a, i) => a + i.mbps + (bidir ? (i.mbps_rev || i.mbps) : 0), 0));

  return (
    <div className="space-y-3 text-sm">
      <div className="card space-y-2">
        <div className="font-semibold">1. Puerto</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-md" value={port} disabled={running} onChange={(e) => { setPort(e.target.value); setConfigured(false); }}>
            <option value="">— elige el puerto —</option>
            {ports.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.mac ? ` (${p.mac})` : ""}</option>)}
          </select>
          <button className="btn-secondary text-xs" onClick={() => void loadPorts()} disabled={running}>Actualizar</button>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={bidir} disabled={running} onChange={(e) => setBidir(e.target.checked)} />
            Bidireccional (A→B y B→A a la vez)
          </label>
          <button className="btn-primary text-xs" disabled={!port || running} onClick={() => { setConfigured(true); setErr(""); }}>Configurar puerto</button>
        </div>
        {configured && cur && <p className="text-xs text-emerald-600">Puerto configurado: {cur.nombre} · {bidir ? "bidireccional" : "un solo sentido"}</p>}
        {motivo && <p className="text-xs text-amber-600">{motivo}</p>}
        {!ports.length && !motivo && <p className="text-xs text-slate-500">No hay puertos disponibles.</p>}
      </div>

      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold">2. Ítems de tráfico</div>
          <button className="btn-secondary text-xs" disabled={!configured || running} onClick={() => setEdit(newItem(nextId(), cur))}>Crear ítem</button>
        </div>
        {!items.length && <p className="text-xs text-slate-500">Configura el puerto y crea un ítem: Ethernet + IPv4 + ICMP con MAC/IP de origen y destino y el ancho de banda a saturar.</p>}
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-1.5 dark:border-slate-700">
            <input type="checkbox" checked={i.activo} disabled={running} onChange={(e) => setItems((p) => p.map((x) => x.id === i.id ? { ...x, activo: e.target.checked } : x))} />
            <span className="font-medium">{i.nombre}</span>
            <span className="text-xs text-slate-500">{i.src_ip} ({i.src_mac}) → {i.dst_ip} ({i.dst_mac}) · {i.size} B · {i.mbps} Mbps{bidir ? ` ↔ ${i.mbps_rev || i.mbps} Mbps` : ""}</span>
            <span className="ml-auto flex gap-2 text-xs">
              <button className="text-brand-600 hover:underline" disabled={running} onClick={() => setEdit({ ...i })}>Editar</button>
              <button className="text-brand-600 hover:underline" disabled={running} onClick={() => setItems((p) => [...p, { ...i, id: nextId(), nombre: i.nombre + " copia" }])}>Duplicar</button>
              <button className="text-red-500 hover:underline" disabled={running} onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))}>Borrar</button>
            </span>
          </div>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">Duración (s, 0 = hasta detener)
          <input className="input w-20" value={dur} disabled={running} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} />
        </label>
        <span className="text-xs text-slate-500">Total a generar: {total.toLocaleString()} Mbps</span>
        {!running
          ? <button className="btn-primary" disabled={busy || !configured || !items.some((i) => i.activo)} onClick={() => void start()}>
              {busy ? <span className="inline-flex items-center gap-2"><Spinner />Iniciando…</span> : "Iniciar saturación"}
            </button>
          : <button className="btn-secondary" disabled={busy} onClick={() => void stop()}>Detener</button>}
        {running && <span className="text-xs text-slate-500">{st?.segundos}s{st?.duracion ? ` / ${st.duracion}s` : ""}</span>}
        {err && <span className="text-red-600">{err}</span>}
        {st?.error && <span className="text-red-600">{st.error}</span>}
      </div>

      {st && st.flujos.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500">
              <th>Flujo</th><th>Objetivo</th><th>Envía</th><th>Recibe</th><th>Pico env/rec</th><th>Pérdida</th><th>Latencia (máx)</th><th>Jitter</th>
            </tr></thead>
            <tbody>
              {st.flujos.map((f) => (
                <tr key={f.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="font-medium">{f.nombre}</td>
                  <td>{f.objetivo_mbps} Mbps</td>
                  <td>{f.tx_mbps} Mbps</td>
                  <td>{f.rx_mbps} Mbps</td>
                  <td>{f.pico_tx} / {f.pico_rx}</td>
                  <td className={f.perdida > 1 ? "text-red-600" : ""}>{f.perdida}%</td>
                  <td>{f.lat_ms ?? "—"}{f.lat_max != null ? ` (${f.lat_max})` : ""} ms</td>
                  <td>{f.jitter_ms ?? "—"} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-400">Cada sentido tiene su propio hilo y su propio ritmo, y se mide por separado. «Recibe» cuenta las respuestas ICMP (o el retorno por el lazo del extremo remoto); sin respuesta la pérdida será alta aunque se esté enviando.</p>
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className="card w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold">Ítem de tráfico</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2">Nombre<input className="input" value={edit.nombre} onChange={(e) => set("nombre", e.target.value)} /></label>
              <div className="col-span-2 rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">Capa 2: Ethernet II · Capa 3: IPv4 · Protocolo: ICMP (echo)</div>
              <label>MAC origen<input className="input" value={edit.src_mac} onChange={(e) => set("src_mac", e.target.value)} placeholder="00:11:22:33:44:55" /></label>
              <label>MAC destino<input className="input" value={edit.dst_mac} onChange={(e) => set("dst_mac", e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" /></label>
              <label>IP origen<input className="input" value={edit.src_ip} onChange={(e) => set("src_ip", e.target.value)} /></label>
              <label>IP destino<input className="input" value={edit.dst_ip} onChange={(e) => set("dst_ip", e.target.value)} /></label>
              <label>Ancho de banda A→B (Mbps)<input className="input" type="number" min={0.1} value={edit.mbps} onChange={(e) => set("mbps", +e.target.value)} /></label>
              <label>Ancho de banda B→A (Mbps)<input className="input" type="number" min={0.1} placeholder="igual" value={edit.mbps_rev ?? ""} disabled={!bidir} onChange={(e) => set("mbps_rev", e.target.value ? +e.target.value : null)} /></label>
              <label>Tamaño de trama (bytes)<input className="input" type="number" min={60} max={9000} value={edit.size} onChange={(e) => set("size", +e.target.value)} /></label>
              <label>TTL<input className="input" type="number" min={1} max={255} value={edit.ttl} onChange={(e) => set("ttl", +e.target.value)} /></label>
            </div>
            {err && <p className="text-red-600">{err}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setEdit(null); setErr(""); }}>Cancelar</button>
              <button className="btn-primary" onClick={saveItem}>Guardar ítem</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

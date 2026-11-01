import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistentState } from "../store/persistentState";
import { agentStart, agentStatus, agentStop } from "../utils/saturadorAgent";
import type { AgentResult, AgentStatus } from "../utils/saturadorAgent";

/**
 * Controla el saturador de tu laptop (saturador.py --agente) desde la página:
 * iniciar/detener y ver en vivo cuántos Mbps salen y regresan.
 */
export default function SaturadorPanel({
  defaultMbps, onRunning,
}: {
  defaultMbps?: string;
  /** Avisa si la saturación está en marcha (para permitir las capturas de saturación). */
  onRunning?: (running: boolean) => void;
}) {
  const [modo, setModo] = usePersistentState<"internet" | "rpv">("saturador.modo", "internet");
  const [destInternet, setDestInternet] = usePersistentState("saturador.destino", "8.8.8.8");
  const [destRpv, setDestRpv] = usePersistentState("saturador.destinoRpv", "");
  const [mbps, setMbps] = usePersistentState("saturador.mbps", defaultMbps || "100");
  const [seg, setSeg] = usePersistentState("saturador.seg", "600");
  const [code, setCode] = usePersistentState("saturador.codigo", "");
  const [res, setRes] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const dest = modo === "internet" ? destInternet : destRpv;
  const st: AgentStatus | null = res?.kind === "ok" ? res.status : null;
  const running = !!st?.corriendo;

  const poll = useCallback(async () => {
    try { setRes(await agentStatus(code.trim())); } catch { /* se reintenta */ }
  }, [code]);

  useEffect(() => {
    void poll();
    timer.current = window.setInterval(() => void poll(), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [poll]);

  useEffect(() => { onRunning?.(running); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError(null);
    try {
      const r = await agentStart(code.trim(), dest.trim(), Number(mbps), Number(seg) || 0);
      setRes(r);
    } catch (e) { setError((e as Error).message); }
  }
  async function stop() {
    setError(null);
    try { setRes(await agentStop(code.trim())); } catch (e) { setError((e as Error).message); }
  }

  const target = st?.mbps || Number(mbps) || 0;
  const pct = (v: number) => (target > 0 ? Math.min(100, Math.round((v / target) * 100)) : 0);
  const bar = (label: string, v: number, color: string) => (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs"><span>{label}</span><span className="font-mono">{v.toFixed(1)} Mbps · {pct(v)}%</span></div>
      <div className="h-2.5 overflow-hidden rounded bg-slate-200"><div className={`h-full ${color}`} style={{ width: `${pct(v)}%` }} /></div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {res?.kind === "ok" && st?.icmp && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Agente conectado</span>}
        {res?.kind === "ok" && !st?.icmp && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Agente sin permisos ICMP (ábrelo con sudo)</span>}
        {res?.kind === "codigo" && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Agente encontrado: falta el código</span>}
        {(!res || res.kind === "ausente") && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-600">Agente no detectado</span>}
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          Código del agente
          <input className="input w-24 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="A1B2C3" />
        </label>
      </div>
      {(!res || res.kind === "ausente") && (
        <p className="text-xs text-slate-500">
          En tu laptop abre una terminal en la carpeta de <b>saturador.py</b> y ejecuta <code className="rounded bg-slate-100 px-1">python saturador.py --agente</code>{" "}
          (en Linux/Mac con <code className="rounded bg-slate-100 px-1">sudo</code>). Te mostrará un código: pégalo aquí. Si el navegador pregunta por acceso a
          dispositivos de la red local, acepta.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button className={modo === "internet" ? "btn-primary text-xs" : "btn-secondary text-xs"} onClick={() => setModo("internet")}>Internet</button>
        <button className={modo === "rpv" ? "btn-primary text-xs" : "btn-secondary text-xs"} onClick={() => setModo("rpv")}>RPV</button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-3">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            {modo === "internet" ? "IP de destino (Internet)" : "IP de destino en la RPV: gateway, siguiente salto o IP de cabecera del cliente"}
          </span>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-[160px] flex-1" value={dest} onChange={(e) => (modo === "internet" ? setDestInternet : setDestRpv)(e.target.value)} placeholder={modo === "rpv" ? "ej. 10.31.242.25" : ""} />
            {modo === "internet" && ["8.8.8.8", "1.1.1.1"].map((ip) => <button key={ip} type="button" className="btn-secondary text-xs" onClick={() => setDestInternet(ip)}>{ip}</button>)}
          </div>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Mbps por cada sentido</span>
          <input className="input w-full" inputMode="decimal" value={mbps} onChange={(e) => setMbps(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Duración (seg, 0 = hasta detener)</span>
          <input className="input w-full" inputMode="numeric" value={seg} onChange={(e) => setSeg(e.target.value)} />
        </label>
        <div className="flex items-end gap-2">
          {!running ? (
            <button className="btn-primary w-full text-sm" onClick={start} disabled={res?.kind !== "ok" || !st?.icmp || !dest.trim() || !(Number(mbps) > 0)}>Iniciar saturación</button>
          ) : (
            <button className="btn-secondary w-full text-sm" onClick={stop}>Detener</button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {st && (running || st.pico_tx > 0) && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="text-xs text-slate-500">
            {running ? `Saturando ${st.destino} · ${st.segundos}s${st.duracion ? ` de ${st.duracion}s` : ""}` : `Última saturación a ${st.destino} (detenida)`}
          </p>
          {bar("Subida", st.tx_mbps, "bg-blue-500")}
          {bar("Bajada", st.rx_mbps, "bg-emerald-500")}
          <p className="text-xs text-slate-500">
            Pérdida {st.perdida}% · picos: subida {st.pico_tx} / bajada {st.pico_rx} Mbps
            {running && st.rx_mbps < target * 0.7 && " · Atención: la bajada está por debajo del objetivo (el destino puede estar limitando el ping)"}
          </p>
        </div>
      )}
    </div>
  );
}

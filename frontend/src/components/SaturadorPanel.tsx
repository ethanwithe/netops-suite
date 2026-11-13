import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistentState } from "../store/persistentState";
import { agentStart, agentStatus, agentStop } from "../utils/saturadorAgent";
import type { AgentResult, AgentStatus } from "../utils/saturadorAgent";
import { startBrowserSat } from "../utils/browserSaturate";
import type { BrowserSat, SatTick } from "../utils/browserSaturate";

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
  const [via, setVia] = usePersistentState<"agente" | "navegador">("saturador.via", "agente");
  const [bt, setBt] = useState<SatTick | null>(null);
  const [navDest, setNavDest] = usePersistentState("saturador.navDest", "");
  const [btRun, setBtRun] = useState(false);
  const btRef = useRef<BrowserSat | null>(null);
  const [res, setRes] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const dest = modo === "internet" ? destInternet : destRpv;
  const st: AgentStatus | null = res?.kind === "ok" ? res.status : null;
  const running = !!st?.corriendo;

  const poll = useCallback(async () => {
    if (via !== "agente") return;
    try { setRes(await agentStatus(code.trim())); } catch { /* se reintenta */ }
  }, [code, via]);

  useEffect(() => {
    void poll();
    timer.current = window.setInterval(() => void poll(), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [poll]);

  useEffect(() => { onRunning?.(via === "navegador" ? btRun : running); }, [running, btRun, via]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => btRef.current?.stop(), []);

  // Registro tipo iperf: una línea por segundo y el resumen al final
  const [btLog, setBtLog] = useState<string[]>([]);
  const lastTick = useRef<SatTick | null>(null);
  const logBox = useRef<HTMLPreElement>(null);
  useEffect(() => { const el = logBox.current; if (el) el.scrollTop = el.scrollHeight; }, [btLog]);
  const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GBytes` : `${(b / 1e6).toFixed(2)} MBytes`);
  const iv = (a: number, b: number) => `${a.toFixed(2).padStart(6)}-${b.toFixed(2).padEnd(6)}`;
  const row = (id: string, a: number, b: number, dB: number, uB: number, dM: number, uM: number, retr: string, measured: boolean) =>
    `[${id.padStart(4)}] ${iv(a, b)} sec  ↓ ${(measured ? mb(dB) : "  n/d").padStart(12)} ${(measured ? dM.toFixed(1) : "n/d").padStart(8)} Mbits/sec  ↑ ${mb(uB).padStart(12)} ${uM.toFixed(1).padStart(8)} Mbits/sec  ${retr}`;
  const HEAD = "[ ID] Intervalo        ↓ Bajada: transferencia / velocidad      ↑ Subida: transferencia / velocidad      Retr";
  const pushLog = (...l: string[]) => setBtLog((o) => [...o, ...l].slice(-4000));
  const stamp = () => new Date().toLocaleTimeString("es-PE");

  function startBr() {
    setError(null); setBt(null); setBtRun(true); lastTick.current = null;
    const dest = navDest.trim() || "speed.cloudflare.com (servidor de pruebas)";
    const t0 = Number(seg) || 0;
    setBtLog([`${stamp()}  Conectando a ${dest} · 6 flujos de bajada y 3 de subida en paralelo · ${t0 ? `${t0} s` : "hasta detener"}`, HEAD]);
    btRef.current = startBrowserSat({
      seconds: t0,
      target: navDest,
      onTick: (t) => {
        setBt(t); lastTick.current = t;
        pushLog(row("SUM", t.sec - 1, t.sec, t.dBytes, t.uBytes, t.down, t.up, String(t.errors), t.downMeasured));
        if (t.sec % 10 === 0) pushLog(HEAD);
      },
      onEnd: (err) => {
        setBtRun(false);
        const t = lastTick.current;
        const lines = ["- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", HEAD];
        if (t) {
          lines.push(row("SUM", 0, t.sec, t.downBytes, t.upBytes, (t.downBytes * 8) / 1e6 / Math.max(1, t.sec), (t.upBytes * 8) / 1e6 / Math.max(1, t.sec), `${t.errors}  promedio`, t.downMeasured));
          lines.push(`Picos: bajada ${t.peakDown.toFixed(1)} · subida ${t.peakUp.toFixed(1)} Mbits/sec`);
        }
        lines.push(err ? `${stamp()}  Error: ${err}` : `${stamp()}  Terminado.`);
        pushLog(...lines);
        if (err) setError(err);
      },
    });
  }
  const copyLog = () => { void navigator.clipboard?.writeText(btLog.join("\n")).catch(() => undefined); };
  const saveLog = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([btLog.join("\n") + "\n"], { type: "text/plain" }));
    a.download = `saturacion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  function stopBr() { btRef.current?.stop(); }

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

  const modeSwitch = (
    <div className="flex flex-wrap gap-2">
      <button className={via === "agente" ? "btn-primary text-xs" : "btn-secondary text-xs"} onClick={() => setVia("agente")}>Con agente (ICMP, Internet o RPV)</button>
      <button className={via === "navegador" ? "btn-primary text-xs" : "btn-secondary text-xs"} onClick={() => setVia("navegador")}>Desde el navegador (sin agente)</button>
    </div>
  );

  if (via === "navegador") {
    const tgt = Number(mbps) || 0;
    return (
      <div className="space-y-3">
        {modeSwitch}
        <p className="text-xs text-slate-500">
          Satura el enlace de Internet de esta PC descargando y subiendo datos en paralelo desde el navegador: no necesita instalar nada ni código.
          Para saturar una RPV o por ICMP usa el agente.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Destino (vacío = servidor de pruebas de Cloudflare)</span>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-[200px] flex-1" value={navDest} onChange={(e) => setNavDest(e.target.value)} placeholder="IP, dominio o URL (ej. 10.31.242.25 o https://host/archivo)" disabled={btRun} />
            {navDest && <button type="button" className="btn-secondary text-xs" onClick={() => setNavDest("")} disabled={btRun}>Usar Cloudflare</button>}
          </div>
          {navDest.trim() && (
            <span className="mt-1 block text-[11px] text-amber-700">
              Un navegador solo manda HTTP(S) (no ping ni paquetes crudos) y desde esta página (https) no puede llamar a destinos http://. El destino debe responder
              por https (se prueba https://{navDest.trim().replace(/^https?:\/\//i, "")}). Si no permite CORS, se genera el tráfico pero la bajada no se puede medir. Para ICMP o una IP de RPV usa el agente.
            </span>
          )}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Objetivo de referencia (Mbps)</span>
            <input className="input w-full" inputMode="decimal" value={mbps} onChange={(e) => setMbps(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Duración (seg, 0 = hasta detener)</span>
            <input className="input w-full" inputMode="numeric" value={seg} onChange={(e) => setSeg(e.target.value)} />
          </label>
          <div className="flex items-end">
            {!btRun ? <button className="btn-primary w-full text-sm" onClick={startBr}>Iniciar saturación</button>
              : <button className="btn-secondary w-full text-sm" onClick={stopBr}>Detener</button>}
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {bt && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">{btRun ? `Saturando${navDest.trim() ? ` ${navDest.trim()}` : ""} · ${bt.sec}s${Number(seg) ? ` de ${Number(seg)}s` : ""}` : "Última saturación (detenida)"}{bt.errors > 0 ? ` · ${bt.errors} reintento(s)` : ""}</p>
            {[["Subida", bt.up, "bg-blue-500"], ["Bajada", bt.down, "bg-emerald-500"]].map(([l, v, c]) => {
              const val = v as number, pc = tgt > 0 ? Math.min(100, Math.round((val / tgt) * 100)) : 0;
              return (
                <div key={l as string} className="space-y-0.5">
                  <div className="flex justify-between text-xs"><span>{l}</span><span className="font-mono">{val.toFixed(1)} Mbps{tgt > 0 ? ` · ${pc}%` : ""}</span></div>
                  <div className="h-2.5 overflow-hidden rounded bg-slate-200"><div className={`h-full ${c}`} style={{ width: `${pc}%` }} /></div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">Picos: subida {bt.peakUp.toFixed(1)} / bajada {bt.peakDown.toFixed(1)} Mbps{!bt.downMeasured ? " · la bajada no se puede medir en este destino (sin CORS), pero sí se está generando" : ""}</p>
          </div>
        )}
        {btLog.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Registro de la saturación</span>
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn-secondary text-xs" onClick={copyLog}>Copiar</button>
                <button type="button" className="btn-secondary text-xs" onClick={saveLog}>Descargar .txt</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setBtLog([])} disabled={btRun}>Limpiar</button>
              </span>
            </div>
            <pre ref={logBox} className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-snug text-emerald-300" aria-live="off">{btLog.join("\n")}</pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {modeSwitch}
      <div className="flex flex-wrap items-center gap-2">
        {res?.kind === "ok" && st?.icmp && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Agente conectado</span>}
        {res?.kind === "ok" && !st?.icmp && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Agente sin permisos ICMP (ábrelo con sudo)</span>}
        {res?.kind === "codigo" && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Agente encontrado: falta el código</span>}
        {(!res || res.kind === "ausente") && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-600">Agente no detectado</span>}
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          Código del agente
          <input className="input w-24 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.trim().toUpperCase())} placeholder="A1B2C3" />
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

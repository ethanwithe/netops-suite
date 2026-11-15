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
  defaultMbps, onRunning, big, manual, onManual,
}: {
  defaultMbps?: string;
  /** En la ventana flotante: barra compacta arriba y el registro ocupa el espacio libre (como una consola). */
  big?: boolean;
  /** Casilla «saturo con otra herramienta» (solo en la ventana flotante). */
  manual?: boolean;
  onManual?: (v: boolean) => void;
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
    `[${id.padStart(4)}] ${iv(a, b)} sec  Baj ${(measured ? mb(dB) : "n/d").padStart(12)} ${(measured ? dM.toFixed(1) : "n/d").padStart(8)} Mbits/sec  Sub ${mb(uB).padStart(12)} ${uM.toFixed(1).padStart(8)} Mbits/sec  ${retr}`;
  const HEAD = "[ ID] Intervalo         Bajada (transferencia / velocidad)        Subida (transferencia / velocidad)        Retr";
  const pushLog = (...l: string[]) => setBtLog((o) => [...o, ...l].slice(-4000));
  const stamp = () => new Date().toLocaleTimeString("es-PE");

  // Con el agente también se ve cómo va saturando, como iperf: una línea por segundo y el resumen al terminar
  const agentSeen = useRef<{ run: boolean; sec: number }>({ run: false, sec: -1 });
  useEffect(() => {
    if (via !== "agente" || !st) return;
    const seen = agentSeen.current;
    const AH = "[ ID] Intervalo         Subida (Mbits/sec)    Bajada (Mbits/sec)    Perdida";
    if (st.corriendo) {
      if (!seen.run) {
        seen.run = true; seen.sec = -1;
        setBtLog((o) => [...o, `${stamp()}  Saturando ${st.destino} · objetivo ${st.mbps} Mbps por sentido · ${st.duracion ? `${st.duracion} s` : "hasta detener"}`, AH].slice(-4000));
      }
      if (st.segundos !== seen.sec && st.segundos > 0) {
        seen.sec = st.segundos;
        const ln = `[ SUM] ${(st.segundos - 1).toFixed(2).padStart(6)}-${st.segundos.toFixed(2).padEnd(6)} sec  Sub ${st.tx_mbps.toFixed(1).padStart(8)} Mbits/sec  Baj ${st.rx_mbps.toFixed(1).padStart(8)} Mbits/sec  ${String(st.perdida).padStart(5)}%`;
        setBtLog((o) => [...o, ln, ...(st.segundos % 10 === 0 ? [AH] : [])].slice(-4000));
      }
    } else if (seen.run) {
      seen.run = false;
      setBtLog((o) => [...o, "- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", `Picos: subida ${st.pico_tx} · bajada ${st.pico_rx} Mbits/sec · pérdida ${st.perdida}%`, `${stamp()}  Terminado.`].slice(-4000));
    }
  }, [st?.corriendo, st?.segundos, via]); // eslint-disable-line react-hooks/exhaustive-deps

  function startBr() {
    setError(null); setBt(null); setBtRun(true); lastTick.current = null;
    const dest = navDest.trim() || "speed.cloudflare.com (servidor de pruebas)";
    const t0 = Number(seg) || 0;
    setBtLog([`${stamp()}  Conectando a ${dest} · bajada y subida en paralelo (los flujos aumentan solos hasta el objetivo) · ${t0 ? `${t0} s` : "hasta detener"}`, HEAD]);
    btRef.current = startBrowserSat({
      seconds: t0,
      mbps: Number(mbps) || 0,
      target: navDest,
      onTick: (t) => {
        setBt(t); lastTick.current = t;
        pushLog(row("SUM", t.sec - 1, t.sec, t.dBytes, t.uBytes, t.down, t.up, `${t.errors}  flujos ${t.streamsDown}/${t.streamsUp}`, t.downMeasured));
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

  const logPane = btLog.length > 0 ? (
    <div className={`space-y-1 ${big ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Registro de la saturación (en vivo)</span>
        <span className="ml-auto flex gap-1">
          <button type="button" className="btn-secondary text-xs" onClick={copyLog}>Copiar</button>
          <button type="button" className="btn-secondary text-xs" onClick={saveLog}>Descargar .txt</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setBtLog([])} disabled={btRun || running}>Limpiar</button>
        </span>
      </div>
      <pre ref={logBox} className={`overflow-auto rounded-lg bg-black p-3 font-mono text-[11px] leading-snug text-emerald-300 ${big ? "min-h-[8rem] flex-1" : "max-h-72"}`} style={{ lineHeight: 1.45, fontVariantLigatures: "none" }} aria-live="off">{btLog.length ? btLog.join("\n") : "(esperando… inicia la saturación y aquí verás cómo va, como iperf)"}</pre>
    </div>
  ) : null;

  if (big) {
    const on = via === "navegador" ? btRun : running;
    const tgtB = Number(mbps) || 0;
    const sub = via === "navegador" ? bt?.up ?? 0 : st?.tx_mbps ?? 0;
    const baj = via === "navegador" ? bt?.down ?? 0 : st?.rx_mbps ?? 0;
    const pc = (v: number) => (tgtB > 0 ? Math.min(100, Math.round((v / tgtB) * 100)) : 0);
    const b = "rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-sky-50 disabled:opacity-40";
    const inp = "rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs";
    const canStart = via === "navegador" || (res?.kind === "ok" && !!st?.icmp && !!dest.trim() && tgtB > 0);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${on ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{on ? "● Saturando" : "Detenida"}</span>
          {!on ? <button className="rounded bg-brand-600 px-3 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40" disabled={!canStart} onClick={via === "navegador" ? startBr : start}>Iniciar</button>
            : <button className="rounded bg-red-600 px-3 py-0.5 text-[11px] font-semibold text-white" onClick={via === "navegador" ? stopBr : stop}>Detener</button>}
          <select className={inp} value={via} onChange={(e) => setVia(e.target.value as "agente" | "navegador")} disabled={on} aria-label="Modo">
            <option value="agente">Agente</option><option value="navegador">Navegador</option>
          </select>
          {via === "agente" ? (
            <>
              <select className={inp} value={modo} onChange={(e) => setModo(e.target.value as "internet" | "rpv")} disabled={on} aria-label="Tipo"><option value="internet">Internet</option><option value="rpv">RPV</option></select>
              <input className={`${inp} w-32`} value={dest} disabled={on} placeholder="IP destino" onChange={(e) => (modo === "internet" ? setDestInternet : setDestRpv)(e.target.value)} />
              <input className={`${inp} w-24 font-mono uppercase`} value={code} placeholder="Código" onChange={(e) => setCode(e.target.value.trim().toUpperCase())} />
              {res?.kind === "ok" && st?.icmp && <span className="text-[11px] text-green-700">agente conectado</span>}
              {res?.kind === "ok" && !st?.icmp && <span className="text-[11px] text-amber-700">sin permisos ICMP</span>}
              {res?.kind === "codigo" && <span className="text-[11px] text-amber-700">falta el código</span>}
              {(!res || res.kind === "ausente") && <span className="text-[11px] text-slate-500">agente no detectado</span>}
            </>
          ) : (
            <input className={`${inp} w-40`} value={navDest} disabled={on} placeholder="Destino (vacío = Cloudflare)" onChange={(e) => setNavDest(e.target.value)} />
          )}
          <label className="flex items-center gap-1 text-[11px] text-slate-600">Mbps <input className={`${inp} w-16`} inputMode="decimal" value={mbps} disabled={on} onChange={(e) => setMbps(e.target.value)} title="Mbps por cada sentido (subida y bajada a la vez)" /></label>
          <label className="flex items-center gap-1 text-[11px] text-slate-600">Seg <input className={`${inp} w-16`} inputMode="numeric" value={seg} disabled={on} onChange={(e) => setSeg(e.target.value)} title="0 = hasta detener" /></label>
          {manual !== undefined && <label className="flex items-center gap-1 text-[11px] text-slate-600"><input type="checkbox" checked={manual} onChange={(e) => onManual?.(e.target.checked)} /> Otra herramienta</label>}
          <span className="ml-auto flex gap-1.5">
            <button className={b} onClick={copyLog}>Copiar</button>
            <button className={b} onClick={saveLog}>⬇ .txt</button>
            <button className={b} onClick={() => setBtLog([])} disabled={on}>Limpiar</button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-2 py-1 text-[11px]">
          {[["Subida", sub, "bg-blue-500"], ["Bajada", baj, "bg-emerald-500"]].map(([l, v, c]) => (
            <span key={l as string} className="flex items-center gap-1.5">
              <span className="w-12 text-slate-500">{l}</span>
              <span className="inline-block h-1.5 w-24 overflow-hidden rounded bg-slate-200"><span className={`block h-full ${c}`} style={{ width: `${pc(v as number)}%` }} /></span>
              <span className="font-mono">{(v as number).toFixed(1)} Mbps{tgtB > 0 ? ` · ${pc(v as number)}%` : ""}</span>
            </span>
          ))}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <pre ref={logBox} className="min-h-0 flex-1 overflow-auto bg-black p-2 font-mono text-[12px] text-emerald-300" style={{ lineHeight: 1.45, fontVariantLigatures: "none" }} aria-live="off">{btLog.length ? btLog.join("\n") : ""}</pre>
      </div>
    );
  }

  if (via === "navegador") {
    const tgt = Number(mbps) || 0;
    return (
      <div className={big ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
        <div className="shrink-0">{modeSwitch}</div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Destino (vacío = servidor de pruebas de Cloudflare)</span>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-[200px] flex-1" value={navDest} onChange={(e) => setNavDest(e.target.value)} placeholder="IP, dominio o URL (ej. 10.31.242.25 o https://host/archivo)" disabled={btRun} />
            {navDest && <button type="button" className="btn-secondary text-xs" onClick={() => setNavDest("")} disabled={btRun}>Usar Cloudflare</button>}
          </div>
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
          <div className="shrink-0 space-y-2 rounded-lg border border-slate-200 p-3">
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
        {logPane}
      </div>
    );
  }

  return (
    <div className={big ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      <div className="shrink-0">{modeSwitch}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {res?.kind === "ok" && st?.icmp && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Agente conectado</span>}
        {res?.kind === "ok" && !st?.icmp && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Agente sin permisos ICMP (ábrelo con sudo)</span>}
        {res?.kind === "codigo" && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Agente encontrado: falta el código</span>}
        {(!res || res.kind === "ausente") && <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-600">Agente no detectado</span>}
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          Código del agente
          <input className="input w-24 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.trim().toUpperCase())} placeholder="A1B2C3" />
        </label>
      </div>

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
        <div className="shrink-0 space-y-2 rounded-lg border border-slate-200 p-3">
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
      {logPane}
    </div>
  );
}

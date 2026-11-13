/**
 * Saturación desde el propio navegador (sin agente ni puente): descargas y subidas en paralelo.
 * Por defecto contra el servidor de pruebas de Cloudflare (llena el enlace de Internet de esta PC);
 * también se puede apuntar a otro destino (IP, dominio o URL). Un navegador no puede mandar ICMP ni
 * paquetes crudos: solo HTTP(S). Para eso y para RPV sigue el agente saturador.py.
 */
const CF_DOWN = "https://speed.cloudflare.com/__down?bytes=";
const CF_UP = "https://speed.cloudflare.com/__up";

export interface SatTick {
  down: number; up: number; sec: number; peakDown: number; peakUp: number;
  /** false = el destino no deja leer lo descargado (sin CORS): hay tráfico pero la bajada no se puede medir. */
  downMeasured: boolean;
  errors: number;
  /** Bytes acumulados desde que empezó. */
  downBytes: number; upBytes: number;
  /** Bytes de este segundo. */
  dBytes: number; uBytes: number;
}
export interface BrowserSat { stop: () => void }

/** «10.0.0.5», «10.0.0.5:8080», «host.com/archivo» o una URL completa -> URL. */
export function normalizeTarget(t: string): string {
  const s = t.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

const sleep = (ms: number, sig: AbortSignal) => new Promise<void>((res) => { const h = window.setTimeout(res, ms); sig.addEventListener("abort", () => { window.clearTimeout(h); res(); }, { once: true }); });

export function startBrowserSat(o: { seconds: number; streams?: number; target?: string; onTick: (t: SatTick) => void; onEnd: (error?: string) => void }): BrowserSat {
  const ctl = new AbortController();
  const n = Math.max(2, Math.min(12, o.streams ?? 6));
  const custom = normalizeTarget(o.target ?? "");
  let down = 0, up = 0, ok = false, ended = false, errors = 0, measured = true, lastErr = "";
  const chunk = new Blob([new Uint8Array(2_000_000)]);
  const url = (base: string) => base + (base.includes("?") ? "&" : "?") + "_=" + Math.random().toString(36).slice(2);

  const downOnce = async () => {
    if (!custom) {
      const r = await fetch(`${CF_DOWN}25000000`, { cache: "no-store", signal: ctl.signal });
      const rd = r.body?.getReader();
      if (!rd) throw new Error("El navegador no permite leer la descarga.");
      ok = true;
      for (;;) { const { done, value } = await rd.read(); if (done) break; down += value.byteLength; }
      return;
    }
    try {
      const r = await fetch(url(custom), { cache: "no-store", signal: ctl.signal });
      const rd = r.body?.getReader();
      ok = true;
      if (!rd) return;
      for (;;) { const { done, value } = await rd.read(); if (done) break; down += value.byteLength; }
    } catch (e) {
      if (ctl.signal.aborted) return;
      // sin CORS: se manda igual la petición (genera tráfico) pero la respuesta es opaca y no se puede medir
      await fetch(url(custom), { cache: "no-store", mode: "no-cors", signal: ctl.signal });
      measured = false; ok = true;
      void e;
    }
  };
  const upOnce = async () => {
    const target = custom || CF_UP;
    await fetch(custom ? url(target) : target, { method: "POST", body: chunk, cache: "no-store", mode: custom ? "no-cors" : "cors", signal: ctl.signal });
    ok = true;
    up += chunk.size;
  };

  // Cada flujo se reintenta siempre (el servidor corta conexiones largas o limita): la saturación dura lo que pediste.
  const loop = async (once: () => Promise<void>) => {
    let bad = 0;
    while (!ctl.signal.aborted) {
      try { await once(); bad = 0; }
      catch (e) {
        if (ctl.signal.aborted) return;
        errors++; bad++; lastErr = e instanceof Error ? e.message : String(e);
        await sleep(Math.min(3000, 250 * bad), ctl.signal);
      }
    }
  };
  for (let i = 0; i < n; i++) { void loop(downOnce); if (i < Math.ceil(n / 2)) void loop(upOnce); }

  const finish = (err?: string) => { if (ended) return; ended = true; window.clearInterval(tick); ctl.abort(); o.onEnd(err); };
  let sec = 0, ld = 0, lu = 0, pd = 0, pu = 0;
  const tick = window.setInterval(() => {
    sec += 1;
    const dB = down - ld, uB = up - lu;
    const d = (dB * 8) / 1e6, u = (uB * 8) / 1e6;
    ld = down; lu = up; pd = Math.max(pd, d); pu = Math.max(pu, u);
    o.onTick({ down: d, up: u, sec, peakDown: pd, peakUp: pu, downMeasured: measured, errors, downBytes: down, upBytes: up, dBytes: dB, uBytes: uB });
    if (!ok && sec >= 10) {
      const http = custom.startsWith("http://") && location.protocol === "https:";
      finish(http
        ? "El navegador bloquea destinos http:// desde una página https://. Usa un destino https:// o el agente."
        : `No se pudo llegar al destino${lastErr ? ` (${lastErr})` : ""}. Revisa la IP/URL y que el equipo responda HTTPS.`);
    } else if (o.seconds > 0 && sec >= o.seconds) finish();
  }, 1000);

  return { stop: () => finish() };
}

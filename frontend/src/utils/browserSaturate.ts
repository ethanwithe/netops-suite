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

export function startBrowserSat(o: { seconds: number; mbps?: number; streams?: number; target?: string; onTick: (t: SatTick) => void; onEnd: (error?: string) => void }): BrowserSat {
  const ctl = new AbortController();
  const n = Math.max(2, Math.min(12, o.streams ?? 6));
  const custom = normalizeTarget(o.target ?? "");
  let down = 0, up = 0, ok = false, ended = false, errors = 0, measured = true, lastErr = "";
  // Objetivo por sentido (Mbps): bajada y subida se controlan por separado y a la vez. 0 = lo máximo posible.
  const rate = Math.max(0, o.mbps ?? 0) * 1e6 / 8; // bytes por segundo en cada sentido
  const nUp = Math.max(2, Math.ceil(n / 2) + 1);
  // con objetivo, las subidas son trozos chicos para poder dosificarlas; sin objetivo, trozos grandes
  const chunkSize = rate > 0 ? Math.max(131072, Math.min(4_000_000, Math.round(rate / nUp / 4))) : 4_000_000;
  const chunk = new Blob([new Uint8Array(chunkSize)]);
  let allowDown = rate * 0.5, allowUp = rate * 0.5;
  const url = (base: string) => base + (base.includes("?") ? "&" : "?") + "_=" + Math.random().toString(36).slice(2);

  const downOnce = async () => {
    if (!custom) {
      const r = await fetch(`${CF_DOWN}25000000`, { cache: "no-store", signal: ctl.signal });
      const rd = r.body?.getReader();
      if (!rd) throw new Error("El navegador no permite leer la descarga.");
      ok = true;
      for (;;) { await waitDown(); const { done, value } = await rd.read(); if (done) break; down += value.byteLength; }
      return;
    }
    try {
      const r = await fetch(url(custom), { cache: "no-store", signal: ctl.signal });
      const rd = r.body?.getReader();
      ok = true;
      if (!rd) return;
      for (;;) { await waitDown(); const { done, value } = await rd.read(); if (done) break; down += value.byteLength; }
    } catch (e) {
      if (ctl.signal.aborted) return;
      // sin CORS: se manda igual la petición (genera tráfico) pero la respuesta es opaca y no se puede medir
      await fetch(url(custom), { cache: "no-store", mode: "no-cors", signal: ctl.signal });
      measured = false; ok = true;
      void e;
    }
  };
  const waitDown = async () => { while (rate > 0 && down >= allowDown && !ctl.signal.aborted) await sleep(15, ctl.signal); };
  const waitUp = async () => { while (rate > 0 && up >= allowUp && !ctl.signal.aborted) await sleep(15, ctl.signal); };
  /** Subida con avance en vivo (XMLHttpRequest): los bytes se cuentan mientras salen, no al terminar el trozo. */
  const xhrUp = (target: string) => new Promise<void>((res, rej) => {
    const x = new XMLHttpRequest();
    let last = 0;
    x.open("POST", target);
    x.upload.onprogress = (e) => { up += e.loaded - last; last = e.loaded; };
    x.onload = () => { up += chunk.size - last; ok = true; res(); };
    x.onerror = () => rej(new Error("Error de red al subir"));
    x.onabort = () => res();
    ctl.signal.addEventListener("abort", () => x.abort(), { once: true });
    x.send(chunk);
  });
  const upOnce = async () => {
    await waitUp();
    if (ctl.signal.aborted) return;
    if (!custom) { await xhrUp(CF_UP); return; }
    await fetch(url(custom), { method: "POST", body: chunk, cache: "no-store", mode: "no-cors", signal: ctl.signal });
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
  // bajada y subida arrancan juntas y siguen a la vez
  for (let i = 0; i < n; i++) void loop(downOnce);
  for (let i = 0; i < nUp; i++) void loop(upOnce);
  // reparto del presupuesto de bytes cada 100 ms (con un colchón de 0,5 s para no cortar el tráfico)
  const pace = window.setInterval(() => {
    if (rate <= 0) return;
    allowDown = Math.min(allowDown + rate * 0.1, down + rate * 0.5);
    allowUp = Math.min(allowUp + rate * 0.1, up + rate * 0.5);
  }, 100);

  const finish = (err?: string) => { if (ended) return; ended = true; window.clearInterval(tick); window.clearInterval(pace); ctl.abort(); o.onEnd(err); };
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

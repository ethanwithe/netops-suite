/**
 * Saturación desde el propio navegador (sin agente ni puente): descargas y subidas en paralelo
 * contra el servidor de pruebas de velocidad de Cloudflare. Llena el enlace de Internet de esta PC;
 * no sirve para RPV ni ICMP (para eso sigue el agente saturador.py).
 */
const DOWN = "https://speed.cloudflare.com/__down?bytes=";
const UP = "https://speed.cloudflare.com/__up";

export interface SatTick { down: number; up: number; sec: number; peakDown: number; peakUp: number }
export interface BrowserSat { stop: () => void }

export function startBrowserSat(o: { seconds: number; streams?: number; onTick: (t: SatTick) => void; onEnd: (error?: string) => void }): BrowserSat {
  const ctl = new AbortController();
  const n = Math.max(2, Math.min(12, o.streams ?? 6));
  let down = 0, up = 0, ok = false, ended = false;
  const chunk = new Blob([new Uint8Array(2_000_000)]);

  const downLoop = async () => {
    while (!ctl.signal.aborted) {
      const r = await fetch(`${DOWN}${25_000_000}`, { cache: "no-store", signal: ctl.signal });
      const rd = r.body?.getReader();
      if (!rd) throw new Error("El navegador no permite leer la descarga.");
      ok = true;
      for (;;) { const { done, value } = await rd.read(); if (done) break; down += value.byteLength; }
    }
  };
  const upLoop = async () => {
    while (!ctl.signal.aborted) {
      await fetch(UP, { method: "POST", body: chunk, cache: "no-store", signal: ctl.signal });
      ok = true;
      up += chunk.size;
    }
  };

  const finish = (err?: string) => { if (ended) return; ended = true; window.clearInterval(tick); ctl.abort(); o.onEnd(err); };
  const fail = (e: unknown) => { if (!ctl.signal.aborted) finish(ok ? undefined : "No se pudo llegar al servidor de pruebas (¿sin Internet o bloqueado por la red?).") ; void e; };
  for (let i = 0; i < n; i++) { void downLoop().catch(fail); if (i < Math.ceil(n / 2)) void upLoop().catch(fail); }

  let sec = 0, ld = 0, lu = 0, pd = 0, pu = 0;
  const tick = window.setInterval(() => {
    sec += 1;
    const d = ((down - ld) * 8) / 1e6, u = ((up - lu) * 8) / 1e6;
    ld = down; lu = up; pd = Math.max(pd, d); pu = Math.max(pu, u);
    o.onTick({ down: d, up: u, sec, peakDown: pd, peakUp: pu });
    if (o.seconds > 0 && sec >= o.seconds) finish();
  }, 1000);

  return { stop: () => finish() };
}

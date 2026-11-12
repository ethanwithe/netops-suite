/**
 * Puente local (puente.py): programa que corre en TU laptop y le presta a la página
 * (que está en la nube) el cable de consola y el SSH hacia tu red local.
 * La página solo habla con 127.0.0.1 y con el código que muestra el programa.
 */
import { ConsoleSession } from "./webSerial";

export const PUENTE_URL = "http://127.0.0.1:8766";

export interface PuertoInfo { device: string; desc: string; hwid: string; usb: boolean; fabricante: string }
export type PuenteEstado =
  | { kind: "ok"; ports: PuertoInfo[]; serial: boolean }
  | { kind: "codigo" }   // el puente existe pero el código no coincide
  | { kind: "ausente" }; // no está abierto (o el navegador lo bloqueó)

async function call(path: string, code: string, body?: unknown, timeoutMs = 15000): Promise<Response> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(PUENTE_URL + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Token": code.trim().toUpperCase(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    window.clearTimeout(t);
  }
}

/** ¿Está abierto el puente? ¿el código es correcto? ¿qué puertos ve? */
export async function puenteEstado(code: string): Promise<PuenteEstado> {
  try {
    const hola = await fetch(PUENTE_URL + "/hola", { signal: AbortSignal.timeout(2500) });
    if (!hola.ok) return { kind: "ausente" };
    const r = await call("/puertos", code.trim(), undefined, 5000);
    if (r.status === 401) return { kind: "codigo" };
    const d = await r.json();
    return { kind: "ok", ports: d.ports ?? [], serial: !!d.serial };
  } catch {
    return { kind: "ausente" };
  }
}

export type PuenteOpen =
  | { kind: "serial"; port: string; baud: number }
  | { kind: "ssh"; host: string; port: number; user: string; password: string };

export class PuenteSession extends ConsoleSession {
  private sid = "";
  private pos = 0;
  constructor(private code: string) { super(); }

  async connect(opts: PuenteOpen): Promise<void> {
    const r = await call("/abrir", this.code, opts, 30000);
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("El código del puente no coincide: mira el que muestra la ventana del puente (puente.py) y pégalo en el recuadro «Código del puente».");
    if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
    this.sid = d.sid;
    this.closed = false;
    void this.pollLoop();
    if (opts.kind === "serial") { await this.write("\r"); }
    await new Promise((res) => setTimeout(res, opts.kind === "ssh" ? 800 : 400));
  }

  get connected() { return !!this.sid && !this.closed; }

  private async pollLoop() {
    let fails = 0;
    while (!this.closed) {
      try {
        const r = await call(`/leer?sid=${this.sid}&desde=${this.pos}`, this.code, undefined, 8000);
        const d = await r.json();
        fails = 0;
        if (d.d) this.feed(String(d.d));
        if (typeof d.n === "number") this.pos = d.n;
        if (!d.abierto) {
          if (!this.closed) { this.closed = true; this.onClose?.(d.error ? `La conexión se cerró: ${d.error}` : "La conexión se cerró."); }
          return;
        }
      } catch {
        if (++fails >= 4 && !this.closed) { this.closed = true; this.onClose?.("Se perdió la comunicación con el puente (¿lo cerraste?)."); return; }
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  }

  protected async write(text: string) {
    const r = await call("/escribir", this.code, { sid: this.sid, d: text });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error || "No se pudo enviar al equipo.");
    }
  }

  async close() {
    this.closed = true;
    const sid = this.sid;
    this.sid = "";
    if (sid) { try { await call("/cerrar", this.code, { sid }, 4000); } catch { /* */ } }
  }
}

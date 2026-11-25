/**
 * Consola por el puerto USB/COM de ESTA computadora, directo desde el navegador
 * (Web Serial: Chrome/Edge). El servidor en la nube no puede ver tu puerto COM,
 * por eso los comandos se envían desde aquí.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const webSerialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const MORE = /(-{2,}\s*more\s*-{2,}|<--- more --->|--more\(.*?\)--)/i;
// Prompt al final: <Huawei>  [Huawei-if]  Router#  Router>  FGT (vdom) #
/** Pausas que solo piden una tecla para seguir («Press any key», «Press ENTER to continue»). */
const CONTINUE = /(press\s+(any\s+key|enter|return)|presione\s+(cualquier\s+tecla|enter)|hit\s+(any\s+key|enter))[^\n]{0,50}$/i;
const PROMPT = /(?:^|\n)[^\n]{0,80}[>\]#$]\s?$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lógica común: envía comandos, espera el prompt y salta los «---- More ----». */
export abstract class ConsoleSession {
  protected buf = "";
  protected closed = false;
  stopRequested = false;
  /** Todo lo que llega de la consola, en vivo (para mostrar la CLI del router). */
  onData: ((chunk: string) => void) | null = null;
  /** Se llama cuando la conexión se corta sola (cable desconectado, SSH cerrado…). */
  onClose: ((reason: string) => void) | null = null;

  abstract get connected(): boolean;
  protected abstract write(text: string): Promise<void>;
  abstract close(): Promise<void>;

  /** Últimos caracteres recibidos: de ahí sale el nombre del equipo (prompt) antes de cada comando. */
  private recent = "";

  protected feed(txt: string) {
    this.recent = (this.recent + txt).slice(-400);
    this.buf += txt;
    this.onData?.(txt);
  }

  async run(cmd: string, opts: { maxMs?: number } = {}): Promise<string> {
    if (!this.connected) throw new Error("La consola no está conectada.");
    const maxMs = opts.maxMs ?? 900000;      // 15 min: un «show ip route» de un banco puede tardar minutos; se corta con «Detener»
    const prompt = promptOf(this.recent);

    // Cada ejecución sale por separado: antes de enviar se deja terminar lo que el equipo aún estuviera escribiendo del comando anterior
    // (si no, esa cola caía dentro de la captura siguiente) y se descarta.
    const s0 = Date.now();
    let seen = this.buf.length;
    let quietSince = Date.now();
    while (Date.now() - s0 < 4000 && Date.now() - quietSince < 300) {
      await sleep(60);
      if (this.buf.length !== seen) { seen = this.buf.length; quietSince = Date.now(); }
    }
    this.buf = "";
    await this.write(cmd + "\r");

    const t0 = Date.now();
    let lastLen = 0;
    let lastChange = Date.now();
    let moreSeen = 0;
    while (Date.now() - t0 < maxMs) {
      if (this.stopRequested || !this.connected) break;
      await sleep(120);
      if (this.buf.length !== lastLen) {
        lastLen = this.buf.length;
        lastChange = Date.now();
        const tail = this.buf.slice(-120);
        if (MORE.test(tail) && Date.now() - moreSeen > 100) {
          moreSeen = Date.now();
          await this.write(" ");
        } else if (CONTINUE.test(tail.replace(ANSI, "")) && Date.now() - moreSeen > 400) {
          moreSeen = Date.now();
          await this.write("\r");
        }
        continue;
      }
      const quiet = Date.now() - lastChange;
      const clean = this.buf.replace(ANSI, "");
      const trimmed = clean.replace(/[ \t\r\n]+$/, "");
      const gotSome = clean.length > cmd.length;
      // 1) Se conoce el prompt del equipo: la salida termina cuando ese mismo prompt vuelve a aparecer al final (da igual cuánto tarde).
      if (prompt && gotSome && quiet > 600 && trimmed.endsWith(prompt.trim())) break;
      // 2) El prompt cambió (p. ej. entró a otro modo): un prompt genérico al final y 5 s en silencio.
      if (gotSome && quiet > 5000 && PROMPT.test(clean.replace(/[ \t]+$/, " "))) break;
      // 3) No se conoce el prompt: 8 s sin nada nuevo (comandos como ping). Con prompt conocido solo se rinde tras 2 min de silencio total.
      if (!prompt && quiet > 8000) break;
      if (prompt && quiet > 120000) break;
    }
    return withPrompt(trimToEcho(cleanOutput(this.buf), cmd), cmd, prompt);
  }

  /** Envía bytes tal cual (una tecla, Tab, Ctrl+C…): para el «teclado directo» del CLI. */
  async raw(text: string) {
    if (!this.connected) return;
    await this.write(text);
  }

  /** Escribe en la consola tal cual (para que tú también puedas teclear comandos). */
  async typed(text: string) {
    if (!this.connected) throw new Error("La consola no está conectada.");
    await this.write(text + "\r");
  }
}

/** Consola por el puerto de esta computadora, directo desde el navegador (Web Serial). */
export class SerialSession extends ConsoleSession {
  private port: any = null;
  private reader: any = null;
  private writer: any = null;

  async connect(baudRate: number): Promise<void> {
    const serial = (navigator as any).serial;
    this.port = await serial.requestPort();
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    this.writer = this.port.writable.getWriter();
    this.closed = false;
    void this.readLoop();
    await this.write("\r");
    await sleep(400);
  }

  get connected() {
    return !!this.port && !this.closed;
  }

  private async readLoop() {
    const dec = new TextDecoder();
    try {
      this.reader = this.port.readable.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.feed(dec.decode(value, { stream: true }));
      }
    } catch {
      /* puerto cerrado o desconectado */
    } finally {
      if (!this.closed) { this.closed = true; this.onClose?.("Se perdió la conexión con el puerto (¿se desconectó el cable?)."); }
    }
  }

  protected async write(text: string) {
    await this.writer.write(new TextEncoder().encode(text));
  }

  async close() {
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* */
    }
    try {
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* */
    }
    this.port = this.reader = this.writer = null;
  }
}

/** Quita colores ANSI, los restos de "---- More ----" y los retornos de carro. */
export function cleanOutput(raw: string): string {
  return raw
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/[ \t]*-{2,}\s*More\s*-{2,}[ \t]*(\x08+\s*\x08*)?/gi, "")
    .replace(/\x08+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/** Quita lo que llegó antes del eco del comando (restos tardíos del comando anterior), conservando el prompt de esa línea. */
export function trimToEcho(out: string, cmd: string): string {
  const c = cmd.trim();
  if (!c) return out;
  const i = out.indexOf(c);
  if (i <= 0 || i > 4000) return out;
  const before = out.slice(0, i);
  const lineStart = before.lastIndexOf("\n") + 1;
  const sameLine = before.slice(lineStart);
  // si antes del eco solo hay un prompt corto (p. ej. «Router#»), no hay nada que quitar
  if (!before.slice(0, lineStart).trim()) return out;
  return sameLine + out.slice(i);
}

/** Prompt del equipo (p. ej. «Router#», «<Huawei>») según lo último que escribió la consola, o "". */
export function promptOf(recent: string): string {
  const lines = cleanOutput(recent).split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const last = lines[lines.length - 1] ?? "";
  return last.length <= 80 && /[>\]#$]$/.test(last) ? last.trimStart() : "";
}

/** Deja la salida empezando por «prompt + comando» (como se ve en la terminal), aunque el equipo no repita el eco. */
export function withPrompt(out: string, cmd: string, prompt: string): string {
  const c = cmd.trim();
  if (!prompt || !c) return out;
  const first = out.split("\n", 1)[0] ?? "";
  if (first.includes(c)) return first.trimStart().startsWith(prompt) ? out : prompt + out.replace(/^\s+/, "");
  return `${prompt}${c}\n${out}`;
}

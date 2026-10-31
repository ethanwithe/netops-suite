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
const PROMPT = /(?:^|\n)[^\n]{0,80}[>\]#$]\s?$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SerialSession {
  private port: any = null;
  private reader: any = null;
  private writer: any = null;
  private buf = "";
  private reading = false;
  private closed = false;
  stopRequested = false;

  async connect(baudRate: number): Promise<void> {
    const serial = (navigator as any).serial;
    this.port = await serial.requestPort();
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    this.writer = this.port.writable.getWriter();
    this.closed = false;
    void this.readLoop();
    // Despierta el prompt
    await this.write("\r");
    await sleep(400);
  }

  get connected() {
    return !!this.port && !this.closed;
  }

  private async readLoop() {
    this.reading = true;
    const dec = new TextDecoder();
    try {
      this.reader = this.port.readable.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.buf += dec.decode(value, { stream: true });
      }
    } catch {
      /* puerto cerrado o desconectado */
    } finally {
      this.reading = false;
    }
  }

  private async write(text: string) {
    await this.writer.write(new TextEncoder().encode(text));
  }

  /**
   * Envía un comando y devuelve todo lo que mostró la consola (con el comando y el prompt),
   * saltando automáticamente las pausas "---- More ----".
   */
  async run(cmd: string, opts: { maxMs?: number } = {}): Promise<string> {
    if (!this.connected) throw new Error("La consola no está conectada.");
    const maxMs = opts.maxMs ?? 90000;
    this.buf = "";
    await this.write(cmd + "\r");

    const t0 = Date.now();
    let lastLen = 0;
    let lastChange = Date.now();
    let moreSeen = 0;
    while (Date.now() - t0 < maxMs) {
      if (this.stopRequested) break;
      await sleep(150);
      if (this.buf.length !== lastLen) {
        lastLen = this.buf.length;
        lastChange = Date.now();
        const tail = this.buf.slice(-120);
        if (MORE.test(tail) && Date.now() - moreSeen > 100) {
          moreSeen = Date.now();
          await this.write(" ");
        }
        continue;
      }
      const quiet = Date.now() - lastChange;
      const clean = this.buf.replace(ANSI, "");
      if (quiet > 600 && clean.length > cmd.length && PROMPT.test(clean.replace(/[ \t]+$/, " "))) break;
      if (quiet > 4000) break; // comandos largos sin prompt claro (p. ej. ping)
    }
    return cleanOutput(this.buf);
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

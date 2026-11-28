/**
 * Emulador de terminal ligero (suficiente para CLI de routers y switches por consola/SSH):
 * texto, \r \n \b \t, mover el cursor, borrar línea/pantalla, borrar/insertar caracteres y colores SGR.
 * No usa librerías: la pantalla es una lista de líneas que se dibuja en HTML.
 */
import { colorMap, customMap, rulesVersion } from "./termColors";

export interface VCell { c: string; f: number; b: boolean }

const ESC = "\x1b";
const PALETTE = ["#1e1e1e", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d0d0d0",
  "#6b7280", "#ff7b86", "#b5e890", "#f5d68a", "#7cc0ff", "#e08cff", "#73d6e0", "#ffffff"];
export const colorOf = (i: number) => (i >= 0 && i < 16 ? PALETTE[i] : "");

export class Vt {
  cols = 100;
  rows = 24;
  maxLines = 2000;
  lines: VCell[][] = [[]];
  cx = 0;
  cy = 0;
  /** Líneas que ya salieron por arriba (para numerar y no perder el hilo al recortar). */
  dropped = 0;
  private f = -1;
  private b = false;
  private st: "n" | "esc" | "csi" | "osc" | "skip" = "n";
  private params = "";
  private saved = { x: 0, y: 0 };

  clear() { this.lines = [[]]; this.cx = 0; this.cy = 0; this.dropped = 0; }

  private line(y: number): VCell[] {
    while (this.lines.length <= y) this.lines.push([]);
    return this.lines[y];
  }

  private newline() {
    this.cy++;
    this.cx = 0;
    this.line(this.cy);
    if (this.lines.length > this.maxLines) {
      const cut = this.lines.length - this.maxLines;
      this.lines.splice(0, cut);
      this.cy -= cut;
      this.dropped += cut;
    }
  }

  private put(ch: string) {
    if (this.cx >= this.cols) this.newline();
    const ln = this.line(this.cy);
    while (ln.length < this.cx) ln.push({ c: " ", f: -1, b: false });
    ln[this.cx] = { c: ch, f: this.f, b: this.b };
    this.cx++;
  }

  write(s: string) {
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      switch (this.st) {
        case "esc":
          if (ch === "[") { this.st = "csi"; this.params = ""; }
          else if (ch === "]") this.st = "osc";
          else if (ch === "(" || ch === ")" || ch === "#") this.st = "skip";
          else if (ch === "7") { this.saved = { x: this.cx, y: this.cy }; this.st = "n"; }
          else if (ch === "8") { this.cx = this.saved.x; this.cy = this.saved.y; this.st = "n"; }
          else if (ch === "c") { this.clear(); this.st = "n"; }
          else this.st = "n";
          break;
        case "skip": this.st = "n"; break;
        case "osc":
          if (ch === "\x07") this.st = "n";
          else if (ch === ESC) this.st = "skip"; // ESC \ termina
          break;
        case "csi":
          if ((ch >= "0" && ch <= "9") || ch === ";" || ch === "?" || ch === ">" || ch === "=" || ch === "!") this.params += ch;
          else { this.csi(ch, this.params); this.st = "n"; }
          break;
        default:
          if (ch === ESC) this.st = "esc";
          else if (ch === "\r") this.cx = 0;
          else if (ch === "\n") this.newline();
          else if (ch === "\b" || ch === "\x7f") this.cx = Math.max(0, this.cx - 1);
          else if (ch === "\t") this.cx = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8);
          else if (ch === "\x07" || ch === "\0" || ch < " ") { /* campana y controles: se ignoran */ }
          else this.put(ch);
      }
    }
  }

  private csi(cmd: string, raw: string) {
    if (raw.startsWith("?") || raw.startsWith(">") || raw.startsWith("=") || raw.startsWith("!")) return;
    const p = raw.split(";").map((x) => (x === "" ? NaN : Number(x)));
    const n = (i: number, d: number) => (Number.isFinite(p[i]) && p[i] > 0 ? p[i] : d);
    const ln = () => this.line(this.cy);
    switch (cmd) {
      case "A": this.cy = Math.max(0, this.cy - n(0, 1)); break;
      case "B": this.cy += n(0, 1); this.line(this.cy); break;
      case "C": this.cx = Math.min(this.cols - 1, this.cx + n(0, 1)); break;
      case "D": this.cx = Math.max(0, this.cx - n(0, 1)); break;
      case "G": this.cx = Math.min(this.cols - 1, n(0, 1) - 1); break;
      case "d": this.cy = Math.max(0, this.lines.length - this.rows) + n(0, 1) - 1; this.line(this.cy); break;
      case "H": case "f": {
        this.cy = Math.max(0, this.lines.length - this.rows) + n(0, 1) - 1;
        this.line(this.cy);
        this.cx = Math.min(this.cols - 1, n(1, 1) - 1);
        break;
      }
      case "K": {
        const m = Number.isFinite(p[0]) ? p[0] : 0;
        const l = ln();
        if (m === 0) l.length = Math.min(l.length, this.cx);
        else if (m === 1) for (let x = 0; x <= this.cx && x < l.length; x++) l[x] = { c: " ", f: -1, b: false };
        else l.length = 0;
        break;
      }
      case "J": {
        const m = Number.isFinite(p[0]) ? p[0] : 0;
        if (m === 0) { const l = ln(); l.length = Math.min(l.length, this.cx); this.lines.length = this.cy + 1; }
        else if (m === 2 || m === 3) { this.lines = [[]]; this.cy = 0; this.cx = Math.min(this.cx, this.cols - 1); }
        break;
      }
      case "P": ln().splice(this.cx, n(0, 1)); break;
      case "@": { const l = ln(); while (l.length < this.cx) l.push({ c: " ", f: -1, b: false }); l.splice(this.cx, 0, ...Array.from({ length: n(0, 1) }, () => ({ c: " ", f: -1, b: false }))); if (l.length > this.cols) l.length = this.cols; break; }
      case "X": { const l = ln(); for (let k = 0; k < n(0, 1); k++) if (this.cx + k < l.length) l[this.cx + k] = { c: " ", f: -1, b: false }; break; }
      case "s": this.saved = { x: this.cx, y: this.cy }; break;
      case "u": this.cx = this.saved.x; this.cy = this.saved.y; break;
      case "m": this.sgr(p); break;
      default: break;
    }
  }

  private sgr(p: number[]) {
    if (!p.length) p = [0];
    for (let i = 0; i < p.length; i++) {
      const v = Number.isFinite(p[i]) ? p[i] : 0;
      if (v === 0) { this.f = -1; this.b = false; }
      else if (v === 1) this.b = true;
      else if (v === 22) this.b = false;
      else if (v >= 30 && v <= 37) this.f = v - 30;
      else if (v >= 90 && v <= 97) this.f = v - 90 + 8;
      else if (v === 39) this.f = -1;
      else if (v === 38) { if (p[i + 1] === 5) { const c = p[i + 2]; this.f = c >= 0 && c < 16 ? c : -1; i += 2; } else if (p[i + 1] === 2) i += 4; }
      else if (v === 48) { if (p[i + 1] === 5) i += 2; else if (p[i + 1] === 2) i += 4; }
    }
  }

  /** Texto plano de las líneas (para buscar y descargar). */
  text(): string { return this.lines.map((l) => l.map((c) => c.c).join("").replace(/\s+$/, "")).join("\n"); }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const htmlCache = new WeakMap<VCell[], { key: string; html: string }>();

/** HTML de una línea (agrupa celdas con el mismo color) y, si lleva el cursor, lo marca.
 *  `paint`: pinta con los colores de MobaXterm lo que el equipo mandó sin color (IPs, interfaces, up/down, errores, prompt…). */
export function lineHtml(l: VCell[], cursorAt = -1, paint: "dark" | "light" | "" = ""): string {
  let key = "";
  if (cursorAt < 0) {
    for (const c of l) key += c.c + c.f + (c.b ? "b" : "");
    key += paint + rulesVersion;
    const hit = htmlCache.get(l);
    if (hit && hit.key === key) return hit.html;
  }
  const text = l.map((c) => c.c).join("");
  const auto = paint ? colorMap(text, paint === "dark") : [];
  const mine = customMap(text);
  let out = "", run = "", col = "#", b = false;
  const flush = () => {
    if (!run) return;
    out += col || b ? `<span style="${col ? `color:${col};` : ""}${b ? "font-weight:700" : ""}">${esc(run)}</span>` : esc(run);
    run = "";
  };
  const n = Math.max(l.length, cursorAt + 1);
  for (let x = 0; x < n; x++) {
    const c = l[x] ?? { c: " ", f: -1, b: false };
    if (x === cursorAt) { flush(); out += `<span class="vt-cur">${esc(c.c)}</span>`; col = "#"; continue; }
    const k = mine[x] || (c.f >= 0 ? colorOf(c.f) : (auto[x] || ""));
    if (k !== col || c.b !== b) { flush(); col = k; b = c.b; }
    run += c.c;
  }
  flush();
  const html = out || " ";
  if (cursorAt < 0) htmlCache.set(l, { key, html });
  return html;
}

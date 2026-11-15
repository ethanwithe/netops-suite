/**
 * Línea de comandos local de la Terminal (cuando no hay conexión): escribes directo en la pantalla,
 * por ejemplo `ssh admin@192.168.1.1` o `serial COM3 9600`, sin cuadros de texto ni formularios.
 */
import { puenteEstado } from "../utils/puente";
import { connectTerminal, feed, getSession, setIdleHook, termClear, vt } from "./terminal";

const PREFIX = "netops.ui.v1.";
function saved<T>(key: string, def: T): T {
  try { const raw = localStorage.getItem(PREFIX + key); if (raw) { const o = JSON.parse(raw); if (o && "v" in o) return o.v as T; } } catch { /* sin datos */ }
  return def;
}
function store(key: string, v: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ v, d: false })); } catch { /* */ }
}

const PROMPT = "\x1b[32mterminal\x1b[0m> ";
let buf = "";
let mode: "cmd" | "pass" = "cmd";
let pending: { host: string; port: number; user: string } | null = null;
let hist: string[] = [];
let hi = -1;
let busy = false;

export function shellPrompt() { buf = ""; mode = "cmd"; hi = -1; feed(PROMPT); }
export function shellInit() { if (!getSession() && vt.lines.length <= 1 && vt.lines[0].length === 0) shellPrompt(); }
setIdleHook(() => { busy = false; shellPrompt(); });

const HELP = [
  "ssh [usuario@]equipo [-p puerto]   conecta por SSH",
  "serial [COMx|/dev/ttyUSB0] [baudios]   conecta por el cable de consola",
  "serial navegador [baudios]   elige el puerto desde el navegador",
  "ports   lista los puertos que ve el puente",
  "codigo XXXXXX   guarda el código del puente",
  "clear   limpia la pantalla",
];

async function run(line: string) {
  const [cmd, ...a] = line.trim().split(/\s+/);
  const c = (cmd || "").toLowerCase();
  if (!c) return shellPrompt();
  if (c === "clear" || c === "cls") { termClear(); return shellPrompt(); }
  if (c === "help" || c === "?" || c === "ayuda") { feed(HELP.join("\r\n") + "\r\n"); return shellPrompt(); }
  if (c === "codigo" || c === "code") {
    if (a[0]) { store("puente.codigo", a[0].toUpperCase()); feed("Código guardado.\r\n"); } else feed("Uso: codigo XXXXXX\r\n");
    return shellPrompt();
  }
  if (c === "ports" || c === "puertos") {
    busy = true;
    const r = await puenteEstado(saved("puente.codigo", ""));
    busy = false;
    if (r.kind === "ok") feed(r.ports.length ? r.ports.map((p) => `${p.device}  ${p.desc || p.fabricante || ""}`).join("\r\n") + "\r\n" : "Sin puertos: conecta el cable.\r\n");
    else if (r.kind === "codigo") feed("\x1b[31mEl código del puente no coincide.\x1b[0m Usa: codigo XXXXXX\r\n");
    else feed("\x1b[31mNo se detecta el puente.\x1b[0m Ábrelo en tu laptop.\r\n");
    return shellPrompt();
  }
  if (c === "ssh") {
    let host = "", user = "", port = 22;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === "-p") port = Number(a[++i]) || 22;
      else if (a[i] === "-l") user = a[++i] || "";
      else if (!host) { const m = a[i].split("@"); if (m.length > 1) { user = m[0]; host = m.slice(1).join("@"); } else host = a[i]; }
    }
    const h = host.match(/^(.+):(\d+)$/); if (h) { host = h[1]; port = Number(h[2]); }
    if (!user) user = saved("checklist.ssh", { host: "", port: 22, user: "" }).user;
    if (!host) { feed("Uso: ssh usuario@equipo [-p puerto]\r\n"); return shellPrompt(); }
    if (!user) { feed("Falta el usuario: ssh usuario@" + host + "\r\n"); return shellPrompt(); }
    pending = { host, port, user };
    mode = "pass"; buf = "";
    feed(`Contraseña de ${user}@${host}: `);
    return;
  }
  if (c === "serial" || c === "console" || c === "consola" || c === "com") {
    const nav = a[0]?.toLowerCase() === "navegador";
    const rest = nav ? a.slice(1) : a;
    const baud = Number(rest.find((x) => /^\d{4,6}$/.test(x))) || saved("checklist.baud", 9600);
    const puerto = rest.find((x) => !/^\d{4,6}$/.test(x)) || saved("checklist.puerto", "");
    busy = true;
    await connectTerminal({ mode: nav ? "navegador" : "puente", via: "serial", code: saved("puente.codigo", ""), puerto, baud, host: "", port: 22, user: "", pass: "" });
    if (!getSession()) { busy = false; shellPrompt(); }
    return;
  }
  feed(`${c}: comando no reconocido (escribe help)\r\n`);
  shellPrompt();
}

/** Teclas (en forma de secuencia de terminal) cuando no hay conexión. */
export function shellKey(seq: string) {
  if (busy) return;
  if (seq === "\r") {
    const line = buf;
    if (mode === "pass") {
      feed("\r\n");
      const p = pending; pending = null; mode = "cmd"; buf = "";
      if (!p) return shellPrompt();
      busy = true;
      store("checklist.ssh", { host: p.host, port: p.port, user: p.user });
      void connectTerminal({ mode: "puente", via: "ssh", code: saved("puente.codigo", ""), puerto: "", baud: 9600, host: p.host, port: p.port, user: p.user, pass: line })
        .then(() => { if (!getSession()) { busy = false; shellPrompt(); } });
      return;
    }
    feed("\r\n");
    if (line.trim()) hist = [line, ...hist.filter((x) => x !== line)].slice(0, 100);
    buf = ""; hi = -1;
    void run(line);
    return;
  }
  if (seq === "\x7f") { if (buf) { buf = buf.slice(0, -1); if (mode === "cmd") feed("\b \b"); } return; }
  if (seq === "\x03") { buf = ""; mode = "cmd"; pending = null; feed("^C\r\n"); shellPrompt(); return; }
  if (seq === "\x15") { if (mode === "cmd") feed("\b \b".repeat(buf.length)); buf = ""; return; }
  if (mode === "cmd" && (seq === "\x1b[A" || seq === "\x1b[B")) {
    const n = seq === "\x1b[A" ? Math.min(hist.length - 1, hi + 1) : Math.max(-1, hi - 1);
    feed("\b \b".repeat(buf.length));
    hi = n; buf = n >= 0 ? hist[n] : "";
    feed(buf);
    return;
  }
  if (seq === "\t" || seq.startsWith("\x1b")) return;
  for (const ch of seq) {
    if (ch >= " " && ch !== "\x7f") { buf += ch; if (mode === "cmd") feed(ch); }
  }
}

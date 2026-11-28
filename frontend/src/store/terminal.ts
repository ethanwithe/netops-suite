/**
 * Terminal global: la conexión (consola o SSH) vive aquí, no en una página, para que la ventana flotante
 * «Terminal» (barra superior) y el CheckList usen la misma sesión.
 */
import { useSyncExternalStore } from "react";
import { PuenteSession } from "../utils/puente";
import { SerialSession } from "../utils/webSerial";
import type { ConsoleSession } from "../utils/webSerial";
import { Vt } from "../utils/vt";
import { notify as toast } from "../utils/saveFile";

export const vt = new Vt();
let session: ConsoleSession | null = null;
let setupCmds: string[] = [];
let fullLog = "";
let state = { rev: 0, connected: false, status: "", label: "" };
let lastOpts: ConnectOpts | null = null;
export const getLastOpts = () => lastOpts;
const listeners = new Set<() => void>();
const rawListeners = new Set<(chunk: string) => void>();
let timer: number | null = null;

const notify = () => listeners.forEach((l) => l());
const bump = (patch: Partial<typeof state> = {}) => { state = { ...state, ...patch, rev: state.rev + 1 }; notify(); };
/** Redibuja como mucho unas 12 veces por segundo (la salida de un `show tech` llega a ráfagas). */
const schedule = () => { if (timer == null) timer = window.setTimeout(() => { timer = null; bump(); }, 80); };

const plain = (prev: string, chunk: string) => {
  let out = prev;
  for (const ch of chunk.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")) {
    if (ch === "\b" || ch === "\x7f") { if (out && !out.endsWith("\n")) out = out.slice(0, -1); }
    else if (ch !== "\r" && ch !== "\x07" && ch !== "\0") out += ch;
  }
  return out;
};

let lastOut = 0;
let lastIn = 0;
/** Texto que llega del equipo (o notas propias). */
export function feed(chunk: string) {
  lastOut = Date.now();
  vt.write(chunk);
  fullLog = plain(fullLog, chunk).slice(-1_500_000);
  schedule();
}
const mark = (t: string) => feed(`\r\n\x1b[90m===== ${new Date().toLocaleString("es-PE")} · ${t} =====\x1b[0m\r\n`);

export const getSession = () => session;
export const termLog = () => fullLog;
export function termClear() { vt.clear(); bump(); }
export function termForget() { fullLog = ""; vt.clear(); bump(); }
let idleHook: (() => void) | null = null;
export function setIdleHook(f: () => void) { idleHook = f; }
export function setSetupCommands(c: string[]) { setupCmds = c; }
let interrupts = 0;
/** Cuántas veces se interrumpió (Ctrl+C, Ctrl+Shift+6, Ctrl+Z): los envíos de varios comandos se detienen al instante. */
export const interruptCount = () => interrupts;
// historial de comandos escritos o enviados (se guarda en este equipo)
const HK = "netops:terminal.historial";
let history: string[] = (() => { try { const v = JSON.parse(localStorage.getItem(HK) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-300) : []; } catch { return []; } })();
let typed = "";
export const getHistory = () => history;
export function clearHistory() { history = []; try { localStorage.removeItem(HK); } catch { /* sin almacenamiento */ } bump(); }
function remember(cmd: string) {
  const c = cmd.trim();
  if (!c || c.length > 400) return;
  history = [...history.filter((x) => x !== c), c].slice(-300);
  try { localStorage.setItem(HK, JSON.stringify(history)); } catch { /* sin almacenamiento */ }
  schedule();
}
function track(s: string) {
  for (const ch of s.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, "\u0001")) {
    if (ch === "\r" || ch === "\n") { remember(typed); typed = ""; }
    else if (ch === "\x7f" || ch === "\x08") typed = typed.slice(0, -1);
    else if (ch === "\x03" || ch === "\x1a" || ch === "\x15" || ch === "\x1b" || ch === "\u0001") typed = "";   // lo que sigue ya no se puede saber con certeza
    else if (ch >= " ") typed += ch;
  }
}
export function sendRaw(s: string) {
  lastIn = Date.now();
  if (/[\x03\x1a\x1e]/.test(s)) interrupts++;
  track(s);
  void session?.raw(s);
}

/** Anota una línea gris con la hora en la pantalla y el registro (útil como evidencia). */
export function termNote(t = "Marca") { mark(t); }

// ---------------- aviso al terminar un comando largo ----------------
let watching = false;
let alertTimer: number | null = null;
export const isWatching = () => watching;
function beep() {
  try {
    const A = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new A();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch { /* sin audio */ }
}
/** Una sola vez: cuando el equipo deje de sacar datos y vuelva el prompt, suena y avisa (aunque estés en otra pestaña). */
export function watchFinish(on: boolean) {
  watching = on;
  if (alertTimer != null) { window.clearInterval(alertTimer); alertTimer = null; }
  if (on) {
    let seenOutput = false;
    alertTimer = window.setInterval(() => {
      const now = Date.now();
      if (now - lastOut < 1500) { seenOutput = true; return; }
      if (!seenOutput && now - lastIn > 8000) { /* nada en marcha todavía: se sigue esperando */ }
      const last = (vt.lines[vt.cy] ?? []).map((c) => c.c).join("");
      if (seenOutput && now - lastOut > 3000 && /[#>\]$]\s*$/.test(last)) {
        watchFinish(false);
        beep();
        toast("Terminó el comando en la terminal.", "ok", undefined, 6000);
        try { if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("NetOps Suite", { body: "Terminó el comando en la terminal." }); } catch { /* sin permiso */ }
      }
    }, 1000);
    try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* sin permiso */ }
  }
  bump();
}

// ---------------- retroceso (Huawei/VRP no borra con DEL: pide Ctrl+H) ----------------
export type BackMode = "auto" | "del" | "bs";
let backMode: BackMode = "auto";
export function setBackMode(m: BackMode) { backMode = m; }
/** Lo que envía la tecla Retroceso. En «auto», un prompt tipo <equipo> o [equipo] (Huawei) usa Ctrl+H y el resto DEL. */
export function backspaceSeq(): string {
  if (backMode === "bs") return "\x08";
  if (backMode === "del") return "\x7f";
  const cur = vt.lines[vt.cy] ?? [];
  const head = cur.slice(0, 70).map((c) => c.c).join("");
  return /^(<[^<>\s]{1,60}>|\[[^\[\]\s]{1,60}\])/.test(head) ? "\x08" : "\x7f";
}

// ---------------- mantener la sesión abierta (los equipos cierran la sesión por inactividad) ----------------
let keepOn = true;
let keepTimer: number | null = null;
export function setKeepAlive(on: boolean) { keepOn = on; }
const KEEP_AFTER = 40_000;   // sin teclear ni recibir nada en 40 s
function startKeepAlive() {
  stopKeepAlive();
  keepTimer = window.setInterval(() => {
    if (!keepOn || !session?.connected) return;
    const now = Date.now();
    if (now - lastIn < KEEP_AFTER || now - lastOut < 4000) return;     // en uso, o un comando está sacando datos
    const last = (vt.lines[vt.cy] ?? []).map((c) => c.c).join("");
    if (/more/i.test(last)) return;                                    // paginación: un espacio avanzaría la hoja
    lastIn = now;
    // un espacio y su borrado: el equipo lo cuenta como actividad (reinicia el temporizador) y la pantalla no cambia
    void session.raw(" " + backspaceSeq());
  }, 10_000);
}
function stopKeepAlive() { if (keepTimer != null) { window.clearInterval(keepTimer); keepTimer = null; } }

export interface ConnectOpts {
  mode: "puente" | "navegador";
  via: "serial" | "ssh";
  code: string; puerto: string; baud: number;
  host: string; port: number; user: string; pass: string;
}

export async function reconnectTerminal(): Promise<void> { if (lastOpts && !session) await connectTerminal(lastOpts); }

export async function connectTerminal(o: ConnectOpts): Promise<void> {
  if (session) return;
  lastOpts = o;
  const ssh = o.via === "ssh" && o.mode === "puente";
  const label = ssh ? `SSH ${o.user}@${o.host}` : o.mode === "navegador" ? "Consola (navegador)" : `Consola ${o.puerto}`;
  bump({ status: ssh ? "Conectando por SSH desde tu laptop…" : "Abriendo la consola…", label });
  feed(`Conectando: ${label}…\r\n`);
  try {
    let sess: ConsoleSession;
    if (o.mode === "navegador") {
      const w = new SerialSession();
      w.onData = feed;
      await w.connect(o.baud);
      sess = w;
    } else {
      const ps = new PuenteSession(o.code.trim());
      ps.onData = feed;
      await ps.connect(o.via === "ssh"
        ? { kind: "ssh", host: o.host, port: Number(o.port) || 22, user: o.user, password: o.pass }
        : { kind: "serial", port: o.puerto, baud: o.baud });
      sess = ps;
    }
    sess.onClose = (why) => { session = null; stopKeepAlive(); watchFinish(false); mark("Conexión cerrada: " + why); bump({ connected: false, status: why }); idleHook?.(); };
    session = sess;
    lastIn = lastOut = Date.now();
    startKeepAlive();
    mark(`Conectado: ${label}`);
    bump({ connected: true, status: "Conectado. Preparando el equipo…" });
    for (const c of setupCmds) await sess.run(c, { maxMs: 8000 });
    bump({ status: "Listo." });
  } catch (e) {
    session?.close().catch(() => {});
    session = null;
    bump({ connected: false, status: `No se pudo conectar: ${(e as Error).message || e}` });
    feed(`\r\n\x1b[31mNo se pudo conectar: ${(e as Error).message || e}\x1b[0m\r\n`);
  }
}

export async function disconnectTerminal(): Promise<void> {
  mark("Desconectado");
  const s = session;
  session = null;
  stopKeepAlive();
  await s?.close();
  bump({ connected: false, status: "Desconectado." });
  idleHook?.();
}

export function useTerminal() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

// ---------------- ventanas flotantes (Terminal / Saturación) ----------------
let dock = { terminal: false, sat: false, satRunning: false, manualSat: false, front: "terminal" as "terminal" | "sat" };
const dockListeners = new Set<() => void>();
export function setDock(p: Partial<typeof dock>) { dock = { ...dock, ...p }; dockListeners.forEach((l) => l()); }
export function openWindow(w: "terminal" | "sat") { setDock({ [w]: true, front: w } as Partial<typeof dock>); }
export function useDock() {
  return useSyncExternalStore((l) => { dockListeners.add(l); return () => dockListeners.delete(l); }, () => dock, () => dock);
}

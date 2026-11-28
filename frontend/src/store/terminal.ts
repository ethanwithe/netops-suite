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

/** Una pestaña = una conexión (consola o SSH) con su propia pantalla y registro. */
interface Tab {
  id: string; name: string; vt: Vt; session: ConsoleSession | null; fullLog: string;
  connected: boolean; status: string; label: string; opts: ConnectOpts | null;
  typed: string; lastIn: number; lastOut: number; interrupts: number; unread: boolean; watching: boolean; seen: boolean;
}
const newTab = (name = "Nueva"): Tab => ({
  id: Math.random().toString(36).slice(2, 9), name, vt: new Vt(), session: null, fullLog: "", connected: false, status: "", label: "", opts: null,
  typed: "", lastIn: 0, lastOut: 0, interrupts: 0, unread: false, watching: false, seen: false,
});
const tabs: Tab[] = [newTab()];
let cur: Tab = tabs[0];
/** Pantalla de la pestaña activa (cambia al elegir otra pestaña). */
export let vt: Vt = cur.vt;
let setupCmds: string[] = [];
let state = snapshot(0);
const listeners = new Set<() => void>();
let timer: number | null = null;

function snapshot(rev: number) {
  return {
    rev, connected: cur.connected, status: cur.status, label: cur.label, active: cur.id,
    tabs: tabs.map((t) => ({ id: t.id, name: t.name, connected: t.connected, unread: t.unread, watching: t.watching })),
  };
}
const notify = () => listeners.forEach((l) => l());
const bump = () => { state = snapshot(state.rev + 1); notify(); };
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

function feedTab(t: Tab, chunk: string) {
  t.lastOut = Date.now();
  t.seen = true;
  t.vt.write(chunk);
  t.fullLog = plain(t.fullLog, chunk).slice(-1_500_000);
  if (t !== cur) t.unread = true;
  schedule();
}
/** Texto que llega del equipo (o notas propias) en la pestaña activa. */
export function feed(chunk: string) { feedTab(cur, chunk); }
const markTab = (t: Tab, m: string) => feedTab(t, `\r\n\x1b[90m===== ${new Date().toLocaleString("es-PE")} · ${m} =====\x1b[0m\r\n`);

export const getSession = () => cur.session;
/** Vuelve a dibujar la pantalla (p. ej. al cambiar las palabras resaltadas). */
export const redraw = () => bump();
export const termLog = () => cur.fullLog;
export function termClear() { cur.vt.clear(); bump(); }
export function termForget() { cur.fullLog = ""; cur.vt.clear(); bump(); }
let idleHook: (() => void) | null = null;
export function setIdleHook(f: () => void) { idleHook = f; }
export function setSetupCommands(c: string[]) { setupCmds = c; }

// ---------------- pestañas ----------------
export const activeTabId = () => cur.id;
export function selectTab(id: string) {
  const t = tabs.find((x) => x.id === id);
  if (!t || t === cur) return;
  t.vt.cols = cur.vt.cols;
  cur = t;
  t.unread = false;
  vt = t.vt;
  bump();
}
export function addTab(): string {
  const t = newTab();
  tabs.push(t);
  selectTab(t.id);
  return t.id;
}
export function renameTab(id: string, name: string) {
  const t = tabs.find((x) => x.id === id);
  if (t && name.trim()) { t.name = name.trim().slice(0, 30); bump(); }
}
export async function closeTab(id: string) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  const s = t.session;
  t.session = null;
  t.connected = false;
  await s?.close().catch(() => undefined);
  if (tabs.length === 1) {                       // la última no se quita: queda vacía
    t.vt.clear(); t.fullLog = ""; t.name = "Nueva"; t.label = ""; t.status = ""; t.opts = null;
    bump();
    return;
  }
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  if (cur === t) { cur = tabs[Math.max(0, i - 1)]; cur.unread = false; vt = cur.vt; }
  bump();
}

// ---------------- historial y envío ----------------
/** Cuántas veces se interrumpió (Ctrl+C, Ctrl+Shift+6, Ctrl+Z) en esa pestaña: los envíos de varios comandos se detienen al instante. */
export const interruptCount = (id: string = cur.id) => (tabs.find((x) => x.id === id)?.interrupts ?? 0);
export const tabConnected = (id: string) => !!tabs.find((x) => x.id === id)?.session?.connected;
// historial de comandos escritos o enviados (se guarda en este equipo)
const HK = "netops:terminal.historial";
let history: string[] = (() => { try { const v = JSON.parse(localStorage.getItem(HK) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-300) : []; } catch { return []; } })();
export const getHistory = () => history;
export function clearHistory() { history = []; try { localStorage.removeItem(HK); } catch { /* sin almacenamiento */ } bump(); }
function remember(cmd: string) {
  const c = cmd.trim();
  if (!c || c.length > 400) return;
  history = [...history.filter((x) => x !== c), c].slice(-300);
  try { localStorage.setItem(HK, JSON.stringify(history)); } catch { /* sin almacenamiento */ }
  schedule();
}
function track(t: Tab, s: string) {
  for (const ch of s.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, "\u0001")) {
    if (ch === "\r" || ch === "\n") { remember(t.typed); t.typed = ""; }
    else if (ch === "\x7f" || ch === "\x08") t.typed = t.typed.slice(0, -1);
    else if (ch === "\x03" || ch === "\x1a" || ch === "\x15" || ch === "\x1b" || ch === "\u0001") t.typed = "";   // lo que sigue ya no se puede saber con certeza
    else if (ch >= " ") t.typed += ch;
  }
}
function sendTo(t: Tab, s: string) {
  t.lastIn = Date.now();
  if (/[\x03\x1a\x1e]/.test(s)) t.interrupts++;
  track(t, s);
  void t.session?.raw(s);
}
export function sendRaw(s: string) { sendTo(cur, s); }
/** Envía a una pestaña concreta (los envíos de varios comandos no se cambian de equipo si cambias de pestaña). */
export function sendRawTab(id: string, s: string) { const t = tabs.find((x) => x.id === id); if (t) sendTo(t, s); }

/** Anota una línea gris con la hora en la pantalla y el registro (útil como evidencia). */
export function termNote(t = "Marca") { markTab(cur, t); }

// ---------------- aviso al terminar un comando largo ----------------
export const isWatching = () => cur.watching;
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
/** Una sola vez: cuando el equipo de la pestaña deje de sacar datos y vuelva el prompt, suena y avisa (aunque estés en otra pestaña). */
export function watchFinish(on: boolean) {
  cur.watching = on;
  cur.seen = false;
  if (on) { try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* sin permiso */ } }
  bump();
}
const lastLine = (t: Tab) => (t.vt.lines[t.vt.cy] ?? []).map((c) => c.c).join("");

// ---------------- retroceso (Huawei/VRP no borra con DEL: pide Ctrl+H) ----------------
export type BackMode = "auto" | "del" | "bs";
let backMode: BackMode = "auto";
export function setBackMode(m: BackMode) { backMode = m; }
function backFor(t: Tab): string {
  if (backMode === "bs") return "\x08";
  if (backMode === "del") return "\x7f";
  const head = (t.vt.lines[t.vt.cy] ?? []).slice(0, 70).map((c) => c.c).join("");
  return /^(<[^<>\s]{1,60}>|\[[^\[\]\s]{1,60}\])/.test(head) ? "\x08" : "\x7f";
}
/** Lo que envía la tecla Retroceso. En «auto», un prompt tipo <equipo> o [equipo] (Huawei) usa Ctrl+H y el resto DEL. */
export const backspaceSeq = () => backFor(cur);

// ---------------- mantener la sesión abierta (los equipos cierran la sesión por inactividad) ----------------
let keepOn = true;
export function setKeepAlive(on: boolean) { keepOn = on; }
const KEEP_AFTER = 40_000;   // sin teclear ni recibir nada en 40 s
window.setInterval(() => {
  const now = Date.now();
  for (const t of tabs) {
    const s = t.session;
    if (!s?.connected) continue;
    // aviso al terminar
    if (t.watching && t.seen && now - t.lastOut > 3000 && /[#>\]$]\s*$/.test(lastLine(t))) {
      t.watching = false;
      beep();
      toast(`Terminó el comando en «${t.name}».`, "ok", undefined, 6000);
      try { if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("NetOps Suite", { body: `Terminó el comando en ${t.name}.` }); } catch { /* sin permiso */ }
      bump();
    }
    // sesión abierta
    if (!keepOn || now - t.lastIn < KEEP_AFTER || now - t.lastOut < 4000) continue;     // en uso, o un comando está sacando datos
    if (/more/i.test(lastLine(t))) continue;                                           // paginación: un espacio avanzaría la hoja
    t.lastIn = now;
    // un espacio y su borrado: el equipo lo cuenta como actividad (reinicia el temporizador) y la pantalla no cambia
    void s.raw(" " + backFor(t));
  }
}, 5_000);

export interface ConnectOpts {
  mode: "puente" | "navegador";
  via: "serial" | "ssh";
  code: string; puerto: string; baud: number;
  host: string; port: number; user: string; pass: string;
}

export const getLastOpts = () => cur.opts;
export async function reconnectTerminal(): Promise<void> { if (cur.opts && !cur.session) await connectTerminal(cur.opts); }

/** Conecta la pestaña activa (si ya está conectada, abre una pestaña nueva para la conexión). */
export async function connectTerminal(o: ConnectOpts): Promise<void> {
  if (cur.session) addTab();
  const t = cur;
  t.opts = o;
  const ssh = o.via === "ssh" && o.mode === "puente";
  const label = ssh ? `SSH ${o.user}@${o.host}` : o.mode === "navegador" ? "Consola (navegador)" : `Consola ${o.puerto}`;
  t.label = label;
  t.status = ssh ? "Conectando por SSH desde tu laptop…" : "Abriendo la consola…";
  if (t.name === "Nueva") t.name = ssh ? o.host : o.mode === "navegador" ? "Consola" : o.puerto || "Consola";
  bump();
  feedTab(t, `Conectando: ${label}…\r\n`);
  try {
    let sess: ConsoleSession;
    if (o.mode === "navegador") {
      const w = new SerialSession();
      w.onData = (c) => feedTab(t, c);
      await w.connect(o.baud);
      sess = w;
    } else {
      const ps = new PuenteSession(o.code.trim());
      ps.onData = (c) => feedTab(t, c);
      await ps.connect(o.via === "ssh"
        ? { kind: "ssh", host: o.host, port: Number(o.port) || 22, user: o.user, password: o.pass }
        : { kind: "serial", port: o.puerto, baud: o.baud });
      sess = ps;
    }
    sess.onClose = (why) => { t.session = null; t.connected = false; t.watching = false; t.status = why; markTab(t, "Conexión cerrada: " + why); bump(); if (t === cur) idleHook?.(); };
    t.session = sess;
    t.lastIn = t.lastOut = Date.now();
    markTab(t, `Conectado: ${label}`);
    t.connected = true;
    t.status = "Conectado. Preparando el equipo…";
    bump();
    for (const c of setupCmds) await sess.run(c, { maxMs: 8000 });
    t.status = "Listo.";
    bump();
  } catch (e) {
    t.session?.close().catch(() => {});
    t.session = null;
    t.connected = false;
    t.status = `No se pudo conectar: ${(e as Error).message || e}`;
    bump();
    feedTab(t, `\r\n\x1b[31mNo se pudo conectar: ${(e as Error).message || e}\x1b[0m\r\n`);
  }
}

export async function disconnectTerminal(): Promise<void> {
  const t = cur;
  markTab(t, "Desconectado");
  const s = t.session;
  t.session = null;
  t.connected = false;
  t.watching = false;
  await s?.close();
  t.status = "Desconectado.";
  bump();
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

/**
 * Terminal global: la conexión (consola o SSH) vive aquí, no en una página, para que la ventana flotante
 * «Terminal» (barra superior) y el CheckList usen la misma sesión.
 */
import { useSyncExternalStore } from "react";
import { PuenteSession } from "../utils/puente";
import { SerialSession } from "../utils/webSerial";
import type { ConsoleSession } from "../utils/webSerial";
import { Vt } from "../utils/vt";

export const vt = new Vt();
let session: ConsoleSession | null = null;
let setupCmds: string[] = [];
let fullLog = "";
let state = { rev: 0, connected: false, status: "", label: "" };
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

/** Texto que llega del equipo (o notas propias). */
export function feed(chunk: string) {
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
export function sendRaw(s: string) { void session?.raw(s); }

export interface ConnectOpts {
  mode: "puente" | "navegador";
  via: "serial" | "ssh";
  code: string; puerto: string; baud: number;
  host: string; port: number; user: string; pass: string;
}

export async function connectTerminal(o: ConnectOpts): Promise<void> {
  if (session) return;
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
    sess.onClose = (why) => { session = null; mark("Conexión cerrada: " + why); bump({ connected: false, status: why }); idleHook?.(); };
    session = sess;
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

/**
 * Ventanas guardadas por SOT: todo lo que hay en pantalla en una ventana (reporte fotográfico,
 * CheckList, Poder Judicial...) se guarda solo en el servidor asociado a la SOT, para volver a
 * abrirlo, editarlo y seguir. Las fotos y los PDF/ZIP generados también quedan guardados.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { ClientInput, ClientRecord } from "./clients";
import { syncClient, toISODate } from "./clients";
import { getAutosave, useAutosave } from "./autosave";
import { expandDatos } from "./clientLink";
import { askChoice } from "./dialog";
import { allDrafts, delDraft, getDraft, putDraft } from "./localDraft";
import { localWorkspace, queueWorkspace } from "../sync/engine";
import type { Draft } from "./localDraft";

export interface WorkspaceInfo { sot: string; key: string; label: string; route: string; updated_at: string }
interface Saved extends WorkspaceInfo { state: unknown }
/** Lo guardado en el servidor + (si existe) la copia temporal de este equipo, para que elijas sin perder nada. */
export interface Conflict extends Saved { temp?: unknown; tempAt?: number; shrink?: boolean }

const normSot = (s: string) => (s || "").replace(/^\s*SOT\s*[-_:.#]*\s*/i, "").trim();

export const listWorkspaces = (sot: string) =>
  api.get<WorkspaceInfo[]>(`/clients/workspaces/${encodeURIComponent(normSot(sot))}`).then((r) => r.data);
export const deleteWorkspace = (sot: string, key: string) =>
  api.delete("/clients/workspace", { params: { sot: normSot(sot), key } });

// «Abrir» desde Datos de cliente: la ventana destino carga sola lo guardado al abrirse.
let pendingLoad: { sot: string; key: string } | null = null;
export function requestOpen(sot: string, key: string): void { pendingLoad = { sot: normSot(sot), key }; }
function takePending(sot: string, key: string): boolean {
  if (pendingLoad && pendingLoad.sot === sot && pendingLoad.key === key) { pendingLoad = null; return true; }
  return false;
}

// Ventanas con cambios sin guardar: al salir a otra pantalla se pregunta (ver NavGuard en Layout).
interface Guard { dirty: () => boolean; save: () => Promise<boolean>; label: () => string }
const guards = new Map<symbol, Guard>();
export function pendingGuards(): Guard[] { return [...guards.values()].filter((g) => g.dirty()); }

export interface WsOptions {
  key: string;
  label: string;
  sot: string;
  nombre?: string;
  fecha?: string;
  /** Lo que se guarda (solo datos, sin estado temporal como «generando…»). */
  state: unknown;
  /** Pone lo guardado en pantalla. */
  apply: (saved: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Si la SOT ya existe como cliente y no hay nada guardado en esta ventana, trae lo que esta ventana necesita. */
  fill?: (client: ClientRecord) => void;
  enabled?: boolean;
  /** Deja la ventana vacía (lista para otro cliente). */
  clear?: () => void;
  /** Datos de la SOT que van a «Datos de cliente» al guardar a mano. */
  clientData?: ClientInput;
}

export interface VersionInfo { id: string; saved_at: string; saved_by: string; label: string }

export interface WsApi {
  /** Hay datos guardados distintos a los de pantalla: se espera tu decisión antes de guardar. */
  conflict: Conflict | null;
  load: () => void;
  keepMine: () => void;
  /** Trae la copia temporal de este equipo (lo que no llegó a subirse). */
  loadTemp: () => void;
  /** Sin conexión con el servidor: todo queda guardado temporal en este equipo. */
  offline: boolean;
  status: { kind: "saving" | "saved" | "error" | "local"; at: string } | null;
  hasSot: boolean;
  /** Copias anteriores de esta ventana (para recuperar lo que se borró o se pisó por error). */
  versions: () => Promise<VersionInfo[]>;
  recover: (id: string) => Promise<void>;
  autosave: boolean;
  /** Hay cambios en pantalla que todavía no están guardados. */
  dirty: boolean;
  /** Guardar ahora (pide confirmación). */
  save: () => Promise<void>;
  /** Guardar sin preguntar; true si quedó guardado. */
  saveQuiet: () => Promise<boolean>;
  /** Limpiar la ventana para otro cliente (pregunta si guardar antes). */
  clear: () => Promise<void>;
  /** Antes de reemplazar lo de pantalla (elegir otro cliente): pregunta si guardar. true = continuar. */
  confirmReplace: () => Promise<boolean>;
  /** Marca que, al fijarse esa SOT, se cargue solo lo que ya estaba guardado. */
  open: (sot: string) => void;
}

// Subida en segundo plano de las copias temporales (sin Internet, pestaña cerrada, error del servidor...).
const active = new Map<symbol, string>();
let flushing = false;
let flushHooked = false;
async function flushPending(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  flushing = true;
  try {
    const busy = new Set(active.values());
    for (const d of await allDrafts()) {
      if (!d.queued || busy.has(d.id)) continue;
      try {
        await api.put("/clients/workspace", { sot: d.sot, key: d.key, label: d.label, route: d.route, state: d.state, nombre: d.nombre, fecha: d.fecha });
        const cur = await getDraft(d.sot, d.key);
        if (cur && cur.at === d.at) await delDraft(d.sot, d.key); // ya está todo en el servidor: se libera lo temporal
      } catch (e) {
        const st = (e as { response?: { status?: number } })?.response?.status;
        if (st === 409 || (st && st >= 400 && st < 500 && st !== 408 && st !== 429)) await putDraft({ ...d, queued: false }); // requiere tu decisión al abrir esa ventana
        else break; // sin conexión: se reintenta luego
      }
    }
  } finally { flushing = false; }
}
function hookFlush(): void {
  if (flushHooked || typeof window === "undefined") return;
  flushHooked = true;
  window.addEventListener("online", () => { void flushPending(); });
  window.setInterval(() => { void flushPending(); }, 30000);
  void flushPending();
}

function queueLocal(o: WsOptions, sot: string, route: string, state: unknown): Promise<void> {
  const cd = o.clientData;
  return queueWorkspace({ sot, key: o.key, label: o.label, route, state, nombre: o.nombre || cd?.nombre, fecha: o.fecha || cd?.fecha, datos: cd?.datos ? expandDatos(cd.datos) : undefined });
}

export function useWorkspace(o: WsOptions): WsApi {
  const { pathname } = useLocation();
  const sot = normSot(o.sot);
  const enabled = o.enabled !== false;
  const json = useMemo(() => JSON.stringify(o.state ?? {}), [o.state]);
  const ref = useRef(o); ref.current = o;
  const jsonRef = useRef(json); jsonRef.current = json;
  const [mode, setMode] = useState<"idle" | "checking" | "free" | "blocked" | "offline">("idle");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [status, setStatus] = useState<WsApi["status"]>(null);
  const [tick, setTick] = useState(0);
  const last = useRef("");
  const [lastS, setLastS] = useState("");
  const forceNext = useRef(false);
  const mark = (j: string) => { last.current = j; setLastS(j); };
  const auto = useAutosave();
  const modeRef = useRef(mode); modeRef.current = mode;
  const sotRef = useRef(sot); sotRef.current = sot;
  const dirty = enabled && !!sot && mode === "free" && json !== lastS;
  const did = `${sot}|${o.key}`;

  useEffect(() => { hookFlush(); }, []);
  // Este equipo es quien sube esta ventana mientras está abierta (el segundo plano no la toca).
  const me = useRef(Symbol("ws-active"));
  useEffect(() => {
    if (!sot || !enabled) return;
    active.set(me.current, did);
    return () => { active.delete(me.current); };
  }, [did, sot, enabled]);

  // Sin conexión con el servidor: se reintenta solo al volver Internet.
  useEffect(() => {
    if (mode !== "offline") return;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("online", bump);
    const t = window.setInterval(bump, 15000);
    return () => { window.removeEventListener("online", bump); window.clearInterval(t); };
  }, [mode]);

  // 1) Al fijar la SOT: ¿hay algo guardado (o una copia temporal) para ella en esta ventana?
  useEffect(() => {
    if (!enabled || !sot) { setConflict(null); setMode("idle"); return; }
    if (modeRef.current !== "offline") { setConflict(null); setMode("checking"); }
    let dead = false;
    const t = window.setTimeout(async () => {
      const draft = await getDraft(sot, ref.current.key);
      const draftJson = draft ? JSON.stringify(draft.state ?? {}) : "";
      try {
        const { data } = await api.get<Saved>("/clients/workspace", { params: { sot, key: ref.current.key } });
        if (dead) return;
        const serverJson = JSON.stringify(data.state ?? {});
        if (draft && draftJson !== serverJson && draftJson !== jsonRef.current) {
          // Quedó algo sin subir de otra vez (cerraste, sin Internet...): tú decides con qué seguir.
          setConflict({ ...data, temp: draft.state, tempAt: draft.at }); setMode("blocked"); return;
        }
        if (serverJson === jsonRef.current) { mark(jsonRef.current); void delDraft(sot, ref.current.key); setMode("free"); }
        else if (takePending(sot, ref.current.key)) { ref.current.apply(data.state); mark(serverJson); void delDraft(sot, ref.current.key); setMode("free"); }
        else { setConflict(data); setMode("blocked"); }
      } catch (e) {
        if (dead) return;
        const st = (e as { response?: { status?: number } })?.response?.status;
        if (st === 404) {
          if (draft && draftJson !== jsonRef.current && draftJson !== "{}") {
            setConflict({ sot, key: ref.current.key, label: ref.current.label, route: "", updated_at: "", state: {}, temp: draft.state, tempAt: draft.at });
            setMode("blocked"); return;
          }
          setMode("free");
          // Sin nada guardado: se trae de «Datos de cliente» lo que esta ventana necesita.
          if (ref.current.fill) {
            try {
              const { data: c } = await api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(sot)}`);
              if (!dead) ref.current.fill(c);
            } catch { /* no es cliente todavía */ }
          }
        } else {
          // Sin conexión: se abre lo que haya guardado en ESTE equipo (pendiente de subir o descargado antes).
          const loc = await localWorkspace(sot, ref.current.key).catch(() => null);
          if (dead) return;
          if (loc && JSON.stringify(loc.state ?? {}) !== jsonRef.current) {
            setConflict({ sot, key: ref.current.key, label: loc.label || ref.current.label, route: loc.route, updated_at: "", state: loc.state, ...(loc.pending ? { tempAt: Date.now() } : {}) });
            setMode("blocked");
          } else setMode("offline"); // todo queda guardado en este equipo y se sube solo al volver Internet
        }
      }
    }, modeRef.current === "offline" ? 0 : 900);
    return () => { dead = true; window.clearTimeout(t); };
  }, [sot, enabled, o.key, tick]);

  // Guardar ahora (a mano, al salir o desde el guardado automático)
  const doSave = async (): Promise<boolean> => {
    const cur = ref.current;
    const sotNow = sotRef.current;
    if (!sotNow) return false;
    const snap = jsonRef.current;
    setStatus({ kind: "saving", at: "" });
    const toLocal = async (): Promise<boolean> => {
      try {
        await queueLocal(cur, sotNow, pathname, JSON.parse(snap));   // cola persistente: se sube sola al volver Internet
        forceNext.current = false;
        mark(snap);
        void delDraft(sotNow, cur.key);
        setStatus({ kind: "local", at: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) });
        return true;
      } catch { setStatus({ kind: "error", at: "" }); return false; }
    };
    if (modeRef.current === "offline" || navigator.onLine === false) return toLocal();
    // Primero queda a salvo en este equipo; solo se libera cuando el servidor confirma.
    await putDraft({ id: `${sotNow}|${cur.key}`, sot: sotNow, key: cur.key, label: cur.label, route: pathname, nombre: cur.nombre ?? "", fecha: cur.fecha ?? "", state: JSON.parse(snap), at: Date.now(), queued: false });
    try {
      await api.put("/clients/workspace", {
        sot: sotNow, key: cur.key, label: cur.label, route: pathname, state: JSON.parse(snap),
        nombre: cur.nombre ?? "", fecha: cur.fecha ?? "", force: forceNext.current,
      });
      forceNext.current = false;
      mark(snap);
      if (jsonRef.current === snap) void delDraft(sotNow, cur.key);
      setStatus({ kind: "saved", at: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) });
      return true;
    } catch (e) {
      const r = (e as { response?: { status?: number; data?: { detail?: string } } })?.response;
      if (r?.status === 409 && r.data?.detail === "shrink") {
        // Lo que hay en pantalla tiene mucho menos que lo guardado: no se pisa sin preguntar.
        try {
          const { data } = await api.get<Saved>("/clients/workspace", { params: { sot: sotNow, key: cur.key } });
          setConflict({ ...data, temp: JSON.parse(snap), tempAt: Date.now(), shrink: true });
          setMode("blocked");
        } catch { /* se reintenta */ }
        setStatus({ kind: "error", at: "" });
        return false;
      }
      if (!r) { setMode((m) => (m === "free" ? "offline" : m)); return toLocal(); } // sin conexión: queda en este equipo y se sube sola
      setStatus({ kind: "error", at: "" });
      return false;
    }
  };
  const doSaveRef = useRef(doSave); doSaveRef.current = doSave;

  // 2) Guardado automático (se puede apagar con el interruptor)
  useEffect(() => {
    if (!auto || !enabled || !sot || (mode !== "free" && mode !== "offline") || json === last.current) return;
    const t = window.setTimeout(() => { void doSaveRef.current(); }, 1500);
    return () => window.clearTimeout(t);
  }, [json, lastS, mode, sot, enabled, pathname, auto]);

  // 2b) Copia temporal en este equipo mientras haya cambios sin subir (también sin Internet).
  useEffect(() => {
    if (!enabled || !sot || (mode !== "free" && mode !== "offline") || json === last.current) return;
    const t = window.setTimeout(() => {
      const cur = ref.current;
      void putDraft({ id: `${sot}|${cur.key}`, sot, key: cur.key, label: cur.label, route: pathname, nombre: cur.nombre ?? "", fecha: cur.fecha ?? "", state: JSON.parse(jsonRef.current), at: Date.now(), queued: false });
    }, 400);
    return () => window.clearTimeout(t);
  }, [json, lastS, mode, sot, enabled, pathname]);

  // Al volver la conexión (modo offline → se vuelve a comprobar) o si la ventana quedó en espera, sube lo pendiente.
  useEffect(() => {
    if (mode === "free" && status?.kind === "error" && json !== last.current && auto) {
      const t = window.setTimeout(() => { void doSaveRef.current(); }, 10000);
      return () => window.clearTimeout(t);
    }
  }, [mode, status, json, auto]);

  // 3) Al salir de esta ventana: con guardado automático no se pierde lo de los últimos segundos; sin él, NavGuard pregunta.
  const id = useRef(Symbol("ws"));
  useEffect(() => {
    const gid = id.current;
    const p0 = window.location.pathname;
    guards.set(gid, {
      dirty: () => !getAutosave() && ref.current.enabled !== false && !!sotRef.current && modeRef.current === "free" && jsonRef.current !== last.current,
      save: async () => {
        const ok = await doSaveRef.current();
        const cd = ref.current.clientData;
        if (ok && cd?.sot?.trim()) { try { await syncClient({ ...cd, datos: expandDatos(cd.datos), fecha: toISODate(cd.fecha ?? "") }); } catch { /* ignorar */ } }
        return ok;
      },
      label: () => ref.current.label,
    });
    return () => {
      guards.delete(gid);
      const m = modeRef.current;
      if (ref.current.enabled !== false && sotRef.current && (m === "free" || m === "offline") && jsonRef.current !== last.current) {
        const cur = ref.current, s = sotRef.current, snap = jsonRef.current;
        const d: Draft = { id: `${s}|${cur.key}`, sot: s, key: cur.key, label: cur.label, route: pathname, nombre: cur.nombre ?? "", fecha: cur.fecha ?? "", state: JSON.parse(snap), at: Date.now(), queued: false };
        if (m === "offline") void queueLocal(cur, s, pathname, d.state);
        else void putDraft(d).then(() => {
          if (!getAutosave()) return;
          return api.put("/clients/workspace", { sot: s, key: cur.key, label: cur.label, route: pathname, state: d.state, nombre: d.nombre, fecha: d.fecha })
            .then(() => delDraft(s, cur.key)).catch(() => queueLocal(cur, s, pathname, d.state)); // si falla, queda en la cola local y se sube sola
        });
      }
      // Al volver a esta ventana se muestra limpia, lista para otro cliente (o para elegir el mismo otra vez); lo guardado sigue en «Datos de cliente».
      if (window.location.pathname !== p0) { try { ref.current.clear?.(); } catch { /* ignorar */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveQuiet = async () => {
    const ok = await doSaveRef.current();
    const cd = ref.current.clientData;
    if (ok && cd?.sot?.trim()) { try { await syncClient({ ...cd, datos: expandDatos(cd.datos), fecha: toISODate(cd.fecha ?? "") }); } catch { /* ignorar */ } }
    return ok;
  };
  const askSave = async (title: string, msg: string, yes: string, no: string): Promise<boolean | null> => {
    const r = await askChoice(title, msg, [
      { id: "save", label: yes, kind: "primary" },
      { id: "skip", label: no, kind: "danger" },
      { id: "cancel", label: "Cancelar" },
    ]);
    if (r === "save") return (await saveQuiet()) ? true : (confirm("No se pudo guardar en el servidor (sin conexión). Queda guardado temporal en este equipo y se sube solo al volver Internet. ¿Continuar?") ? false : null);
    if (r === "skip") return false;
    return null;
  };
  const applyState = (st: unknown) => { ref.current.apply(st); };

  return {
    conflict,
    load: () => {
      if (!conflict) return;
      applyState(conflict.state); mark(JSON.stringify(conflict.state ?? {}));
      void delDraft(sot, ref.current.key);
      setConflict(null); setMode("free");
    },
    loadTemp: () => {
      if (!conflict || conflict.temp === undefined) return;
      applyState(conflict.temp);
      // Queda pendiente de subir: se guarda encima de lo del servidor (que además queda en copias anteriores).
      forceNext.current = true; mark("");
      setConflict(null); setMode("free");
    },
    keepMine: () => {
      forceNext.current = true; mark("");
      setConflict(null); setMode("free");
    },
    offline: mode === "offline",
    status,
    hasSot: !!sot,
    versions: () => api.get<VersionInfo[]>("/clients/workspace-versions", { params: { sot, key: ref.current.key } }).then((r) => r.data),
    recover: async (vid: string) => {
      const { data } = await api.post<Saved>(`/clients/workspace-versions/${vid}/restore`);
      applyState(data.state);
      mark(JSON.stringify(data.state ?? {}));
      void delDraft(sot, ref.current.key);
      setConflict(null);
      setMode("free");
    },
    autosave: auto,
    dirty,
    saveQuiet,
    save: async () => {
      if (!sot) { alert("Escribe primero la SOT para poder guardar."); return; }
      const r = await askChoice("¿Guardar los datos del cliente?", `Se guarda todo lo de esta ventana (datos, textos y fotos) para la SOT ${sot}.`, [
        { id: "save", label: "Sí, guardar", kind: "primary" }, { id: "cancel", label: "Cancelar" },
      ]);
      if (r === "save") await saveQuiet();
    },
    clear: async () => {
      if (!ref.current.clear) return;
      if (dirty) {
        const ok = await askSave("Hay cambios sin guardar", `Los cambios de la SOT ${sot} no están guardados. ¿Guardar antes de limpiar?`, "Guardar y limpiar", "Limpiar sin guardar");
        if (ok === null) return;
      } else {
        const r = await askChoice("¿Seguro que quieres limpiar?", sot
          ? `Se vacía la pantalla para empezar con otro cliente. Lo que ya está guardado de la SOT ${sot} no se borra.`
          : "Se vacía la pantalla para empezar con otro cliente. Lo que no esté guardado se pierde.", [
          { id: "ok", label: "Sí, limpiar", kind: "danger" }, { id: "cancel", label: "Cancelar" },
        ]);
        if (r !== "ok") return;
      }
      // Limpiar a propósito: la copia temporal de esta SOT ya no se necesita si quedó todo guardado.
      if (!dirty) void delDraft(sot, ref.current.key);
      ref.current.clear();
      setConflict(null);
    },
    confirmReplace: async () => {
      if (!dirty) return true;
      const ok = await askSave("Vas a cambiar de cliente", `Hay cambios sin guardar de la SOT ${sot}. ¿Guardarlos antes de cambiar?`, "Guardar y cambiar", "Cambiar sin guardar");
      return ok !== null;
    },
    open: (s: string) => requestOpen(s, ref.current.key),
  };
}

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

export interface WorkspaceInfo { sot: string; key: string; label: string; route: string; updated_at: string }
interface Saved extends WorkspaceInfo { state: unknown }

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
  conflict: Saved | null;
  load: () => void;
  keepMine: () => void;
  status: { kind: "saving" | "saved" | "error"; at: string } | null;
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

export function useWorkspace(o: WsOptions): WsApi {
  const { pathname } = useLocation();
  const sot = normSot(o.sot);
  const enabled = o.enabled !== false;
  const json = useMemo(() => JSON.stringify(o.state ?? {}), [o.state]);
  const ref = useRef(o); ref.current = o;
  const jsonRef = useRef(json); jsonRef.current = json;
  const [mode, setMode] = useState<"idle" | "checking" | "free" | "blocked">("idle");
  const [conflict, setConflict] = useState<Saved | null>(null);
  const [status, setStatus] = useState<WsApi["status"]>(null);
  const last = useRef("");
  const [lastS, setLastS] = useState("");
  const mark = (j: string) => { last.current = j; setLastS(j); };
  const auto = useAutosave();
  const modeRef = useRef(mode); modeRef.current = mode;
  const sotRef = useRef(sot); sotRef.current = sot;
  const dirty = enabled && !!sot && mode === "free" && json !== lastS;

  // 1) Al fijar la SOT: ¿hay algo guardado para ella en esta ventana?
  useEffect(() => {
    setConflict(null);
    if (!enabled || !sot) { setMode("idle"); return; }
    setMode("checking");
    let dead = false;
    const t = window.setTimeout(async () => {
      try {
        const { data } = await api.get<Saved>("/clients/workspace", { params: { sot, key: ref.current.key } });
        if (dead) return;
        const same = JSON.stringify(data.state ?? {}) === jsonRef.current;
        if (same) { mark(jsonRef.current); setMode("free"); }
        else if (takePending(sot, ref.current.key)) { ref.current.apply(data.state); setMode("free"); }
        else { setConflict(data); setMode("blocked"); }
      } catch (e) {
        if (dead) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setMode("free");
          // Sin nada guardado: se trae de «Datos de cliente» lo que esta ventana necesita.
          if (ref.current.fill) {
            try {
              const { data: c } = await api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(sot)}`);
              if (!dead) ref.current.fill(c);
            } catch { /* no es cliente todavía */ }
          }
        } else {
          setMode("idle"); // sin conexión: no se guarda ni se pisa nada
        }
      }
    }, 900);
    return () => { dead = true; window.clearTimeout(t); };
  }, [sot, enabled, o.key]);

  // Guardar ahora (a mano, al salir o desde el guardado automático)
  const doSave = async (): Promise<boolean> => {
    const cur = ref.current;
    const sotNow = sotRef.current;
    if (!sotNow) return false;
    const snap = jsonRef.current;
    setStatus({ kind: "saving", at: "" });
    try {
      await api.put("/clients/workspace", {
        sot: sotNow, key: cur.key, label: cur.label, route: pathname, state: JSON.parse(snap),
        nombre: cur.nombre ?? "", fecha: cur.fecha ?? "",
      });
      mark(snap);
      setStatus({ kind: "saved", at: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) });
      return true;
    } catch {
      setStatus({ kind: "error", at: "" });
      return false;
    }
  };
  const doSaveRef = useRef(doSave); doSaveRef.current = doSave;

  // 2) Guardado automático (se puede apagar con el interruptor)
  useEffect(() => {
    if (!auto || !enabled || !sot || mode !== "free" || json === last.current) return;
    const t = window.setTimeout(() => { void doSaveRef.current(); }, 2000);
    return () => window.clearTimeout(t);
  }, [json, mode, sot, enabled, pathname, auto]);

  // 3) Al salir de esta ventana: con guardado automático no se pierde lo de los últimos segundos; sin él, NavGuard pregunta.
  const id = useRef(Symbol("ws"));
  useEffect(() => {
    const me = id.current;
    guards.set(me, {
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
      guards.delete(me);
      if (getAutosave() && ref.current.enabled !== false && sotRef.current && modeRef.current === "free" && jsonRef.current !== last.current) {
        void api.put("/clients/workspace", {
          sot: sotRef.current, key: ref.current.key, label: ref.current.label, route: pathname, state: JSON.parse(jsonRef.current),
          nombre: ref.current.nombre ?? "", fecha: ref.current.fecha ?? "",
        }).catch(() => undefined);
      }
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
    if (r === "save") return (await saveQuiet()) ? true : (confirm("No se pudo guardar (sin conexión). ¿Continuar sin guardar?") ? false : null);
    if (r === "skip") return false;
    return null;
  };

  return {
    conflict,
    load: () => { if (conflict) { ref.current.apply(conflict.state); mark(JSON.stringify(conflict.state ?? {})); setConflict(null); setMode("free"); } },
    keepMine: () => { setConflict(null); setMode("free"); },
    status,
    hasSot: !!sot,
    versions: () => api.get<VersionInfo[]>("/clients/workspace-versions", { params: { sot, key: ref.current.key } }).then((r) => r.data),
    recover: async (id: string) => {
      const { data } = await api.post<Saved>(`/clients/workspace-versions/${id}/restore`);
      ref.current.apply(data.state);
      mark(JSON.stringify(data.state ?? {}));
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

/**
 * Ventanas guardadas por SOT: todo lo que hay en pantalla en una ventana (reporte fotográfico,
 * CheckList, Poder Judicial...) se guarda solo en el servidor asociado a la SOT, para volver a
 * abrirlo, editarlo y seguir. Las fotos y los PDF/ZIP generados también quedan guardados.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { ClientRecord } from "./clients";

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
}

export interface WsApi {
  /** Hay datos guardados distintos a los de pantalla: se espera tu decisión antes de guardar. */
  conflict: Saved | null;
  load: () => void;
  keepMine: () => void;
  status: { kind: "saving" | "saved" | "error"; at: string } | null;
  hasSot: boolean;
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
        if (same) { last.current = jsonRef.current; setMode("free"); }
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

  // 2) Guardado automático
  useEffect(() => {
    if (!enabled || !sot || mode !== "free" || json === last.current) return;
    const t = window.setTimeout(async () => {
      const cur = ref.current;
      setStatus({ kind: "saving", at: "" });
      try {
        await api.put("/clients/workspace", {
          sot, key: cur.key, label: cur.label, route: pathname, state: JSON.parse(jsonRef.current),
          nombre: cur.nombre ?? "", fecha: cur.fecha ?? "",
        });
        last.current = jsonRef.current;
        setStatus({ kind: "saved", at: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) });
      } catch {
        setStatus({ kind: "error", at: "" });
      }
    }, 2000);
    return () => window.clearTimeout(t);
  }, [json, mode, sot, enabled, pathname]);

  return {
    conflict,
    load: () => { if (conflict) { ref.current.apply(conflict.state); last.current = JSON.stringify(conflict.state ?? {}); setConflict(null); setMode("free"); } },
    keepMine: () => { setConflict(null); setMode("free"); },
    status,
    hasSot: !!sot,
  };
}

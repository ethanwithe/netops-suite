import axios from "axios";

// ------------------------------------------------------------
// Dónde está el backend.
//  - Railway / Docker (todo en un servidor): no se define nada y se usa el
//    mismo origen ("/api"), exactamente como siempre.
//  - Frontend en Vercel con el backend en otro dominio: se define
//    VITE_API_URL=https://tu-backend (sin /api al final).
//  - Pruebas/CheckList en vivo usan WebSocket, que Vercel no soporta: si el
//    backend está en Vercel, VITE_WS_URL puede apuntar a un servidor que sí
//    (p. ej. Railway).
// ------------------------------------------------------------
const trimSlash = (u: string) => u.replace(/\/+$/, "");
export const API_ORIGIN = trimSlash(import.meta.env.VITE_API_URL ?? "");
const WS_ORIGIN = trimSlash(import.meta.env.VITE_WS_URL ?? "") || API_ORIGIN;

export const api = axios.create({ baseURL: `${API_ORIGIN}/api` });

/** Convierte una ruta del backend ("/api/files/...") en una dirección completa si hace falta. */
export function assetUrl(u: string): string {
  return API_ORIGIN && u.startsWith("/api/") ? API_ORIGIN + u : u;
}

// El backend responde con direcciones relativas (/api/files/..., /api/logos/...).
// Con el backend en otro dominio, hay que completarlas para que <img> y los
// enlaces de descarga las encuentren.
function absolutize(node: unknown, depth = 0): unknown {
  if (depth > 8 || node === null) return node;
  if (typeof node === "string") return node.startsWith("/api/") ? assetUrl(node) : node;
  if (Array.isArray(node)) return node.map((v) => absolutize(v, depth + 1));
  if (typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = absolutize(v, depth + 1);
    }
    return out;
  }
  return node;
}

if (API_ORIGIN) {
  api.interceptors.response.use((res) => {
    const type = String(res.headers?.["content-type"] ?? "");
    if (type.includes("application/json")) res.data = absolutize(res.data);
    return res;
  });
}

export function wsUrl(path: string): string {
  if (WS_ORIGIN) {
    return `${WS_ORIGIN.replace(/^http/, "ws")}/api${path}`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api${path}`;
}

export type WsEvent =
  | { type: "log"; message: string }
  | { type: "done"; result: any }
  | { type: "error"; message: string };

/**
 * Abre un WebSocket, envía `params` como primer mensaje, y llama a
 * `onEvent` por cada evento recibido (log en vivo, resultado final, o
 * error). Devuelve una función para cerrar la conexión.
 */
export function runStreaming(
  path: string,
  params: unknown,
  onEvent: (ev: WsEvent) => void
): () => void {
  const ws = new WebSocket(wsUrl(path));
  ws.onopen = () => ws.send(JSON.stringify(params));
  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      // ignore
    }
  };
  ws.onerror = () => onEvent({ type: "error", message: "Error de conexión WebSocket." });
  return () => ws.close();
}

/** Extrae un mensaje legible de un error de axios / FastAPI. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as {
    response?: { data?: { detail?: unknown } };
    message?: string;
  };

  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;

  if (Array.isArray(detail)) {
    const msgs = detail.map((d) =>
      d && typeof d === "object" && "msg" in d
        ? String((d as { msg: unknown }).msg)
        : String(d)
    );
    if (msgs.length) return msgs.join("; ");
  }

  return err?.message ? `${fallback} (${err.message})` : fallback;
}

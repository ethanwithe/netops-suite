import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

export function wsUrl(path: string): string {
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

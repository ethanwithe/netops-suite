/** Habla con el agente local (saturador.py --agente) que corre en la laptop del técnico. */

export const AGENT_URL = "http://127.0.0.1:8765";

export interface AgentStatus {
  agente: true;
  icmp: boolean;
  so: string;
  corriendo: boolean;
  destino: string;
  mbps: number;
  tx_mbps: number;
  rx_mbps: number;
  pico_tx: number;
  pico_rx: number;
  perdida: number;
  segundos: number;
  duracion: number;
}

export type AgentResult =
  | { kind: "ok"; status: AgentStatus }
  | { kind: "codigo" } // el agente existe pero el código no coincide
  | { kind: "ausente" }; // no hay agente (no está abierto o el navegador lo bloqueó)

async function call(path: string, code: string, body?: unknown): Promise<AgentResult> {
  try {
    const r = await fetch(AGENT_URL + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Token": code, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) return { kind: "codigo" };
    if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
    return { kind: "ok", status: data as AgentStatus };
  } catch (e) {
    if (e instanceof TypeError) return { kind: "ausente" }; // sin conexión / bloqueado
    throw e;
  }
}

export const agentStatus = (code: string) => call("/estado", code);
export const agentStart = (code: string, destino: string, mbps: number, seg: number, tam = 1400) =>
  call("/iniciar", code, { destino, mbps, seg, tam });
export const agentStop = (code: string) => call("/detener", code, {});

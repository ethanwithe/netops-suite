/**
 * Lectura sin conexión: cada respuesta GET correcta de catálogos y listas (plantillas, tipos de CheckList,
 * opciones de gráfica, logos, perfil, permisos...) se guarda en este equipo; si luego no hay Internet se responde
 * con la última copia. Así la app abre y funciona igual en el campo.
 * Lo que cambia mucho o es del servidor (sincronización, ventanas, IA, archivos) no pasa por aquí.
 */
import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { dbAll, dbDel, dbGet, dbPut } from "../sync/db";

const SKIP = ["/sync", "/files", "/clients/workspace", "/imageai", "/mascot", "/tools", "/auth/avatar", "/auth/login", "/auth/logout", "/system"];
const PREFIX = "api:";
const MAX_BYTES = 4_000_000;

function key(cfg: InternalAxiosRequestConfig): string | null {
  const url = cfg.url || "";
  if ((cfg.method || "get").toLowerCase() !== "get" || cfg.responseType === "blob" || cfg.responseType === "arraybuffer") return null;
  if (SKIP.some((p) => url.startsWith(p))) return null;
  const p = cfg.params ? Object.keys(cfg.params).sort().map((k) => `${k}=${String(cfg.params[k])}`).join("&") : "";
  const act = cfg.headers?.get?.("X-Act-Client") || "";
  return `${PREFIX}${url}?${p}|${act}`;
}

export function installOfflineCache(api: AxiosInstance): void {
  api.interceptors.response.use(
    (res: AxiosResponse) => {
      const k = key(res.config);
      if (k && res.status === 200) {
        try { if (JSON.stringify(res.data).length < MAX_BYTES) void dbPut("meta", { k, v: res.data, at: Date.now() }).catch(() => undefined); } catch { /* no serializable */ }
      }
      return res;
    },
    async (err: AxiosError) => {
      const cfg = err.config;
      if (!err.response && cfg) {                                   // sin conexión con el servidor
        const k = key(cfg);
        if (k) {
          const hit = await dbGet<{ k: string; v: unknown }>("meta", k).catch(() => undefined);
          if (hit) return { data: hit.v, status: 200, statusText: "OK (copia local)", headers: {}, config: cfg, request: null, offline: true } as AxiosResponse;
        }
      }
      throw err;
    },
  );
}

/** Al cerrar sesión se borran las copias (en un equipo compartido no quedan datos de la persona anterior). */
export async function clearApiCache(): Promise<void> {
  try { for (const r of await dbAll<{ k: string }>("meta")) if (r.k.startsWith(PREFIX)) await dbDel("meta", r.k); } catch { /* sin almacenamiento */ }
}

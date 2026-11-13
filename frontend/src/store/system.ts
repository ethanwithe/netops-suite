import { api } from "../api/client";

export interface Estado {
  hora_servidor: string;
  usuarios: { total: number; activos: number; roles: Record<string, number>; conectados_24h: number };
  clientes: { total: number; en_papelera: number; ventanas_guardadas: number };
  actividad_24h: number;
  archivos: { subidas: { files: number; mb: number }; salidas: { files: number; mb: number } };
  disco: { libre_gb: number; total_gb: number };
  integraciones: Record<string, boolean>;
}
export interface Announcement { active: boolean; text?: string; level?: "info" | "warn" | "alert"; id?: string }

export const getEstado = () => api.get<Estado>("/admin/sistema/estado").then((r) => r.data);
export const getAnnouncement = () => api.get<Announcement>("/announcement").then((r) => r.data);
export const setAnnouncement = (p: { text: string; level: string; active: boolean }) => api.put("/admin/sistema/anuncio", p).then((r) => r.data);
export const transferir = (from_id: string, to_id: string, deactivate_from: boolean) => api.post<{ clientes: number }>("/admin/sistema/transferir", { from_id, to_id, deactivate_from }).then((r) => r.data);
export const masivo = (user_ids: string[], action: string, feature = "", value = true) => api.post<{ usuarios: number }>("/admin/sistema/usuarios-masivo", { user_ids, action, feature, value }).then((r) => r.data);
export const cerrarTodas = () => api.post<{ usuarios: number }>("/admin/sistema/cerrar-sesiones").then((r) => r.data);

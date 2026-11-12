import { api } from "../api/client";
import type { ClientRecord } from "./clients";

export interface AdminUser {
  id: string; username: string; role: "superadmin" | "admin" | "user"; full_name: string; email: string; phone: string; cargo: string;
  active: boolean; valid_from: string; valid_until: string; daily_start: string; daily_end: string;
  raw_permissions: Record<string, boolean>; permissions: Record<string, boolean>; notes: string;
  created_at: string; last_login: string; access_problem: string; clients: number; points: number;
  has_avatar: boolean; avatar_v: number;
}
export interface UserForm {
  username: string; password: string; role: string; full_name: string; email: string; phone: string; cargo: string;
  active: boolean; valid_from: string; valid_until: string; daily_start: string; daily_end: string;
  permissions: Record<string, boolean>; notes: string; must_change_password: boolean;
}
export interface Feature { key: string; label: string }
export interface Activity { id: string; user_id: string | null; username: string; action: string; detail: string; client_id: string | null; at: string }

export const listFeatures = () => api.get<Feature[]>("/admin/features").then((r) => r.data);
export const listUsers = () => api.get<AdminUser[]>("/admin/users").then((r) => r.data);
export const createUser = (u: UserForm) => api.post<AdminUser>("/admin/users", u).then((r) => r.data);
export const updateUser = (id: string, u: UserForm) => api.put<AdminUser>(`/admin/users/${id}`, u).then((r) => r.data);
export const resetPassword = (id: string, password: string, must_change: boolean) => api.post(`/admin/users/${id}/password`, { password, must_change });
export const forceLogout = (id: string) => api.post(`/admin/users/${id}/logout`);
export const deleteUser = (id: string) => api.delete(`/admin/users/${id}`);
export const listActivity = (p: { user_id?: string; action?: string; limit?: number }) => api.get<Activity[]>("/admin/activity", { params: p }).then((r) => r.data);
export const listAllClients = (p: { user_id?: string; month?: string; year?: number; q?: string; deleted?: boolean }) =>
  api.get<ClientRecord[]>("/admin/clients", { params: p }).then((r) => r.data);
export const setParticipants = (id: string, user_ids: string[]) => api.put<ClientRecord>(`/admin/clients/${id}/participants`, { user_ids }).then((r) => r.data);
export const mergeClients = (id: string, into: string) => api.post<ClientRecord>(`/admin/clients/${id}/merge`, { into }).then((r) => r.data);
export const adminRestore = (id: string) => api.put(`/admin/clients/${id}/restore`);
export const adminPurge = (id: string) => api.delete(`/admin/clients/${id}/purge`);

export interface Dashboard {
  scope: "me" | "all"; year: number; total_clients: number; my_clients: number; my_points: number; shared_clients: number;
  months: { month: string; clients: number; points: number }[];
  ranking: { user_id: string; name: string; username: string; clients: number; points: number; months: number[] }[];
  recent: ClientRecord[];
}
export const getDashboard = (scope: string, year: number) => api.get<Dashboard>("/clients/dashboard", { params: { scope, year } }).then((r) => r.data);

export interface ExportParams { format: string; scope?: string; user_id?: string; month?: string; year?: number; q?: string }
export function exportClientsUrl(p: ExportParams): string {
  const q = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
  return `/api/export/clients?${q.toString()}`;
}
export const exportClientUrl = (id: string, format: string) => `/api/export/client/${id}?format=${format}`;
export const FORMATS = [["xlsx", "Excel"], ["docx", "Word"], ["pptx", "PowerPoint"], ["pdf", "PDF"], ["txt", "TXT"]] as const;

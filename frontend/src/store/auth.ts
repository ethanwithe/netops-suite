/** Sesión del usuario: quién es, qué puede hacer y si debe cambiar su contraseña. */
import { useSyncExternalStore } from "react";
import { api, setActingClient } from "../api/client";

export interface Me {
  id: string;
  username: string;
  role: "superadmin" | "admin" | "user";
  full_name: string;
  email: string;
  phone: string;
  cargo: string;
  has_avatar: boolean;
  avatar_v: number;
  must_change_password: boolean;
  permissions: Record<string, boolean>;
  is_admin: boolean;
  valid_until: string;
  daily_start: string;
  daily_end: string;
}

interface State { me: Me | null; loading: boolean; notice: string }
let state: State = { me: null, loading: true, notice: "" };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

export const useAuth = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
export const can = (me: Me | null, feature: string) => !!me && (me.is_admin || me.permissions[feature] !== false);
export const displayName = (me: Me) => me.full_name || me.username;
export const avatarUrl = (id: string, v = 0) => `/api/auth/avatar/${id}?v=${v}`;

// Claves del navegador que son del trabajo de un usuario (no de su apariencia): se limpian si entra otra persona.
const KEEP = ["netops.look", "netops.theme", "netops.mascot", "netops.cam", "netops.stamp", "netops.lastUser"];
function wipeLocalWork(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("netops.") && !KEEP.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

function adopt(me: Me): void {
  let changed = false;
  try {
    const last = localStorage.getItem("netops.lastUser");
    if (last && last !== me.id) { wipeLocalWork(); changed = true; }
    localStorage.setItem("netops.lastUser", me.id);
  } catch { /* ignore */ }
  if (changed) { window.location.reload(); return; }
  set({ me, loading: false, notice: "" });
}

export async function loadMe(): Promise<void> {
  try {
    const r = await api.get<Me>("/auth/me");
    adopt(r.data);
  } catch {
    set({ me: null, loading: false });
  }
}

export async function login(username: string, password: string): Promise<void> {
  const r = await api.post<Me>("/auth/login", { username, password });
  adopt(r.data);
}

export async function logout(): Promise<void> {
  try { await api.post("/auth/logout"); } catch { /* ignore */ }
  setActingClient(null);
  set({ me: null, notice: "" });
}

export function setMe(me: Me): void { set({ me }); }

// Si el servidor dice que la sesión ya no vale (venció, la cerró el administrador, fuera de horario…) se vuelve al login.
api.interceptors.response.use(
  (r) => r,
  (e) => {
    const st = e?.response?.status;
    const code = e?.response?.data?.code;
    const url: string = e?.config?.url || "";
    if (url.startsWith("/auth/login")) return Promise.reject(e);
    if (st === 401 || (st === 403 && code === "no_access")) {
      set({ me: null, loading: false, notice: String(e?.response?.data?.detail || "Tu sesión terminó. Inicia sesión otra vez.") });
    }
    return Promise.reject(e);
  }
);

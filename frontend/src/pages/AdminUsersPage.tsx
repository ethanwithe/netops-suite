import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "../api/client";
import Spinner from "../components/Spinner";
import { createUser, deleteUser, forceLogout, listFeatures, listUsers, resetPassword, updateUser } from "../store/admin";
import type { AdminUser, Feature, UserForm } from "../store/admin";
import { useAuth } from "../store/auth";
import { Avatar } from "./ProfilePage";

const ROLE: Record<string, string> = { superadmin: "Superadmin", admin: "Administrador", user: "Usuario" };
const EMPTY: UserForm = {
  username: "", password: "", role: "user", full_name: "", email: "", phone: "", cargo: "", active: true,
  valid_from: "", valid_until: "", daily_start: "", daily_end: "", permissions: {}, notes: "", must_change_password: true,
};
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "nunca");

export default function AdminUsersPage() {
  const { me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    return Promise.all([listUsers(), listFeatures()])
      .then(([u, f]) => { setUsers(u); setFeatures(f); setError(null); })
      .catch((e) => setError(apiErrorMessage(e, "No se pudieron cargar los usuarios.")))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function toggle(u: AdminUser) {
    try { await updateUser(u.id, toForm(u, { active: !u.active })); await reload(); }
    catch (e) { alert(apiErrorMessage(e, "No se pudo cambiar el estado.")); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="page-title">Usuarios</h2>
          <p className="text-sm text-slate-500">Tú creas las cuentas (no hay registro). El nombre completo sirve para asociar a cada persona con los clientes que hizo.</p>
        </div>
        <button className="btn-primary text-sm" onClick={() => setEditing("new")}>Crear usuario</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className={`card flex flex-wrap items-center gap-3 ${u.active ? "" : "opacity-60"}`}>
              <Avatar me={u} size={40} />
              <div className="min-w-[180px] flex-1">
                <p className="font-semibold text-slate-800">{u.full_name || "(sin nombre)"} <span className="font-normal text-slate-500">@{u.username}</span></p>
                <p className="text-xs text-slate-500">
                  {ROLE[u.role]} · {u.clients} cliente(s) · {u.points} punto(s) · último ingreso: {when(u.last_login)}
                </p>
                <p className="text-xs">
                  {!u.active ? <span className="text-red-600">Desactivado</span>
                    : u.access_problem ? <span className="text-amber-600">Sin acceso ahora: {u.access_problem}</span>
                    : <span className="text-emerald-600">Con acceso</span>}
                  {u.valid_until && <span className="text-slate-400"> · hasta {u.valid_until}</span>}
                  {u.daily_start && u.daily_end && <span className="text-slate-400"> · {u.daily_start}–{u.daily_end}</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary text-xs" onClick={() => setEditing(u)}>Editar</button>
                {u.id !== me?.id && <button className="btn-secondary text-xs" onClick={() => void toggle(u)}>{u.active ? "Desactivar" : "Activar"}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <UserEditor
          initial={editing === "new" ? undefined : editing}
          features={features}
          isSuper={me?.role === "superadmin"}
          self={editing !== "new" && editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}

function toForm(u: AdminUser, over: Partial<UserForm> = {}): UserForm {
  return {
    username: u.username, password: "", role: u.role, full_name: u.full_name, email: u.email, phone: u.phone, cargo: u.cargo,
    active: u.active, valid_from: u.valid_from, valid_until: u.valid_until, daily_start: u.daily_start, daily_end: u.daily_end,
    permissions: u.raw_permissions, notes: u.notes, must_change_password: false, ...over,
  };
}

function UserEditor({ initial, features, isSuper, self, onClose, onSaved }: {
  initial?: AdminUser; features: Feature[]; isSuper: boolean; self: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<UserForm>(initial ? toForm(initial) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const isAdminRole = f.role !== "user";

  async function save() {
    setBusy(true); setError(null);
    try {
      if (initial) await updateUser(initial.id, f); else await createUser(f);
      onSaved();
    } catch (e) { setError(apiErrorMessage(e, "No se pudo guardar.")); setBusy(false); }
  }
  async function doReset() {
    if (!initial) return;
    if (newPw.length < 8) { setError("La contraseña nueva debe tener al menos 8 caracteres."); return; }
    try { await resetPassword(initial.id, newPw, mustChange); setNewPw(""); setError(null); alert("Contraseña actualizada. Sus sesiones abiertas se cerraron."); }
    catch (e) { setError(apiErrorMessage(e, "No se pudo cambiar la contraseña.")); }
  }
  async function doLogout() { if (initial) { try { await forceLogout(initial.id); alert("Sesiones cerradas."); } catch (e) { setError(apiErrorMessage(e, "No se pudo cerrar la sesión.")); } } }
  async function doDelete() {
    if (!initial || !confirm(`¿Eliminar a @${initial.username}? Si tiene clientes, mejor desactívalo.`)) return;
    try { await deleteUser(initial.id); onSaved(); } catch (e) { setError(apiErrorMessage(e, "No se pudo eliminar.")); }
  }
  const text = (label: string, key: keyof UserForm, type = "text", cls = "") => (
    <label className={`block text-sm ${cls}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input type={type} className="input w-full" value={f[key] as string} onChange={(e) => setF({ ...f, [key]: e.target.value })} autoCapitalize="none" />
    </label>
  );
  const allowed = (k: string) => isAdminRole || f.permissions[k] !== false;

  return (
    <div className="sheet-wrap fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8">
      <div className="card sheet w-full max-w-2xl space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">{initial ? `Editar @${initial.username}` : "Crear usuario"}</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("Usuario (para entrar)", "username")}
          {!initial && text("Contraseña inicial", "password", "text")}
          {text("Nombre completo (para asociar clientes)", "full_name", "text", "sm:col-span-2")}
          {text("Correo", "email")}
          {text("Teléfono", "phone")}
          {text("Cargo", "cargo", "text", "sm:col-span-2")}
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Rol</span>
            <select className="input w-full" value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="user">Usuario (solo ve sus clientes)</option>
              {(isSuper || initial?.role === "admin") && <option value="admin">Administrador (ve todo, gestiona usuarios)</option>}
              {(isSuper || initial?.role === "superadmin") && <option value="superadmin">Superadmin (todo, incluso crear administradores)</option>}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 self-end pb-2 text-sm">
            <span>Usuario activo</span>
            <input type="checkbox" className="ios" checked={f.active} disabled={self} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          </label>
        </div>

        {!isAdminRole && (
          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-600">Vigencia de uso (vacío = sin límite)</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {text("Desde (fecha)", "valid_from", "date")}
              {text("Hasta (fecha)", "valid_until", "date")}
              {text("Hora de inicio", "daily_start", "time")}
              {text("Hora de fin", "daily_end", "time")}
            </div>
            <p className="text-[11px] text-slate-400">Ejemplo: del 01/11 al 30/11 y solo de 08:00 a 12:00 al día. Fuera de eso no podrá entrar ni seguir usando el sistema. Hora de Lima.</p>
          </fieldset>
        )}

        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">Qué puede hacer {isAdminRole && "(los administradores tienen todo)"}</legend>
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {features.map((ft) => (
              <label key={ft.key} className="flex items-center justify-between gap-3 py-1 text-sm">
                <span>{ft.label}</span>
                <input type="checkbox" className="ios" disabled={isAdminRole} checked={allowed(ft.key)} onChange={(e) => setF({ ...f, permissions: { ...f.permissions, [ft.key]: e.target.checked } })} />
              </label>
            ))}
          </div>
        </fieldset>

        {text("Notas internas", "notes")}

        {!initial && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.must_change_password} onChange={(e) => setF({ ...f, must_change_password: e.target.checked })} /> Pedir que cambie la contraseña en su primer ingreso
          </label>
        )}

        {initial && (
          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-600">Contraseña y sesiones</legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-sm"><span className="mb-1 block text-xs text-slate-500">Nueva contraseña</span>
                <input className="input w-full" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="off" /></label>
              <button className="btn-secondary text-xs" onClick={doReset}>Restablecer</button>
              <button className="btn-secondary text-xs" onClick={doLogout}>Cerrar sus sesiones</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /> Obligar a cambiarla al entrar</label>
          </fieldset>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {initial && !self ? <button className="text-sm text-red-500 hover:underline" onClick={doDelete}>Eliminar usuario</button> : <span />}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

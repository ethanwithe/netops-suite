import { useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import { avatarUrl, setMe, useAuth } from "../store/auth";
import type { Me } from "../store/auth";

const ROLE: Record<string, string> = { superadmin: "Superadministrador", admin: "Administrador", user: "Usuario" };

export default function ProfilePage() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h2 className="page-title">Mi perfil</h2>
      <Datos me={me} />
      <Password />
    </div>
  );
}

function Datos({ me }: { me: Me }) {
  const [f, setF] = useState({ full_name: me.full_name, email: me.email, phone: me.phone, cargo: me.cargo });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true); setMsg(null);
    try { const r = await api.put<Me>("/auth/me", f); setMe(r.data); setMsg({ ok: true, t: "Datos guardados." }); }
    catch (e) { setMsg({ ok: false, t: apiErrorMessage(e, "No se pudo guardar.") }); }
    setBusy(false);
  }
  async function upload(fl: File | undefined) {
    if (!fl) return;
    const fd = new FormData(); fd.append("file", fl);
    try { const r = await api.post<Me>("/auth/avatar", fd); setMe(r.data); setMsg({ ok: true, t: "Foto actualizada." }); }
    catch (e) { setMsg({ ok: false, t: apiErrorMessage(e, "No se pudo subir la foto.") }); }
  }
  async function removePhoto() {
    try { const r = await api.delete<Me>("/auth/avatar"); setMe(r.data); } catch (e) { setMsg({ ok: false, t: apiErrorMessage(e, "No se pudo quitar la foto.") }); }
  }
  const field = (label: string, key: keyof typeof f, cls = "") => (
    <label className={`block text-sm ${cls}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input className="input w-full" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar me={me} size={84} />
        <div className="space-y-1">
          <p className="font-semibold text-slate-800">@{me.username}</p>
          <p className="text-xs text-slate-500">{ROLE[me.role]}{me.valid_until ? ` · acceso hasta ${me.valid_until}` : ""}{me.daily_start && me.daily_end ? ` · de ${me.daily_start} a ${me.daily_end}` : ""}</p>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => file.current?.click()}>{me.has_avatar ? "Cambiar foto" : "Subir foto"}</button>
            {me.has_avatar && <button className="btn-secondary text-xs" onClick={removePhoto}>Quitar</button>}
          </div>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("Nombre completo", "full_name", "sm:col-span-2")}
        {field("Correo", "email")}
        {field("Teléfono", "phone")}
        {field("Cargo", "cargo", "sm:col-span-2")}
      </div>
      <p className="text-[11px] text-slate-400">Tu nombre completo es el que el administrador usa para asociarte a los clientes que hiciste. Para entrar solo se usa tu usuario y contraseña.</p>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.t}</p>}
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar datos"}</button>
    </div>
  );
}

function Password() {
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function save() {
    if (n1.length < 8) return setMsg({ ok: false, t: "La nueva contraseña debe tener al menos 8 caracteres." });
    if (n1 !== n2) return setMsg({ ok: false, t: "Las contraseñas nuevas no coinciden." });
    try { const r = await api.post<Me>("/auth/password", { current: cur, new: n1 }); setMe(r.data); setCur(""); setN1(""); setN2(""); setMsg({ ok: true, t: "Contraseña actualizada." }); }
    catch (e) { setMsg({ ok: false, t: apiErrorMessage(e, "No se pudo cambiar la contraseña.") }); }
  }
  const pw = (label: string, v: string, fn: (s: string) => void) => (
    <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input type="password" className="input w-full" value={v} onChange={(e) => fn(e.target.value)} /></label>
  );
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-slate-800">Cambiar contraseña</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{pw("Actual", cur, setCur)}{pw("Nueva", n1, setN1)}{pw("Repite la nueva", n2, setN2)}</div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.t}</p>}
      <button className="btn-secondary" onClick={save}>Actualizar contraseña</button>
    </div>
  );
}

export function Avatar({ me, size = 32 }: { me: { id: string; full_name: string; username: string; has_avatar: boolean; avatar_v: number }; size?: number }) {
  const name = me.full_name || me.username;
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return me.has_avatar ? (
    <img src={avatarUrl(me.id, me.avatar_v)} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials || "?"}</span>
  );
}

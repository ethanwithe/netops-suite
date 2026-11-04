import { useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import Backdrop from "../components/Backdrop";
import Spinner from "../components/Spinner";
import { login, logout, setMe, useAuth } from "../store/auth";
import type { Me } from "../store/auth";

/** Entrada: solo usuario y contraseña (no hay registro; el administrador crea las cuentas). */
export default function LoginPage() {
  const { notice } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user.trim() || !pass) { setError("Escribe tu usuario y contraseña."); return; }
    setBusy(true);
    setError(null);
    try {
      await login(user.trim(), pass);
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo iniciar sesión."));
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <Backdrop />
      <form onSubmit={submit} className="card relative z-10 w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
          <div className="leading-tight">
            <h1 className="font-display text-xl font-extrabold text-slate-800">NetOps Suite</h1>
            <p className="text-xs text-slate-500">Inicia sesión para continuar</p>
          </div>
        </div>
        {notice && !error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{notice}</p>}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Usuario</span>
          <input className="input w-full" autoFocus autoComplete="username" autoCapitalize="none" value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Contraseña</span>
          <span className="flex gap-2">
            <input className="input w-full" type={show ? "text" : "password"} autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <button type="button" className="btn-secondary text-xs" onClick={() => setShow(!show)}>{show ? "Ocultar" : "Ver"}</button>
          </span>
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? <span className="flex items-center justify-center gap-2"><Spinner /> Entrando…</span> : "Entrar"}</button>
        <p className="text-center text-[11px] text-slate-400">¿No tienes acceso? Pídeselo al administrador.</p>
      </form>
    </div>
  );
}

/** Cambio de contraseña obligatorio (primer ingreso o tras un restablecimiento del administrador). */
export function ForcePassword({ me }: { me: Me }) {
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (n1.length < 6) { setError("La nueva contraseña debe tener al menos 6 caracteres."); return; }
    if (n1 !== n2) { setError("Las contraseñas nuevas no coinciden."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Me>("/auth/password", { current: cur, new: n1 });
      setMe(r.data);
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo cambiar la contraseña."));
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <Backdrop />
      <form onSubmit={save} className="card relative z-10 w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-800">Cambia tu contraseña</h1>
          <p className="text-sm text-slate-500">Hola {me.full_name || me.username}. Por seguridad debes elegir una contraseña nueva antes de continuar.</p>
        </div>
        {[["Contraseña actual", cur, setCur, "current-password"], ["Contraseña nueva", n1, setN1, "new-password"], ["Repite la nueva", n2, setN2, "new-password"]].map(([label, val, fn, ac]) => (
          <label key={label as string} className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">{label as string}</span>
            <input className="input w-full" type="password" autoComplete={ac as string} value={val as string} onChange={(e) => (fn as (v: string) => void)(e.target.value)} />
          </label>
        ))}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => void logout()}>Salir</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar y entrar"}</button>
        </div>
      </form>
    </div>
  );
}

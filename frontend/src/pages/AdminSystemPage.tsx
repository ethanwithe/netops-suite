import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "../api/client";
import Spinner from "../components/Spinner";
import { listFeatures, listUsers } from "../store/admin";
import type { AdminUser, Feature } from "../store/admin";
import { cerrarTodas, getAnnouncement, getEstado, masivo, setAnnouncement, transferir } from "../store/system";
import type { Estado } from "../store/system";

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3">
      <div>
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

/** Panel solo del superadmin: estado, anuncio, transferencias, acciones masivas, respaldo y exportaciones. */
export default function AdminSystemPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    getEstado().then(setEstado).catch((e) => setError(apiErrorMessage(e, "No se pudo cargar el estado.")));
    listUsers().then(setUsers).catch(() => undefined);
  }, []);
  useEffect(() => { reload(); listFeatures().then(setFeatures).catch(() => undefined); }, [reload]);

  // anuncio
  const [text, setText] = useState("");
  const [level, setLevel] = useState("info");
  useEffect(() => { getAnnouncement().then((a) => { if (a.active) { setText(a.text ?? ""); setLevel(a.level ?? "info"); } }).catch(() => undefined); }, []);

  // transferir
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [deact, setDeact] = useState(false);

  // masivo
  const [sel, setSel] = useState<string[]>([]);
  const [action, setAction] = useState("desactivar");
  const [feature, setFeature] = useState("");
  const [value, setValue] = useState(true);

  async function run(fn: () => Promise<string>) {
    setBusy(true); setError(null); setNote(null);
    try { setNote(await fn()); reload(); } catch (e) { setError(apiErrorMessage(e, "No se pudo completar.")); }
    finally { setBusy(false); }
  }
  const name = (u: AdminUser) => u.full_name || u.username;

  if (!estado && !error) return <div className="flex justify-center py-16"><Spinner className="h-7 w-7 text-brand-600" /></div>;

  return (
    <div className="space-y-4">
      <h2 className="page-title">Sistema (superadmin)</h2>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {note && <p role="status" className="text-sm text-emerald-700">{note}</p>}

      {estado && (
        <Card title="Estado del sistema" hint={`Hora del servidor: ${estado.hora_servidor.replace("T", " ")}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Usuarios" value={estado.usuarios.total} sub={`${estado.usuarios.activos} activos`} />
            <Stat label="Entraron en 24 h" value={estado.usuarios.conectados_24h} />
            <Stat label="Clientes" value={estado.clientes.total} sub={`${estado.clientes.en_papelera} en papelera`} />
            <Stat label="Ventanas guardadas" value={estado.clientes.ventanas_guardadas} />
            <Stat label="Actividad 24 h" value={estado.actividad_24h} sub="acciones" />
            <Stat label="Disco libre" value={`${estado.disco.libre_gb} GB`} sub={`de ${estado.disco.total_gb} GB`} />
            <Stat label="Archivos subidos" value={estado.archivos.subidas.files} sub={`${estado.archivos.subidas.mb} MB`} />
            <Stat label="Reportes generados" value={estado.archivos.salidas.files} sub={`${estado.archivos.salidas.mb} MB`} />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Object.entries(estado.integraciones).map(([k, ok]) => (
              <span key={k} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${ok ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{ok ? "✓" : "—"} {k}</span>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">Solo se muestra si cada clave está configurada en Railway; nunca su valor.</p>
        </Card>
      )}

      <Card title="Anuncio para todo el equipo" hint="Aparece como una franja arriba de la página para todos los usuarios (cada uno puede cerrarla).">
        <textarea className="input w-full" rows={2} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. Hoy a las 18:00 se actualiza la plataforma; guarden su trabajo." />
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Tipo de anuncio">
            <option value="info">Informativo</option><option value="warn">Aviso</option><option value="alert">Urgente</option>
          </select>
          <button className="btn-primary text-sm" disabled={busy || !text.trim()} onClick={() => void run(async () => { await setAnnouncement({ text, level, active: true }); return "Anuncio publicado."; })}>Publicar</button>
          <button className="btn-secondary text-sm" disabled={busy} onClick={() => void run(async () => { await setAnnouncement({ text: "", level, active: false }); setText(""); return "Anuncio retirado."; })}>Retirar</button>
        </div>
      </Card>

      <Card title="Transferir el trabajo de un usuario a otro" hint="Todos los clientes donde participa el primero pasan al segundo (sin duplicar). Útil cuando alguien sale del equipo.">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De"><option value="">De…</option>{users.map((u) => <option key={u.id} value={u.id}>{name(u)} ({u.clients})</option>)}</select>
          <span aria-hidden="true">→</span>
          <select className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Para"><option value="">Para…</option>{users.filter((u) => u.id !== from).map((u) => <option key={u.id} value={u.id}>{name(u)}</option>)}</select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={deact} onChange={(e) => setDeact(e.target.checked)} />Desactivar al primero</label>
          <button className="btn-primary text-sm" disabled={busy || !from || !to}
            onClick={() => { if (confirm("¿Transferir todos sus clientes?")) void run(async () => `Listo: ${(await transferir(from, to, deact)).clientes} cliente(s) transferidos.`); }}>Transferir</button>
        </div>
      </Card>

      <Card title="Acciones sobre varios usuarios" hint="Elige usuarios y aplica la misma acción a todos.">
        <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sel.includes(u.id)} onChange={() => setSel((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} />
              {name(u)} <span className="text-xs text-slate-400">@{u.username}{u.active ? "" : " · inactivo"}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => setSel(users.map((u) => u.id))}>Todos</button>
          <button className="btn-secondary text-xs" onClick={() => setSel(users.filter((u) => u.role === "user").map((u) => u.id))}>Solo usuarios</button>
          <button className="btn-secondary text-xs" onClick={() => setSel([])}>Ninguno</button>
          <select className="input w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Acción">
            <option value="desactivar">Desactivar</option><option value="activar">Activar</option><option value="cerrar_sesion">Cerrar su sesión</option><option value="permiso">Cambiar un permiso…</option>
          </select>
          {action === "permiso" && (
            <>
              <select className="input w-auto" value={feature} onChange={(e) => setFeature(e.target.value)} aria-label="Función"><option value="">Función…</option>{features.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
              <select className="input w-auto" value={value ? "1" : "0"} onChange={(e) => setValue(e.target.value === "1")} aria-label="Valor"><option value="1">Permitir</option><option value="0">Quitar</option></select>
            </>
          )}
          <button className="btn-primary text-sm" disabled={busy || !sel.length || (action === "permiso" && !feature)}
            onClick={() => { if (confirm(`¿Aplicar a ${sel.length} usuario(s)?`)) void run(async () => `Listo: ${(await masivo(sel, action, feature, value)).usuarios} usuario(s).`); }}>Aplicar a {sel.length}</button>
        </div>
      </Card>

      <Card title="Seguridad y respaldo">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-sm" disabled={busy}
            onClick={() => { if (confirm("¿Cerrar la sesión de TODOS los usuarios (menos la tuya)?")) void run(async () => `Sesiones cerradas: ${(await cerrarTodas()).usuarios} usuario(s).`); }}>Cerrar la sesión de todos</button>
          <a className="btn-primary text-sm" href="/api/admin/sistema/respaldo" download>Descargar copia de seguridad (.json)</a>
          <a className="btn-secondary text-sm" href="/api/admin/sistema/actividad.csv?dias=30" download>Actividad 30 días (.csv)</a>
          <a className="btn-secondary text-sm" href="/api/admin/sistema/actividad.csv?dias=365" download>Actividad 1 año (.csv)</a>
        </div>
        <p className="text-[11px] text-slate-400">La copia incluye usuarios (sin contraseñas), clientes, participantes y ventanas guardadas. Guárdala en un lugar seguro.</p>
      </Card>
    </div>
  );
}

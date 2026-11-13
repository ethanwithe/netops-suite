import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "../api/client";
import Spinner from "../components/Spinner";
import { listActivity, listUsers } from "../store/admin";
import type { Activity, AdminUser } from "../store/admin";

const ACTION: Record<string, string> = {
  login: "Inició sesión", logout: "Cerró sesión", login_fallido: "Intento fallido", login_bloqueado: "Acceso bloqueado",
  cliente_creado: "Creó cliente", cliente_editado: "Editó cliente", cliente_a_papelera: "Envió a papelera", cliente_restaurado: "Restauró cliente",
  cliente_asociado: "Asoció cliente", cliente_eliminado_definitivo: "Eliminó definitivamente", reporte_generado: "Generó reporte",
  ventana_borrada: "Borró una ventana", version_recuperada: "Recuperó una versión", exportacion: "Exportó",
  usuario_creado: "Creó usuario", usuario_editado: "Editó usuario", usuario_eliminado: "Eliminó usuario",
  password_cambiada: "Cambió su contraseña", password_restablecida: "Restableció contraseña", perfil_editado: "Editó su perfil",
  sesion_cerrada_por_admin: "Cerró sesiones", cliente_unido: "Unió SOT repetidas", anuncio: "Anuncio", trabajo_transferido: "Transfirió trabajo",
  usuarios_masivo: "Acción masiva", sesiones_cerradas_todas: "Cerró todas las sesiones", respaldo_descargado: "Descargó respaldo",
};

export default function ActivityPage() {
  const [rows, setRows] = useState<Activity[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    return listActivity({ user_id: userId || undefined, action: action || undefined, limit: 300 })
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(apiErrorMessage(e, "No se pudo cargar la actividad.")))
      .finally(() => setLoading(false));
  }, [userId, action]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { listUsers().then(setUsers).catch(() => undefined); }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1"><h2 className="page-title">Actividad</h2><p className="text-sm text-slate-500">Qué hace cada usuario: sesiones, clientes, reportes, exportaciones y cambios.</p></div>
        <select className="input w-auto" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Usuario">
          <option value="">Todos los usuarios</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
        </select>
        <select className="input w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Acción">
          <option value="">Todas las acciones</option>
          {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-secondary text-xs" onClick={() => void reload()}>Actualizar</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <Spinner /> : rows.length === 0 ? <div className="card text-sm text-slate-500">Sin actividad.</div> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Cuándo</th><th className="px-3 py-2">Usuario</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Detalle</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">{new Date(r.at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-700">{r.username || "—"}</td>
                  <td className="px-3 py-1.5">{ACTION[r.action] ?? r.action}</td>
                  <td className="px-3 py-1.5 text-slate-500">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

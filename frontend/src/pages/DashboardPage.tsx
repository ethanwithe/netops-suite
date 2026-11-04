import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import Spinner from "../components/Spinner";
import { getDashboard } from "../store/admin";
import type { Dashboard } from "../store/admin";
import { displayName, useAuth } from "../store/auth";

const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-slate-800">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Bars({ values, labels, unit }: { values: number[]; labels: string[]; unit: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-44 items-end gap-1.5 sm:gap-2" role="img" aria-label={`Gráfico de ${unit} por mes`}>
      {values.map((v, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] text-slate-500">{v ? +v.toFixed(2) : ""}</span>
          <div className="w-full rounded-t-md bg-brand-500/80" style={{ height: `${Math.max(v ? 4 : 1, (v / max) * 100)}%` }} title={`${labels[i]}: ${+v.toFixed(2)} ${unit}`} />
          <span className="text-[10px] text-slate-500">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { me } = useAuth();
  const [scope, setScope] = useState<"me" | "all">("me");
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    getDashboard(scope, year).then((r) => { setD(r); setError(null); }).catch((e) => setError(apiErrorMessage(e, "No se pudo cargar el panel.")));
  }, [scope, year]);

  if (!me) return null;
  const all = d?.scope === "all";
  const maxRank = Math.max(1, ...(d?.ranking.map((r) => r.points) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="page-title">Panel</h2>
          <p className="text-sm text-slate-500">Hola {displayName(me)}. Cada cliente vale 1 punto; si lo hicieron varios, se reparte en partes iguales.</p>
        </div>
        {me.is_admin && (
          <div className="flex gap-1">
            <button className={`${scope === "me" ? "btn-primary" : "btn-secondary"} text-xs`} onClick={() => setScope("me")}>Lo mío</button>
            <button className={`${scope === "all" ? "btn-primary" : "btn-secondary"} text-xs`} onClick={() => setScope("all")}>De todos</button>
          </div>
        )}
        <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Año">
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!d && !error && <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Cargando…</p>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={all ? "Clientes (todos)" : "Mis clientes"} value={all ? d.total_clients : d.my_clients} hint={`en ${d.year}`} />
            <Stat label={all ? "Puntos repartidos" : "Mis puntos"} value={all ? d.total_clients : d.my_points} hint={all ? "1 por cliente" : "1 por cliente, dividido si es compartido"} />
            <Stat label="Compartidos conmigo" value={d.shared_clients} hint="clientes hechos con otros" />
            <Stat label="Mejor mes" value={(() => { const i = d.months.reduce((b, m, k) => (m.points > d.months[b].points ? k : b), 0); return d.months[i].points ? MES[i] : "—"; })()} hint="con más puntos" />
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold text-slate-800">{all ? "Clientes por mes (todos)" : "Mis puntos por mes"}</h3>
            <Bars values={d.months.map((m) => (all ? m.clients : m.points))} labels={MES} unit={all ? "clientes" : "puntos"} />
          </div>

          {all && (
            <div className="card space-y-3">
              <h3 className="font-semibold text-slate-800">Ranking por usuario</h3>
              {d.ranking.length === 0 ? <p className="text-sm text-slate-500">Todavía no hay clientes este año.</p> : (
                <ul className="space-y-2">
                  {d.ranking.map((r) => (
                    <li key={r.user_id} className="text-sm">
                      <div className="flex items-center justify-between gap-2"><span className="truncate font-medium text-slate-700">{r.name}</span><span className="shrink-0 text-xs text-slate-500">{r.clients} cliente(s) · <b>{r.points}</b> punto(s)</span></div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(r.points / maxRank) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="card space-y-2">
            <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-800">Últimos clientes</h3><Link className="text-xs text-brand-600 hover:underline" to={me.is_admin && all ? "/admin/clientes" : "/clientes"}>Ver todos</Link></div>
            {d.recent.length === 0 ? <p className="text-sm text-slate-500">Aún no hay clientes en {d.year}.</p> : (
              <ul className="divide-y divide-slate-100">
                {d.recent.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
                    <span className="font-semibold text-slate-800">SOT {c.sot}</span>
                    <span className="min-w-[120px] flex-1 text-slate-600">{c.nombre || "(sin nombre)"}</span>
                    <span className="text-xs text-slate-400">{c.fecha}</span>
                    <span className="text-xs text-slate-500">{(c.participants ?? []).map((p) => p.name).join(" + ")}{c.shared ? ` · ${c.point} c/u` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

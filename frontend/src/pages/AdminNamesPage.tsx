import { useState } from "react";
import { apiErrorMessage } from "../api/client";
import { setUiLabel, useUiLabels } from "../store/uiLabels";

/** Cada nombre de la interfaz que se puede cambiar: clave interna, dónde aparece y el nombre de fábrica. */
export const UI_NAMES: { group: string; key: string; def: string; where?: string }[] = [
  { group: "Menú", key: "grp.grafica", def: "Gráfica", where: "Grupo del menú" },
  { group: "Menú", key: "grp.checklist", def: "CheckList", where: "Grupo del menú" },
  { group: "Menú", key: "grp.rf", def: "Reporte fotográfico", where: "Grupo del menú" },
  { group: "Menú", key: "grp.clientes", def: "Mis clientes", where: "Grupo del menú" },
  { group: "Menú", key: "nav.plantillas", def: "Plantillas", where: "Opción del menú" },
  { group: "Reporte fotográfico (ventanas de fábrica)", key: "rf.gpon_ont", def: "GPON con ONT" },
  { group: "Reporte fotográfico (ventanas de fábrica)", key: "rf.gpon_modulo", def: "GPON con módulo" },
  { group: "Reporte fotográfico (ventanas de fábrica)", key: "rf.fibra", def: "Fibra convencional" },
  { group: "Reporte fotográfico (ventanas de fábrica)", key: "rf.poder_judicial", def: "RF Poder Judicial" },
];

/** Solo superadmin: cambiar el nombre de las partes fijas de la interfaz. (Los CheckList, las ventanas propias y las marcas de Gráfica se renombran en su propia pantalla.) */
export default function AdminNamesPage() {
  const { labels } = useUiLabels();
  const [msg, setMsg] = useState<Record<string, string>>({});
  const groups = Array.from(new Set(UI_NAMES.map((n) => n.group)));

  async function save(key: string, value: string) {
    if ((labels[key] ?? "") === value.trim()) return;
    try { await setUiLabel(key, value); setMsg((m) => ({ ...m, [key]: value.trim() ? "Guardado" : "Restablecido" })); }
    catch (e) { setMsg((m) => ({ ...m, [key]: apiErrorMessage(e, "No se pudo guardar.") })); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">Nombres de la interfaz</h2>
        <p className="text-sm text-slate-500">Cambia el texto de las partes fijas. Déjalo vacío para volver al nombre de fábrica. Se ve igual para todos.</p>
      </div>
      {groups.map((g) => (
        <div key={g} className="card space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">{g}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {UI_NAMES.filter((n) => n.group === g).map((n) => (
              <label key={n.key} className="block">
                <span className="label">{n.def}{n.where ? <span className="font-normal text-slate-400"> · {n.where}</span> : null}</span>
                <input className="input" defaultValue={labels[n.key] ?? ""} placeholder={n.def} key={`${n.key}:${labels[n.key] ?? ""}`}
                  onBlur={(e) => void save(n.key, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                {msg[n.key] && <span className="mt-0.5 block text-[11px] text-emerald-600" role="status">{msg[n.key]}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

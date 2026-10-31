import { useState } from "react";
import type { Opcion } from "../store/photoReportStore";

interface Manager {
  opciones: Opcion[];
  add: (label: string) => void;
  remove: (id: string) => void;
  rename: (id: string, label: string) => void;
  reset: () => void;
}

/** Lista editable de opciones del título (agregar, renombrar y borrar). */
export default function OpcionesManager({ manager }: { manager: Manager }) {
  const [text, setText] = useState("");

  function add() {
    manager.add(text);
    setText("");
  }

  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Opciones del título</h3>
          <p className="text-xs text-slate-500">
            El título del PDF es «REPORTE FOTOGRAFICO» + la opción elegida en cada foto. Valen para todas las ventanas.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => confirm("¿Volver a las opciones originales (SITE, PDI, POP, CLIENTE)?") && manager.reset()}
        >
          Restablecer
        </button>
      </div>

      <ul className="space-y-1">
        {manager.opciones.map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <input
              className="input flex-1"
              value={o.label}
              onChange={(e) => manager.rename(o.id, e.target.value)}
              onBlur={() => !o.label.trim() && manager.opciones.length > 1 && manager.remove(o.id)}
              aria-label="Texto de la opción"
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={manager.opciones.length <= 1}
              onClick={() => manager.remove(o.id)}
              title="Borrar opción"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Nueva opción, p. ej. INSTALACION EN NODO"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button type="button" className="btn-primary text-xs" onClick={add} disabled={!text.trim()}>
          ➕ Agregar
        </button>
      </div>
    </div>
  );
}

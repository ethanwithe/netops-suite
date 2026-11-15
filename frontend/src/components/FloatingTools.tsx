import { useState } from "react";
import FloatWindow from "./FloatWindow";
import SaturadorPanel from "./SaturadorPanel";
import TerminalWindow from "./TerminalWindow";
import { setDock, useDock } from "../store/terminal";

/** Ventanas flotantes globales: Terminal y Saturación (siguen abiertas al cambiar de página). */
export default function FloatingTools() {
  const dock = useDock();
  const [everTerm, setEverTerm] = useState(false);
  if (dock.terminal && !everTerm) setEverTerm(true);
  return (
    <>
      {(dock.terminal || everTerm) && (
        <div className={dock.terminal ? "" : "hidden"}>
          <FloatWindow id="terminal" title="Terminal" front={dock.front === "terminal"} onFocus={() => dock.front !== "terminal" && setDock({ front: "terminal" })}
            onClose={() => setDock({ terminal: false })} defaultGeo={{ x: 90, y: 70, w: 860, h: 560 }}>
            <TerminalWindow />
          </FloatWindow>
        </div>
      )}
      {/* la ventana de saturación se queda montada (oculta) para que no se corte al cerrarla */}
      <div className={dock.sat ? "" : "hidden"}>
        <FloatWindow id="saturacion" title="Saturación" front={dock.front === "sat"} onFocus={() => dock.front !== "sat" && setDock({ front: "sat" })}
          onClose={() => setDock({ sat: false })} defaultGeo={{ x: 140, y: 110, w: 780, h: 560 }}>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 [&>*]:shrink-0 [&>*:first-child]:shrink [&>*:first-child]:min-h-[22rem]">
            <SaturadorPanel big onRunning={(r) => setDock({ satRunning: r })} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={dock.manualSat} onChange={(e) => setDock({ manualSat: e.target.checked })} />
              Estoy saturando con otra herramienta (iperf, Ostinato…) y ya está al máximo
            </label>
          </div>
        </FloatWindow>
      </div>
    </>
  );
}

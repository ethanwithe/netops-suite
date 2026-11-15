import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openWindow, setDock, useDock, useTerminal } from "../store/terminal";

/** Botón «Herramientas» (al lado de Tema): abre las ventanas flotantes Terminal y Saturación. */
export default function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const dock = useDock();
  const t = useTerminal();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const n = e.target as Node; if (!box.current?.contains(n) && !menu.current?.contains(n)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const item = (w: "terminal" | "sat", label: string, on: boolean, hint: string) => (
    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
      onClick={() => { if (dock[w]) setDock({ [w]: false } as never); else openWindow(w); setOpen(false); }}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-green-500" : "bg-slate-300"}`} />
      <span className="flex-1">{label}<span className="block text-[11px] text-slate-400">{hint}</span></span>
      <span className="text-[11px] text-slate-400">{dock[w] ? "cerrar" : "abrir"}</span>
    </button>
  );

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => { const r = box.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); setOpen(!open); }}
        className="lg rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-cyan2-500 hover:bg-slate-50">
        Herramientas ▾
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" className="card z-[100] w-64 space-y-0.5 p-2" style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 100 }}>
          {item("terminal", "Terminal", t.connected, t.connected ? t.label : "Sin conexión")}
          {item("sat", "Saturación", dock.satRunning || dock.manualSat, dock.satRunning ? "Saturando ahora" : "Detenida")}
        </div>,
        document.body
      )}
    </div>
  );
}

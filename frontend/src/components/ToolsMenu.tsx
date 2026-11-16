import { useEffect, useRef, useState } from "react";
import { openWindow, setDock, useDock, useTerminal } from "../store/terminal";

/** Botón «Herramientas» (al lado de Tema): abre las ventanas flotantes Terminal y Saturación. */
export default function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dock = useDock();
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const t = useTerminal();

  // Atajos: Alt+Mayús+T abre/cierra la Terminal y Alt+Mayús+S la Saturación (funcionan aunque el cursor esté en la terminal)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      const w = key === "t" ? "terminal" : key === "s" ? "sat" : null;
      if (!w) return;
      e.preventDefault(); e.stopPropagation();
      if (dockRef.current[w]) setDock({ [w]: false } as never); else openWindow(w);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
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
      <span className="text-[11px] text-slate-400">{w === "terminal" ? "Alt+Mayús+T" : "Alt+Mayús+S"}</span>
    </button>
  );

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        className="lg rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-cyan2-500 hover:bg-slate-50">
        Herramientas ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 animate-pop rounded-xl border border-slate-200 bg-white p-1 shadow-soft">
          {item("terminal", "Terminal", t.connected, t.connected ? t.label : "Sin conexión")}
          {item("sat", "Saturación", dock.satRunning || dock.manualSat, dock.satRunning ? "Saturando ahora" : "Detenida")}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { THEME_OPTIONS, THEME_SWATCH, useTheme } from "../store/theme";
import { setMascot, useMascotSettings } from "../mascot/settings";
import LookPanel from "./LookPanel";

/** Selector de tema (claro / oscuro / océano / predeterminado) y acceso al asistente. */
export default function ThemeSwitcher() {
  const { pref, setTheme } = useTheme();
  const mascot = useMascotSettings();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"themes" | "look">("themes");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = THEME_OPTIONS.find((o) => o.id === pref)!;
  return (
    <div className="relative flex items-center gap-1" ref={box}>
      {mascot.hidden && (
        <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100" onClick={() => setMascot({ hidden: false })}>
          Asistente
        </button>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(!open); setView("themes"); }}
        className="lg rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-cyan2-500 hover:bg-slate-50"
      >
        Tema: {current.label}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 max-h-[80vh] w-64 animate-pop overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-soft">
          {view === "look" ? <LookPanel onBack={() => setView("themes")} /> : <>
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              role="menuitemradio"
              aria-checked={pref === o.id}
              onClick={() => { setTheme(o.id); setOpen(false); }}
              className={`lg flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${pref === o.id ? "font-semibold text-brand-700" : "text-slate-700"}`}
            >
              <span className="mr-3 h-6 w-6 shrink-0 rounded-full border border-white/40 shadow-sm" style={{ background: THEME_SWATCH[o.id] }} />
              <span className="flex-1">
                <span className="block">{o.label}</span>
                <span className="block text-[11px] font-normal text-slate-500">{o.hint}</span>
              </span>
              {pref === o.id && <span className="h-2 w-2 rounded-full bg-cyan2-400" />}
            </button>
          ))}
          <div className="my-1 border-t border-slate-200" />
          <button
            className="lg flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-slate-100"
            onClick={() => setView("look")}
          >
            Personalizar fondo y colores
            <span className="text-xs text-slate-500">›</span>
          </button>
          <button
            className="lg flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => { setMascot({ hidden: !mascot.hidden }); setOpen(false); }}
          >
            Asistente Bit
            <span className="text-xs text-slate-500">{mascot.hidden ? "Oculto" : "Visible"}</span>
          </button>
          </>}
        </div>
      )}
    </div>
  );
}

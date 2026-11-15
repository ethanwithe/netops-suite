import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePersistentState } from "../store/persistentState";

type Geo = { x: number; y: number; w: number; h: number };

/** Ventana flotante: se arrastra por la barra, se redimensiona por la esquina, se minimiza y se maximiza. En celular ocupa casi toda la pantalla. */
export default function FloatWindow({ id, title, onClose, children, front, onFocus, defaultGeo, extra }: {
  id: string; title: string; onClose: () => void; children: ReactNode; front: boolean; onFocus: () => void;
  defaultGeo?: Partial<Geo>; extra?: ReactNode;
}) {
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  const [geo, setGeo] = usePersistentState<Geo>(`win.${id}`, { x: 80, y: 70, w: 760, h: 520, ...defaultGeo });
  const [min, setMin] = useState(false);
  const [max, setMax] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // se mantiene dentro de la pantalla
  const clamp = (g: Geo): Geo => ({
    ...g,
    w: Math.min(Math.max(320, g.w), window.innerWidth - 8),
    h: Math.min(Math.max(220, g.h), window.innerHeight - 8),
    x: Math.min(Math.max(0, g.x), Math.max(0, window.innerWidth - 120)),
    y: Math.min(Math.max(0, g.y), Math.max(0, window.innerHeight - 40)),
  });

  useEffect(() => {
    const move = (e: PointerEvent) => { const d = drag.current; if (d) setGeo((g) => clamp({ ...g, x: e.clientX - d.dx, y: e.clientY - d.dy })); };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [setGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // el tamaño que el usuario le da con la esquina (resize CSS) se guarda
  useEffect(() => {
    const el = box.current;
    if (!el || max || small || min) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setGeo((g) => (Math.abs(g.w - r.width) > 2 || Math.abs(g.h - r.height) > 2 ? { ...g, w: Math.round(r.width), h: Math.round(r.height) } : g));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, small, min, setGeo]);

  const g = clamp(geo);
  const style: React.CSSProperties = small || max
    ? { left: small ? 4 : 8, top: small ? 56 : 8, width: `calc(100vw - ${small ? 8 : 16}px)`, height: min ? "auto" : `calc(100dvh - ${small ? 64 : 16}px)` }
    : { left: g.x, top: g.y, width: g.w, height: min ? "auto" : g.h, resize: min ? "none" : "both" };

  return (
    <div
      ref={box}
      role="dialog" aria-label={title}
      onPointerDown={onFocus}
      className={`fixed flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl dark:border-slate-600 ${front ? "z-[70]" : "z-[60]"}`}
      style={{ ...style, minWidth: 300, minHeight: min ? 0 : 200 }}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800"
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button,select,input")) return; if (small || max) return; drag.current = { dx: e.clientX - g.x, dy: e.clientY - g.y }; }}
        onDoubleClick={() => setMax((m) => !m)}
      >
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <span className="flex-1" />
        {extra}
        <button className="rounded px-2 text-slate-500 hover:bg-slate-200" title={min ? "Restaurar" : "Minimizar"} onClick={() => setMin(!min)}>{min ? "▢" : "–"}</button>
        {!small && <button className="rounded px-2 text-slate-500 hover:bg-slate-200" title={max ? "Reducir" : "Pantalla completa"} onClick={() => setMax(!max)}>{max ? "❐" : "□"}</button>}
        <button className="rounded px-2 text-slate-500 hover:bg-red-100 hover:text-red-600" title="Cerrar (la conexión sigue abierta)" onClick={onClose}>✕</button>
      </div>
      <div className={`min-h-0 flex-1 flex-col ${min ? "hidden" : "flex"}`}>{children}</div>
    </div>
  );
}

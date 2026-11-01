import { RefObject, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { THEME_OPTIONS, useTheme } from "../store/theme";
import { useOverlayOpen } from "./useOverlayOpen";

export interface DockItem { to: string; label: string }
export interface DockGroup { id: string; label: string; prefix: string; items: DockItem[] }

/**
 * Botones flotantes. Cada botón es una «rueda»: un clic va a la opción siguiente de su grupo
 * (por ejemplo Fotos: GPON con ONT → GPON con módulo → …), Mayús+clic va a la anterior.
 * Se ocultan solos cuando hay una ventana encima (editor, cámara, formularios).
 */
export default function FloatingDock({ scroller, groups }: { scroller: RefObject<HTMLElement>; groups: DockGroup[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { pref, setTheme } = useTheme();
  const overlay = useOverlayOpen();
  const [showUp, setShowUp] = useState(false);

  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const on = () => setShowUp(el.scrollTop > 320);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [scroller]);

  if (overlay) return null;

  const spin = (g: DockGroup, back: boolean) => {
    if (!g.items.length) return;
    const i = g.items.findIndex((it) => it.to === pathname);
    const n = g.items.length;
    const next = i < 0 ? 0 : (i + (back ? -1 : 1) + n) % n;
    navigate(g.items[next].to);
  };

  const themeIds = THEME_OPTIONS.map((o) => o.id);
  const spinTheme = (back: boolean) => {
    const i = themeIds.indexOf(pref);
    setTheme(themeIds[(i + (back ? -1 : 1) + themeIds.length) % themeIds.length]);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 left-3 z-30 max-w-[calc(100vw-90px)] lg:left-[17rem]">
      <div className="dock pointer-events-auto w-max max-w-full overflow-x-auto" role="toolbar" aria-label="Accesos rápidos">
        {groups.map((g) => {
          const i = g.items.findIndex((it) => it.to === pathname);
          const active = pathname.startsWith(g.prefix) || i >= 0;
          const next = g.items[(i < 0 ? 0 : (i + 1) % Math.max(1, g.items.length))];
          return (
            <button
              key={g.id} type="button" className={`fab ${active ? "fab-on" : ""}`}
              onClick={(e) => spin(g, e.shiftKey)}
              onContextMenu={(e) => { e.preventDefault(); spin(g, true); }}
              title={next ? `Clic: ${next.label} · Mayús+clic o clic derecho: anterior` : g.label}
            >
              {g.label}
              {active && i >= 0 && <span className="ml-1.5 text-[10px] font-semibold opacity-80">{i + 1}/{g.items.length}</span>}
            </button>
          );
        })}
        <button
          type="button" className="fab" onClick={(e) => spinTheme(e.shiftKey)} onContextMenu={(e) => { e.preventDefault(); spinTheme(true); }}
          title="Clic: siguiente tema · Mayús+clic: anterior"
        >
          Tema<span className="ml-1.5 text-[10px] font-semibold opacity-80">{THEME_OPTIONS.find((o) => o.id === pref)?.label}</span>
        </button>
        {showUp && <button type="button" className="fab fab-up" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}>Arriba</button>}
      </div>
    </div>
  );
}

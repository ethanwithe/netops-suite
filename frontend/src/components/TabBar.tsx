import { useLocation, useNavigate } from "react-router-dom";
import { useOverlayOpen } from "./useOverlayOpen";

export interface TabGroup { id: string; label: string; prefixes: string[]; items: { to: string; label: string }[] }

const ICON: Record<string, string> = {
  pn: "M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z",
  gr: "M4 19V5M4 19h16M8 15l3-4 3 2 5-7",
  ad: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3zM9 12l2 2 4-4",
  tl: "M4 5h16v10H4zM8 19h8M12 15v4",
  ck: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  ft: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  cl: "M16 19v-1.5a4 4 0 00-4-4H8a4 4 0 00-4 4V19M10 11a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM20 19v-1.5a3.5 3.5 0 00-2.5-3.3",
};

/**
 * Barra de pestañas flotante de cristal (como en iOS). Solo en pantallas pequeñas.
 * Cada toque en una pestaña pasa a la SIGUIENTE opción de ese grupo (la primera vez, la primera);
 * mantén pulsado o desliza hacia arriba no hace falta: Mayús+clic / clic derecho vuelve a la anterior.
 */
export default function TabBar({ groups, menuOpen, onMenu }: { groups: TabGroup[]; menuOpen: boolean; onMenu: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const overlay = useOverlayOpen();
  if (overlay) return null;

  const activeIdx = menuOpen ? groups.length : groups.findIndex((g) => g.prefixes.some((p) => pathname.startsWith(p)));
  const spin = (g: TabGroup, back: boolean) => {
    if (!g.items.length) return;
    const i = g.items.findIndex((it) => it.to === pathname);
    const n = g.items.length;
    const next = i < 0 ? 0 : (i + (back ? -1 : 1) + n) % n;
    if (menuOpen) onMenu();
    navigate(g.items[next].to);
    try { navigator.vibrate?.(8); } catch { /* sin vibración */ }
  };

  return (
    <nav className="tabbar lg:hidden" aria-label="Navegación principal" style={{ ["--n" as string]: groups.length + 1, ["--i" as string]: Math.max(0, activeIdx) }}>
      <span className="tab-pill" style={{ opacity: activeIdx < 0 ? 0 : 1 }} aria-hidden="true" />
      {groups.map((g, k) => {
        const on = k === activeIdx;
        const i = g.items.findIndex((it) => it.to === pathname);
        const next = g.items[i < 0 ? 0 : (i + 1) % g.items.length];
        return (
          <button
            key={g.id} type="button" className={`tab lg ${on ? "tab-on" : ""}`} aria-current={on ? "page" : undefined}
            onClick={(e) => spin(g, e.shiftKey)}
            onContextMenu={(e) => { e.preventDefault(); spin(g, true); }}
            title={next ? `Siguiente: ${next.label}` : g.label}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[g.id]} /></svg>
            <span>{g.label}{on && i >= 0 && g.items.length > 1 ? <em className="tab-count">{i + 1}/{g.items.length}</em> : null}</span>
          </button>
        );
      })}
      <button type="button" className={`tab lg ${menuOpen ? "tab-on" : ""}`} onClick={onMenu} aria-label={menuOpen ? "Cerrar el menú" : "Abrir el menú"} aria-expanded={menuOpen}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d={menuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
        </svg>
        <span>{menuOpen ? "Cerrar" : "Más"}</span>
      </button>
    </nav>
  );
}

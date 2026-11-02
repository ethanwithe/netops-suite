import { NavLink, useLocation } from "react-router-dom";
import { useOverlayOpen } from "./useOverlayOpen";

const TABS = [
  { to: "/pruebas", match: ["/pruebas", "/plantillas"], label: "Pruebas", d: "M4 5h16v10H4zM8 19h8M12 15v4" },
  { to: "/checklist", match: ["/checklist"], label: "CheckList", d: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" },
  { to: "/fotografico/gpon-ont", match: ["/fotografico"], label: "Fotos", d: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" },
  { to: "/clientes", match: ["/clientes"], label: "Clientes", d: "M16 19v-1.5a4 4 0 00-4-4H8a4 4 0 00-4 4V19M10 11a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM20 19v-1.5a3.5 3.5 0 00-2.5-3.3" },
];

/** Barra de pestañas flotante de cristal (como en iOS). Solo en pantallas pequeñas; se oculta con editores y cámara. */
export default function TabBar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation();
  const overlay = useOverlayOpen();
  if (overlay) return null;
  return (
    <nav className="tabbar lg:hidden" aria-label="Navegación principal">
      {TABS.map((t) => {
        const on = t.match.some((m) => pathname.startsWith(m));
        return (
          <NavLink key={t.to} to={t.to} className={`tab lg ${on ? "tab-on" : ""}`} aria-current={on ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.d} /></svg>
            <span>{t.label}</span>
          </NavLink>
        );
      })}
      <button type="button" className="tab lg" onClick={onMenu} aria-label="Abrir el menú">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        <span>Más</span>
      </button>
    </nav>
  );
}

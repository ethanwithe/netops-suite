import { RefObject, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { THEME_OPTIONS, useTheme } from "../store/theme";

/** Botones flotantes: atajos a las secciones, cambio rápido de tema y volver arriba. */
export default function FloatingDock({ scroller }: { scroller: RefObject<HTMLElement> }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { pref, setTheme } = useTheme();
  const [showUp, setShowUp] = useState(false);

  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const on = () => setShowUp(el.scrollTop > 320);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [scroller]);

  const items = [
    { to: "/clientes", label: "Clientes" },
    { to: "/checklist", label: "CheckList" },
    { to: "/fotografico/gpon-ont", label: "Fotos" },
  ];
  const next = () => {
    const ids = THEME_OPTIONS.map((o) => o.id);
    setTheme(ids[(ids.indexOf(pref) + 1) % ids.length]);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 left-3 z-30 max-w-[calc(100vw-90px)] lg:left-[17rem]">
      <div className="dock pointer-events-auto w-max max-w-full overflow-x-auto" role="toolbar" aria-label="Accesos rápidos">
        {items.map((it) => (
          <button key={it.to} type="button" className={`fab ${pathname.startsWith("/" + it.to.split("/")[1]) ? "fab-on" : ""}`} onClick={() => navigate(it.to)}>
            {it.label}
          </button>
        ))}
        <button type="button" className="fab" onClick={next} title="Cambiar de tema">Tema</button>
        {showUp && <button type="button" className="fab fab-up" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}>Arriba</button>}
      </div>
    </div>
  );
}

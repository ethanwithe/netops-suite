import { useEffect, useRef } from "react";

/** Vuelve a pedir datos cada cierto tiempo (y al volver a la pestaña) mientras la pantalla está visible: lo que otro equipo sube aparece solo. */
export function useAutoRefresh(fn: () => void, ms = 15000, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (document.visibilityState === "visible") ref.current(); };
    const t = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [ms, enabled]);
}

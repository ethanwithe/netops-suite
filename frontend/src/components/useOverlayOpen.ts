import { useEffect, useState } from "react";

const SELECTOR = '[role="dialog"]:not([data-persist]), .fixed.inset-0.z-50';

/** true mientras haya una ventana a pantalla completa (editor, cámara, formularios) abierta. */
export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setOpen(!!document.querySelector(SELECTOR)));
    };
    check();
    // solo importa cuando entra o sale un elemento (no cuando cambia texto: la salida del terminal muta el DOM sin parar)
    const relevant = (n: Node) => n instanceof Element && (n.matches(SELECTOR) || !!n.querySelector(SELECTOR));
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of Array.from(r.addedNodes)) if (relevant(n)) return check();
        for (const n of Array.from(r.removedNodes)) if (relevant(n)) return check();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return open;
}

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
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return open;
}

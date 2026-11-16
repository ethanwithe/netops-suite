import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { askChoice } from "../store/dialog";
import { pendingGuards } from "../store/workspaces";

/** Al ir a otra ventana con cambios sin guardar, pregunta si guardarlos (los enlaces internos de la app). */
export default function NavGuard() {
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    let busy = false;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, window.location.href);
      if (u.origin !== window.location.origin || u.pathname === loc.pathname) return;
      const pend = pendingGuards();
      if (!pend.length || busy) return;
      e.preventDefault(); e.stopPropagation();
      busy = true;
      void (async () => {
        const names = pend.map((g) => g.label()).join(", ");
        const r = await askChoice("Hay cambios sin guardar", `${names}\n\n¿Guardar los datos del cliente antes de cambiar de ventana?`, [
          { id: "save", label: "Guardar y salir", kind: "primary" },
          { id: "skip", label: "Salir sin guardar", kind: "danger" },
          { id: "cancel", label: "Quedarme aquí" },
        ]);
        busy = false;
        if (r === "save") {
          const oks = await Promise.all(pend.map((g) => g.save()));
          if (oks.some((o) => !o) && !confirm("No se pudo guardar todo (sin conexión). ¿Salir de todas formas?")) return;
        } else if (r !== "skip") return;
        navigate(u.pathname + u.search + u.hash);
      })();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [loc.pathname, navigate]);
  // Recargar o cerrar la pestaña con cambios sin guardar
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (pendingGuards().length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  return null;
}

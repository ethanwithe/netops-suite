import { useEffect, useState } from "react";
import { getAnnouncement } from "../store/system";
import type { Announcement } from "../store/system";

const STYLE: Record<string, string> = {
  info: "bg-sky-100 text-sky-900 border-sky-300",
  warn: "bg-amber-100 text-amber-900 border-amber-300",
  alert: "bg-red-100 text-red-900 border-red-300",
};

/** Franja con el anuncio del superadmin. Cada persona puede cerrarla (se vuelve a mostrar si el anuncio cambia). */
export default function AnnouncementBar() {
  const [a, setA] = useState<Announcement | null>(null);
  const [hidden, setHidden] = useState<string>(() => { try { return sessionStorage.getItem("netops.annHidden") || ""; } catch { return ""; } });
  useEffect(() => {
    let dead = false;
    const load = () => getAnnouncement().then((r) => { if (!dead) setA(r); }).catch(() => undefined);
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5 * 60_000);
    return () => { dead = true; window.clearInterval(t); };
  }, []);
  if (!a?.active || !a.text || hidden === a.id) return null;
  return (
    <div role="status" className={`flex items-start gap-2 border-b px-3 py-1.5 text-sm ${STYLE[a.level ?? "info"]}`}>
      <span className="flex-1">{a.level === "alert" ? "⚠ " : "📢 "}{a.text}</span>
      <button type="button" aria-label="Cerrar el anuncio" className="rounded px-1.5 font-bold hover:bg-black/10"
        onClick={() => { setHidden(a.id ?? ""); try { sessionStorage.setItem("netops.annHidden", a.id ?? ""); } catch { /* ignorar */ } }}>×</button>
    </div>
  );
}

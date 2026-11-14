import type { PointerEvent as RPointerEvent } from "react";

/**
 * Reordenar arrastrando (ratón y dedo). Los elementos destino llevan data-dnd="<tipo>" y data-dnd-id="<id>";
 * la «agarradera» llama a startDrag. Mientras se arrastra, el destino muestra una línea azul (data-over="before|after").
 */
export function startDrag(e: RPointerEvent, kind: string, id: string, onDrop: (targetId: string, after: boolean) => void) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const src = (e.currentTarget as HTMLElement).closest(`[data-dnd="${kind}"][data-dnd-id="${CSS.escape(id)}"]`) as HTMLElement | null;
  src?.setAttribute("data-dragging", "1");
  document.body.style.userSelect = "none";
  let over: HTMLElement | null = null;
  let target: { id: string; after: boolean } | null = null;
  let y = e.clientY;
  const clear = () => { over?.removeAttribute("data-over"); over = null; };

  const move = (ev: PointerEvent) => {
    y = ev.clientY;
    const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(`[data-dnd="${kind}"]`) as HTMLElement | null;
    if (!el || el.dataset.dndId === id) { clear(); target = null; return; }
    const r = el.getBoundingClientRect();
    const dy = ev.clientY - (r.top + r.height / 2);
    const after = dy > r.height * 0.25 || (Math.abs(dy) <= r.height * 0.25 && ev.clientX > r.left + r.width / 2);
    if (over !== el) clear();
    over = el;
    el.setAttribute("data-over", after ? "after" : "before");
    target = { id: el.dataset.dndId!, after };
  };
  // desplazamiento automático al acercarse al borde de la pantalla
  const tick = window.setInterval(() => {
    if (y < 90) window.scrollBy(0, -14); else if (y > window.innerHeight - 90) window.scrollBy(0, 14);
  }, 16);
  const end = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.clearInterval(tick);
    document.body.style.userSelect = "";
    src?.removeAttribute("data-dragging");
    clear();
    if (ev.type === "pointerup" && target) onDrop(target.id, target.after);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/** Agarradera de seis puntos (arrastrar para reordenar). */
export function Grip({ kind, id, onDrop, label = "Arrastra para cambiar el orden" }: { kind: string; id: string; onDrop: (targetId: string, after: boolean) => void; label?: string }) {
  return (
    <span
      role="button" tabIndex={-1} title={label} aria-label={label}
      onPointerDown={(e) => startDrag(e, kind, id, onDrop)}
      className="inline-flex h-7 w-6 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
    >
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
        {[2, 8, 14].flatMap((y) => [3, 9].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" />))}
      </svg>
    </span>
  );
}

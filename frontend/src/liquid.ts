/**
 * Efecto «cristal líquido» (inspirado en Liquid Glass de Apple): al pasar el cursor o el dedo, un brillo
 * especular sigue al puntero sobre la superficie, un destello recorre el borde y al pulsar se forma
 * una onda de agua desde el punto de contacto. Los estilos están en index.css (html[data-glass="on"]).
 */
const HOVER = ".btn-primary,.btn-secondary,.btn-danger,.side-item,.card,.lg,.tabbar";
const WAVE = ".btn-primary,.btn-secondary,.btn-danger,.side-item,.lg";

export function initLiquid(): () => void {
  let raf = 0;
  const move = (e: PointerEvent) => {
    const t = e.target as Element | null;
    if (!t || !t.closest) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const el = t.closest(HOVER) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  };
  const down = (e: PointerEvent) => {
    if (document.documentElement.dataset.glass === "off") return;
    const t = e.target as Element | null;
    const el = t?.closest?.(WAVE) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const w = document.createElement("span");
    w.className = "lg-wave";
    w.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px`;
    el.appendChild(w);
    window.setTimeout(() => w.remove(), 750);
  };
  const up = (e: PointerEvent) => {
    if (document.documentElement.dataset.glass === "off") return;
    const el = (e.target as Element | null)?.closest?.(".btn-primary,.btn-secondary,.btn-danger,.tab,.side-item") as HTMLElement | null;
    if (!el) return;
    el.classList.remove("lg-jelly"); void el.offsetWidth; el.classList.add("lg-jelly");
    window.setTimeout(() => el.classList.remove("lg-jelly"), 700);
  };
  window.addEventListener("pointerup", up, { passive: true });
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerdown", down, { passive: true });
  return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down); cancelAnimationFrame(raf); };
}

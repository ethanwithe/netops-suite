import { useEffect, useId, useRef } from "react";

type Kind = "bead" | "tear";
const TEAR = "M50 3 C50 3 14 46 14 66 A36 36 0 0 0 86 66 C86 46 50 3 50 3 Z";
const BEAD = "M50 12 A38 38 0 1 1 49.99 12 Z";

/** Gota de agua en 3D hecha con SVG: cuerpo translúcido, borde, luz concentrada, brillos y sombra. */
export function Drop({ size = 80, kind = "bead", className = "", style }: { size?: number; kind?: Kind; className?: string; style?: React.CSSProperties }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const d = kind === "tear" ? TEAR : BEAD;
  const c = (v: string, a: number) => `rgb(var(${v}) / ${a})`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`b${uid}`} cx=".38" cy=".3" r=".85">
          <stop offset="0" stopColor={c("--drop1", 0.42)} />
          <stop offset=".5" stopColor={c("--drop2", 0.82)} />
          <stop offset="1" stopColor={c("--drop3", 0.94)} />
        </radialGradient>
        <linearGradient id={`r${uid}`} x1=".15" y1=".05" x2=".85" y2=".95">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".4" stopColor="#fff" stopOpacity=".05" />
          <stop offset=".75" stopColor={c("--drop1", 0.25)} />
          <stop offset="1" stopColor={c("--drop1", 0.9)} />
        </linearGradient>
        <radialGradient id={`c${uid}`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor={c("--drop1", 0.6)} />
          <stop offset="1" stopColor={c("--drop1", 0)} />
        </radialGradient>
        <clipPath id={`k${uid}`}><path d={d} /></clipPath>
        <filter id={`f${uid}`}><feGaussianBlur stdDeviation=".7" /></filter>
      </defs>
      <path d={d} fill={`url(#b${uid})`} />
      <g clipPath={`url(#k${uid})`}>
        <ellipse cx="55" cy="84" rx="26" ry="11" fill={`url(#c${uid})`} />
        <ellipse cx="50" cy="96" rx="40" ry="12" fill={c("--drop3", 0.35)} />
      </g>
      <path d={d} fill="none" stroke={`url(#r${uid})`} strokeWidth="2.2" />
      <ellipse cx="34" cy="32" rx="13" ry="7.5" transform="rotate(-38 34 32)" fill="#fff" fillOpacity=".8" filter={`url(#f${uid})`} />
      <circle cx="27" cy="47" r="2.4" fill="#fff" fillOpacity=".7" />
      <ellipse cx="70" cy="74" rx="4.5" ry="2.4" transform="rotate(-38 70 74)" fill="#fff" fillOpacity=".55" />
    </svg>
  );
}

const SPLASH: [number, number][] = [[-0.9, -0.7], [-0.45, -1.1], [0.1, -1.25], [0.6, -1], [1, -0.55]];

const DROPS: { x: number; y: number; s: number; k: Kind; depth: number; dur: number; delay: number; o: number; cyc: number; cdelay: number }[] = [
  { x: 4, y: 12, s: 120, k: "bead", depth: 18, dur: 13, delay: 0, o: 0.7, cyc: 23, cdelay: -4 },
  { x: 86, y: 8, s: 84, k: "tear", depth: 26, dur: 11, delay: -3, o: 0.65, cyc: 31, cdelay: -17 },
  { x: 72, y: 34, s: 44, k: "bead", depth: 34, dur: 9, delay: -5, o: 0.6, cyc: 27, cdelay: -9 },
  { x: 92, y: 62, s: 150, k: "bead", depth: 14, dur: 15, delay: -2, o: 0.6, cyc: 37, cdelay: -24 },
  { x: 30, y: 78, s: 70, k: "tear", depth: 22, dur: 12, delay: -7, o: 0.6, cyc: 29, cdelay: -2 },
  { x: 55, y: 90, s: 40, k: "bead", depth: 30, dur: 10, delay: -4, o: 0.55, cyc: 34, cdelay: -13 },
  { x: 12, y: 52, s: 38, k: "bead", depth: 28, dur: 8.5, delay: -6, o: 0.55, cyc: 26, cdelay: -20 },
  { x: 48, y: 4, s: 52, k: "bead", depth: 20, dur: 14, delay: -9, o: 0.55, cyc: 41, cdelay: -30 },
];

/** Capa de fondo con gotas que flotan, siguen al cursor (parallax) y ondas al hacer clic. */
export default function WaterDrops() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (reduce) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = root.current; if (!el) return;
        el.style.setProperty("--px", String((e.clientX / window.innerWidth - 0.5) * 2));
        el.style.setProperty("--py", String((e.clientY / window.innerHeight - 0.5) * 2));
      });
    };
    let last = 0;
    const down = (e: PointerEvent) => {
      const now = Date.now(); if (reduce || now - last < 120) return; last = now;
      const r = document.createElement("span");
      r.className = "ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      document.body.appendChild(r);
      window.setTimeout(() => r.remove(), 800);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="drops" ref={root} aria-hidden="true">
      {DROPS.map((d, i) => (
        <div key={i} className="drop-wrap" style={{ left: `${d.x}%`, top: `${d.y}%`, ["--depth" as any]: d.depth, opacity: d.o }}>
          <div className="drop-in" style={{ ["--dur" as any]: `${d.dur}s`, ["--delay" as any]: `${d.delay}s`, width: d.s, height: d.s, position: "relative" }}>
            <div className="drop-sq" style={{ ["--cyc" as any]: `${d.cyc}s`, ["--cdelay" as any]: `${d.cdelay}s` }}>
              <Drop size={d.s} kind={d.k} />
            </div>
            <div className="splash" style={{ ["--cyc" as any]: `${d.cyc}s`, ["--cdelay" as any]: `${d.cdelay}s` }}>
              <span className="splash-ring" />
              {SPLASH.map((q, j) => <span key={j} className="splash-dot" style={{ ["--dx" as any]: `${q[0] * d.s * 0.5}px`, ["--dy" as any]: `${q[1] * d.s * 0.5}px` }} />)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useRef } from "react";
import { useLook } from "../store/look";
import WaterDrops from "./WaterDrops";

/** Números pseudoaleatorios repetibles (para que las escenas no cambien en cada render). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const v = (name: string, n: number | string) => ({ [`--${name}`]: n } as React.CSSProperties);

function Bubbles() {
  const items = useMemo(() => {
    const r = rng(7);
    return Array.from({ length: 16 }, () => ({ x: r() * 96, s: 28 + r() * r() * 150, dur: 24 + r() * 30, delay: -r() * 50, sway: 14 + r() * 40, depth: 8 + r() * 30 }));
  }, []);
  return <>{items.map((b, i) => (
    <div key={i} className="px-layer" style={{ left: `${b.x}%`, bottom: 0, ...v("depth", b.depth) }}>
      <div className="bubble" style={{ width: b.s, height: b.s, ...v("dur", `${b.dur}s`), ...v("delay", `${b.delay}s`), ...v("sway", `${b.sway}px`) }} />
    </div>
  ))}</>;
}

function Orbs() {
  const items = useMemo(() => [
    { x: 6, y: 14, s: 260, blur: 3, c: 0, depth: 10, dur: 22 },
    { x: 78, y: 6, s: 190, blur: 0, c: 1, depth: 26, dur: 17 },
    { x: 60, y: 58, s: 330, blur: 5, c: 2, depth: 8, dur: 28 },
    { x: 18, y: 66, s: 120, blur: 0, c: 1, depth: 34, dur: 14 },
    { x: 90, y: 74, s: 90, blur: 0, c: 0, depth: 38, dur: 12 },
    { x: 40, y: 22, s: 70, blur: 1, c: 2, depth: 30, dur: 15 },
  ], []);
  return <>{items.map((o, i) => (
    <div key={i} className="px-layer" style={{ left: `${o.x}%`, top: `${o.y}%`, ...v("depth", o.depth) }}>
      <div className={`orb orb-${o.c}`} style={{ width: o.s, height: o.s, filter: o.blur ? `blur(${o.blur}px)` : undefined, ...v("dur", `${o.dur}s`), ...v("delay", `${-i * 3}s`) }} />
    </div>
  ))}</>;
}

const WAVE = "M0 60 C 120 20, 240 100, 360 60 S 600 20, 720 60 S 960 100, 1080 60 S 1320 20, 1440 60 L1440 200 L0 200 Z";
function Waves() {
  const layers = [
    { c: "var(--bg3)", a: 0.22, h: 38, dur: 34, depth: 8, back: false },
    { c: "var(--bg1)", a: 0.26, h: 30, dur: 26, depth: 16, back: true },
    { c: "var(--bg2)", a: 0.32, h: 22, dur: 20, depth: 26, back: false },
  ];
  return <>{layers.map((l, i) => (
    <div key={i} className="wave-wrap" style={{ height: `${l.h}%`, ...v("depth", l.depth) }}>
      <svg className="wave" viewBox="0 0 1440 200" preserveAspectRatio="none" style={{ animationDuration: `${l.dur}s`, animationDirection: l.back ? "reverse" : "normal" }}>
        <defs>
          <linearGradient id={`wg${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`rgb(${l.c} / ${l.a + 0.18})`} />
            <stop offset="1" stopColor={`rgb(${l.c} / ${l.a * 0.4})`} />
          </linearGradient>
        </defs>
        <path d={WAVE} fill={`url(#wg${i})`} />
        <path d="M0 60 C 120 20, 240 100, 360 60 S 600 20, 720 60 S 960 100, 1080 60 S 1320 20, 1440 60" fill="none" stroke="rgb(255 255 255 / .35)" strokeWidth="2" />
      </svg>
    </div>
  ))}</>;
}

function Crystals() {
  const items = useMemo(() => [
    { x: 8, y: 18, s: 90, dur: 26, depth: 16 }, { x: 82, y: 12, s: 60, dur: 20, depth: 28 },
    { x: 70, y: 62, s: 110, dur: 32, depth: 12 }, { x: 22, y: 70, s: 54, dur: 22, depth: 30 },
    { x: 46, y: 8, s: 40, dur: 18, depth: 34 }, { x: 92, y: 80, s: 48, dur: 24, depth: 26 },
    { x: 54, y: 82, s: 70, dur: 28, depth: 18 },
  ], []);
  return <div className="persp">{items.map((c, i) => (
    <div key={i} className="px-layer" style={{ left: `${c.x}%`, top: `${c.y}%`, ...v("depth", c.depth) }}>
      <div className="cube-float" style={{ width: c.s, height: c.s, ...v("delay", `${-i * 4}s`) }}>
        <div className="cube" style={{ ...v("s", `${c.s}px`), ...v("dur", `${c.dur}s`), ...v("delay", `${-i * 5}s`) }}>
          {["f", "b", "r", "l", "t", "u"].map((f) => <i key={f} className={`cf cf-${f}`} />)}
        </div>
      </div>
    </div>
  ))}</div>;
}

function Stars() {
  const items = useMemo(() => {
    const r = rng(21);
    return Array.from({ length: 90 }, () => ({ x: r() * 100, y: r() * 100, s: 1 + r() * 3.2, d: 2 + r() * 5, delay: -r() * 8, depth: 4 + r() * 36, glow: r() > 0.86 }));
  }, []);
  return <>{items.map((s, i) => (
    <div key={i} className="px-layer" style={{ left: `${s.x}%`, top: `${s.y}%`, ...v("depth", s.depth) }}>
      <span className={`star ${s.glow ? "star-glow" : ""}`} style={{ width: s.s, height: s.s, ...v("dur", `${s.d}s`), ...v("delay", `${s.delay}s`) }} />
    </div>
  ))}</>;
}

/** Fondo de la aplicación: una escena 3D elegida + gotas opcionales, con parallax al mover el cursor. */
export default function Backdrop() {
  const look = useLook();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = root.current; if (!el) return;
        el.style.setProperty("--px", String((e.clientX / window.innerWidth - 0.5) * 2));
        el.style.setProperty("--py", String((e.clientY / window.innerHeight - 0.5) * 2));
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      {look.scene !== "none" && (
        <div className={`scene scene-${look.scene}`} ref={root} aria-hidden="true">
          {look.scene === "bubbles" && <Bubbles />}
          {look.scene === "orbs" && <Orbs />}
          {look.scene === "waves" && <Waves />}
          {look.scene === "crystals" && <Crystals />}
          {look.scene === "stars" && <Stars />}
        </div>
      )}
      {look.drops && <WaterDrops />}
    </>
  );
}

import { useEffect, useState } from "react";
import type { Mood } from "./brain";

interface Props {
  mood: Mood;
  talking?: boolean;
  blink?: boolean;
  look?: { x: number; y: number };
  size?: number;
  className?: string;
}

const INK: Partial<Record<Mood, string>> = { love: "#ff7eb3", angry: "#ff6b6b", think: "#ffd86b", listening: "#7dffb8", wow: "#9ff0ff", dizzy: "#c9a8ff" };

/** Robot original «Bit»: cabeza, visor LED, brazos y antena que reaccionan al estado de ánimo. */
export default function MascotFace({ mood, talking = false, blink = false, look = { x: 0, y: 0 }, size = 56, className = "" }: Props) {
  const ink = INK[mood] ?? "#38d0f7";
  const [mouthOpen, setMouthOpen] = useState(0);
  useEffect(() => {
    if (!talking) { setMouthOpen(0); return; }
    const t = window.setInterval(() => setMouthOpen(Math.random() < 0.2 ? 0.1 : 0.35 + Math.random() * 0.65), 110);
    return () => window.clearInterval(t);
  }, [talking]);

  const arc = (cx: number) => <path d={`M${cx - 6.5} 52 Q${cx} 41 ${cx + 6.5} 52`} stroke={ink} strokeWidth="4.2" strokeLinecap="round" fill="none" />;
  const eye = (cx: number, rx = 6, ry = 8) => (
    <g>
      <ellipse cx={cx} cy={49} rx={rx} ry={blink ? 0.9 : ry} fill={ink} />
      {!blink && <ellipse cx={cx - rx * 0.35} cy={49 - ry * 0.4} rx={rx * 0.28} ry={ry * 0.22} fill="#e8fbff" opacity=".9" />}
    </g>
  );
  const heart = (cx: number) => (
    <path className="mf-beat" style={{ transformOrigin: `${cx}px 49px` }} d={`M${cx} 57 C${cx - 13} 49 ${cx - 8} 39 ${cx} 45.5 C${cx + 8} 39 ${cx + 13} 49 ${cx} 57 Z`} fill={ink} />
  );
  const spiral = (cx: number) => (
    <path className="mf-spin" style={{ transformOrigin: `${cx}px 49px` }} d={`M${cx} 49 m0 0 a2 2 0 1 1 4 0 a4 4 0 1 1 -8 0 a6.5 6.5 0 1 1 13 0`} stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />
  );
  const line = (cx: number) => <path d={`M${cx - 6} 50 H${cx + 6}`} stroke={ink} strokeWidth="4" strokeLinecap="round" />;

  let eyes: JSX.Element;
  switch (mood) {
    case "happy": case "laugh": eyes = <>{arc(39)}{arc(61)}</>; break;
    case "wink": eyes = <>{eye(39)}{arc(61)}</>; break;
    case "surprised": eyes = <>{eye(39, 8, 9)}{eye(61, 8, 9)}</>; break;
    case "wow": eyes = <>{eye(39, 9, 10)}{eye(61, 9, 10)}<circle cx="29" cy="36" r="1.8" fill={ink} className="mf-twinkle" /><circle cx="72" cy="38" r="1.4" fill={ink} className="mf-twinkle" /></>; break;
    case "sad": eyes = <>{eye(39, 5.5, 6.5)}{eye(61, 5.5, 6.5)}<path d="M31 40 L45 44 M69 40 L55 44" stroke={ink} strokeWidth="2.4" strokeLinecap="round" /><path d="M33 58 q-2 5 0 7" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" className="mf-tear" /></>; break;
    case "think": eyes = <>{eye(39, 6, 8)}{eye(61, 5, 5.5)}<path d="M54 38 L68 36" stroke={ink} strokeWidth="2.6" strokeLinecap="round" /></>; break;
    case "smug": eyes = <>{eye(39)}{eye(61)}<rect x="30" y="39" width="42" height="9" fill="#0b1530" /><path d="M32 48 H46 M54 48 H68" stroke={ink} strokeWidth="2.4" strokeLinecap="round" /></>; break;
    case "sleepy": eyes = <>{line(39)}{line(61)}</>; break;
    case "love": eyes = <>{heart(39)}{heart(61)}<ellipse cx="29" cy="60" rx="4" ry="2.4" fill="#ff7eb3" opacity=".35" /><ellipse cx="71" cy="60" rx="4" ry="2.4" fill="#ff7eb3" opacity=".35" /></>; break;
    case "angry": eyes = <>{eye(39, 6, 6)}{eye(61, 6, 6)}<path d="M29 37 L46 45 M71 37 L54 45" stroke={ink} strokeWidth="3.4" strokeLinecap="round" /></>; break;
    case "dizzy": eyes = <>{spiral(39)}{spiral(61)}</>; break;
    case "listening": eyes = <>{eye(39, 6.5, 9.5)}{eye(61, 6.5, 9.5)}</>; break;
    default: eyes = <>{eye(39)}{eye(61)}</>;
  }

  const o = mouthOpen;
  let mouth: JSX.Element;
  if (mood === "laugh") mouth = <path d={`M41 58 Q50 ${70 + o * 8} 59 58 Z`} fill={ink} />;
  else if (talking) mouth = <ellipse cx="50" cy={60 + o * 2} rx={4 + o * 1.5} ry={0.8 + o * 4.2} fill={ink} />;
  else if (mood === "happy" || mood === "wink" || mood === "love") mouth = <path d="M43 60 Q50 67 57 60" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />;
  else if (mood === "sad") mouth = <path d="M44 64 Q50 58 56 64" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />;
  else if (mood === "angry") mouth = <path d="M43 64 L46 60 L50 64 L54 60 L57 64" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />;
  else if (mood === "surprised" || mood === "wow") mouth = <ellipse cx="50" cy="62" rx="3.6" ry="4.6" fill={ink} />;
  else if (mood === "smug") mouth = <path d="M44 62 Q52 64 58 58" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />;
  else if (mood === "dizzy") mouth = <path d="M42 62 q3.7 -4 7.3 0 t7.3 0" stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none" />;
  else if (mood === "think" || mood === "listening") mouth = <path d="M46 62 H54" stroke={ink} strokeWidth="3" strokeLinecap="round" />;
  else if (mood === "sleepy") mouth = <path d="M46 62 Q50 64 54 62" stroke={ink} strokeWidth="2.5" strokeLinecap="round" fill="none" />;
  else mouth = <path d="M44 61 Q50 65 56 61" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />;

  const armAnim = mood === "happy" || mood === "wink" || mood === "love" || mood === "wow" ? "mf-wave" : mood === "laugh" ? "mf-clap" : mood === "angry" ? "mf-stomp" : mood === "think" ? "mf-chin" : "";
  const headAnim = mood === "think" ? "mf-tilt" : mood === "angry" ? "mf-shake" : mood === "dizzy" ? "mf-sway" : mood === "listening" ? "mf-lean" : mood === "laugh" ? "mf-jig" : talking ? "mf-nod" : mood === "sad" ? "mf-droop" : "";
  const ear = mood === "listening" ? "#7dffb8" : "#2b72e6";

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="mf-head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dbe6f7" /></linearGradient>
        <filter id="mf-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {/* brazos */}
      <g className={armAnim === "mf-clap" || armAnim === "mf-stomp" ? armAnim : ""} style={{ transformOrigin: "31px 85px" }}>
        <rect x="20" y="82" width="9" height="14" rx="4.5" fill="url(#mf-head)" stroke="#b7c7e2" strokeWidth="1.2" />
      </g>
      <g className={armAnim === "mf-wave" || armAnim === "mf-chin" ? armAnim : armAnim === "mf-clap" ? "mf-clapR" : armAnim === "mf-stomp" ? "mf-stomp" : ""} style={{ transformOrigin: "69px 85px" }}>
        <rect x="71" y="82" width="9" height="14" rx="4.5" fill="url(#mf-head)" stroke="#b7c7e2" strokeWidth="1.2" />
      </g>
      {/* cuerpo */}
      <rect x="31" y="80" width="38" height="15" rx="8" fill="url(#mf-head)" stroke="#b7c7e2" strokeWidth="1.4" />
      <circle cx="50" cy="88" r="2.6" fill={ink} opacity=".9" className={talking ? "mf-twinkle" : ""} />
      {/* cabeza */}
      <g className={headAnim} style={{ transformOrigin: "50px 80px" }}>
        <path d="M50 20 V10" stroke="#9db3d6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="50" cy="7" r="4" fill={ink} filter="url(#mf-glow)" className={mood === "listening" || mood === "think" ? "mf-twinkle" : ""} />
        <rect x="5" y="42" width="9" height="20" rx="4.5" fill={ear} className={mood === "listening" ? "mf-twinkle" : ""} />
        <rect x="86" y="42" width="9" height="20" rx="4.5" fill={ear} className={mood === "listening" ? "mf-twinkle" : ""} />
        <rect x="12" y="19" width="76" height="62" rx="26" fill="url(#mf-head)" stroke="#b7c7e2" strokeWidth="1.6" />
        <rect x="21" y="30" width="58" height="40" rx="19" fill="#0b1530" />
        <g filter="url(#mf-glow)" style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: "transform .12s ease-out" }}>
          {eyes}{mouth}
        </g>
        <path d="M26 36 Q30 32 38 31" stroke="#ffffff" strokeOpacity=".25" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

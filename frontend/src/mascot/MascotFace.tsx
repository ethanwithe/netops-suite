import type { Mood } from "./brain";

interface Props {
  mood: Mood;
  talking?: boolean;
  blink?: boolean;
  look?: { x: number; y: number };
  size?: number;
  className?: string;
}

const CY = "#38d0f7";

/** Robot original «Bit»: cabeza blanca, visor oscuro y ojos LED que cambian de expresión. */
export default function MascotFace({ mood, talking = false, blink = false, look = { x: 0, y: 0 }, size = 56, className = "" }: Props) {
  const arc = (cx: number, up = true) => (
    <path d={up ? `M${cx - 6.5} 52 Q${cx} 41 ${cx + 6.5} 52` : `M${cx - 6.5} 46 Q${cx} 56 ${cx + 6.5} 46`} stroke={CY} strokeWidth="4.2" strokeLinecap="round" fill="none" />
  );
  const eye = (cx: number, rx = 6, ry = 8) => (
    <g>
      <ellipse cx={cx} cy={49} rx={rx} ry={blink ? 0.9 : ry} fill={CY} />
      {!blink && <ellipse cx={cx - rx * 0.35} cy={49 - ry * 0.4} rx={rx * 0.28} ry={ry * 0.22} fill="#e8fbff" opacity=".9" />}
    </g>
  );
  const line = (cx: number) => <path d={`M${cx - 6} 50 H${cx + 6}`} stroke={CY} strokeWidth="4" strokeLinecap="round" />;

  let eyes: JSX.Element;
  switch (mood) {
    case "happy": case "laugh":
      eyes = <>{arc(39)}{arc(61)}</>; break;
    case "wink":
      eyes = <>{eye(39)}{arc(61)}</>; break;
    case "surprised":
      eyes = <>{eye(39, 8, 9)}{eye(61, 8, 9)}</>; break;
    case "sad":
      eyes = <>{eye(39, 5.5, 6.5)}{eye(61, 5.5, 6.5)}<path d="M31 40 L45 44 M69 40 L55 44" stroke={CY} strokeWidth="2.4" strokeLinecap="round" /></>; break;
    case "think":
      eyes = <>{eye(39, 6, 8)}{eye(61, 5, 5.5)}<path d="M54 38 L68 36" stroke={CY} strokeWidth="2.6" strokeLinecap="round" /></>; break;
    case "smug":
      eyes = <>{eye(39)}{eye(61)}<rect x="30" y="39" width="42" height="9" fill="#0b1530" /><path d="M32 48 H46 M54 48 H68" stroke={CY} strokeWidth="2.4" strokeLinecap="round" /></>; break;
    case "sleepy":
      eyes = <>{line(39)}{line(61)}</>; break;
    default:
      eyes = <>{eye(39)}{eye(61)}</>;
  }

  const open = talking ? (mood === "laugh" ? 6 : 4) : 0;
  let mouth: JSX.Element;
  if (mood === "laugh") mouth = <path d="M41 58 Q50 76 59 58 Z" fill={CY} />;
  else if (talking) mouth = <ellipse cx="50" cy="61" rx="4.5" ry={open} fill={CY} />;
  else if (mood === "happy" || mood === "wink") mouth = <path d="M43 60 Q50 67 57 60" stroke={CY} strokeWidth="3" strokeLinecap="round" fill="none" />;
  else if (mood === "sad") mouth = <path d="M44 64 Q50 58 56 64" stroke={CY} strokeWidth="3" strokeLinecap="round" fill="none" />;
  else if (mood === "surprised") mouth = <ellipse cx="50" cy="62" rx="3.2" ry="4" fill={CY} />;
  else if (mood === "smug") mouth = <path d="M44 62 Q52 64 58 58" stroke={CY} strokeWidth="3" strokeLinecap="round" fill="none" />;
  else if (mood === "think") mouth = <path d="M45 62 H54" stroke={CY} strokeWidth="3" strokeLinecap="round" />;
  else if (mood === "sleepy") mouth = <path d="M46 62 Q50 64 54 62" stroke={CY} strokeWidth="2.5" strokeLinecap="round" fill="none" />;
  else mouth = <path d="M44 61 Q50 65 56 61" stroke={CY} strokeWidth="3" strokeLinecap="round" fill="none" />;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mf-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dbe6f7" />
        </linearGradient>
        <filter id="mf-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* antena */}
      <path d="M50 20 V10" stroke="#9db3d6" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="7" r="4" fill={CY} filter="url(#mf-glow)" />
      {/* orejas */}
      <rect x="5" y="42" width="9" height="20" rx="4.5" fill="#2b72e6" />
      <rect x="86" y="42" width="9" height="20" rx="4.5" fill="#2b72e6" />
      {/* cuerpo */}
      <rect x="31" y="80" width="38" height="15" rx="8" fill="url(#mf-head)" stroke="#b7c7e2" strokeWidth="1.4" />
      <circle cx="50" cy="88" r="2.6" fill={CY} opacity=".9" />
      {/* cabeza */}
      <rect x="12" y="19" width="76" height="62" rx="26" fill="url(#mf-head)" stroke="#b7c7e2" strokeWidth="1.6" />
      {/* visor */}
      <rect x="21" y="30" width="58" height="40" rx="19" fill="#0b1530" />
      <g filter="url(#mf-glow)" style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: "transform .12s ease-out" }}>
        {eyes}
        {mouth}
      </g>
      <path d="M26 36 Q30 32 38 31" stroke="#ffffff" strokeOpacity=".25" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

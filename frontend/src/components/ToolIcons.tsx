/** Iconos de trazo simple, al estilo de las formas de Word/Office (sin adornos). */
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const PATHS: Record<string, JSX.Element> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  line: <path d="M4 20L20 4" />,
  arrow: <><path d="M4 20L19 5" /><path d="M10 5h9v9" /></>,
  rect: <rect x="3.5" y="6" width="17" height="12" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6.5" />,
  text: <><path d="M5 6V4.5h14V6" /><path d="M12 4.5V20" /><path d="M9 20h6" /></>,
  round: <rect x="3.5" y="6" width="17" height="12" rx="4" />,
  diamond: <path d="M12 3.5L20.5 12 12 20.5 3.5 12z" />,
  triangle: <path d="M12 4L21 19H3z" />,
  dashed: <path d="M3 12h4M10 12h4M17 12h4" />,
  connect: <><rect x="2.5" y="4" width="7" height="6" /><rect x="14.5" y="14" width="7" height="6" /><path d="M9.5 7h3.5v10h1.5" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4.5 3.5 3L16 12l4 4" /></>,
  blur: <><rect x="4" y="4" width="16" height="16" strokeDasharray="2.5 2.5" /><circle cx="12" cy="12" r="2.5" /></>,
  crop: <><path d="M7 3v14h14" /><path d="M3 7h14v14" /></>,
};

export function ToolIcon({ name }: { name: string }) {
  const p = PATHS[name];
  return p ? <svg {...base}>{p}</svg> : null;
}
export const hasToolIcon = (name: string) => name in PATHS;

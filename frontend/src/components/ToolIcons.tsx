/** Iconos de trazo simple, al estilo de las formas de Word/Office (sin adornos). */
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const PATHS: Record<string, JSX.Element> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  line: <path d="M4 20L20 4" />,
  arrow: <><path d="M4 20L19 5" /><path d="M10 5h9v9" /></>,
  rect: <rect x="3.5" y="6" width="17" height="12" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6.5" />,
  blur: <><rect x="4" y="4" width="16" height="16" strokeDasharray="2.5 2.5" /><circle cx="12" cy="12" r="2.5" /></>,
  crop: <><path d="M7 3v14h14" /><path d="M3 7h14v14" /></>,
};

export function ToolIcon({ name }: { name: string }) {
  const p = PATHS[name];
  return p ? <svg {...base}>{p}</svg> : null;
}
export const hasToolIcon = (name: string) => name in PATHS;

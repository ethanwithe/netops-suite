// Memoria de Bit: aprende quién eres, tus gustos y tus hábitos (se guarda solo en este navegador).
import { useSyncExternalStore } from "react";

export interface Memory {
  name: string;
  facts: string[];               // datos estables: gustos, trabajo, preferencias…
  routes: Record<string, number>; // visitas por sección
  hours: number[];               // uso por hora del día (24)
  asked: boolean;                // ya le preguntó el nombre
  chats: number;                 // mensajes que le has escrito o dicho
}
const KEY = "netops.mascot.memory";
const EMPTY: Memory = { name: "", facts: [], routes: {}, hours: Array(24).fill(0), asked: false, chats: 0 };
const listeners = new Set<() => void>();

function load(): Memory {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch { /* sin almacenamiento */ }
  return { ...EMPTY, hours: Array(24).fill(0) };
}
let mem = load();
function save(m: Memory) {
  mem = m;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignorar */ }
  listeners.forEach((l) => l());
}
export const getMemory = () => mem;
export function useMemory() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => mem);
}

const clean = (s: string) => s.replace(/[\[\]\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, "").trim();

export function setName(n: string) {
  const v = clean(n).replace(/^(me llamo|mi nombre es|soy|llamame|me dicen)\s+/i, "");
  const name = v.split(" ").slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  if (name) save({ ...mem, name, asked: true });
  return name;
}
export function markAsked() { if (!mem.asked) save({ ...mem, asked: true }); }

export function remember(fact: string): boolean {
  const f = clean(fact);
  if (f.length < 4) return false;
  const n = norm(f);
  if (mem.facts.some((x) => norm(x) === n || norm(x).includes(n) || n.includes(norm(x)))) return false;
  save({ ...mem, facts: [...mem.facts, f].slice(-40) });
  return true;
}
export function forget(i: number) { save({ ...mem, facts: mem.facts.filter((_, j) => j !== i) }); }
export function forgetAll() { save({ ...EMPTY, hours: Array(24).fill(0), asked: true }); }

export function trackRoute(pathname: string) {
  const sec = "/" + pathname.split("/")[1];
  const hours = [...mem.hours]; hours[new Date().getHours()]++;
  save({ ...mem, routes: { ...mem.routes, [sec]: (mem.routes[sec] ?? 0) + 1 }, hours });
}
export function countChat() { save({ ...mem, chats: mem.chats + 1 }); }

const SECTION: Record<string, string> = { "/checklist": "CheckList", "/fotografico": "Reporte fotográfico", "/clientes": "Datos de cliente", "/pruebas": "Pruebas", "/plantillas": "Plantillas" };

/** Resumen de hábitos para que la IA los tenga en cuenta. */
export function habitsSummary(): string {
  const top = Object.entries(mem.routes).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, n]) => n >= 3).map(([r, n]) => `${SECTION[r] ?? r} (${n} visitas)`);
  const h = mem.hours; const peak = h.indexOf(Math.max(...h));
  const parts: string[] = [];
  if (top.length) parts.push("Secciones más usadas: " + top.join(", "));
  if (Math.max(...h) >= 5) parts.push(`suele usar la app hacia las ${peak}:00`);
  return parts.join("; ");
}
export function topSection(): { name: string; visits: number } | null {
  const e = Object.entries(mem.routes).sort((a, b) => b[1] - a[1])[0];
  return e && SECTION[e[0]] ? { name: SECTION[e[0]], visits: e[1] } : null;
}

/** Aprende, sin IA, de frases como «me llamo Ana», «me gusta el tema oscuro», «trabajo en Claro». */
export function learnFrom(text: string): string[] {
  const t = text.trim().replace(/\s+/g, " ");
  const learned: string[] = [];
  const add = (f: string) => { if (remember(f)) learned.push(f); };
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(?:me llamo|mi nombre es|ll[aá]mame|me dicen)\s+([A-Za-zÁÉÍÓÚáéíóúÑñ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]+)?)/i))) {
    const n = setName(m[1]); if (n) learned.push(`Se llama ${n}`);
  }
  if ((m = t.match(/\bno me gusta(?:n)?\s+(.{3,60}?)(?:[.,;!?]|$)/i))) add(`No le gusta ${m[1]}`);
  else if ((m = t.match(/\bme gusta(?:n)?\s+(.{3,60}?)(?:[.,;!?]|$)/i))) add(`Le gusta ${m[1]}`);
  if ((m = t.match(/\bprefiero\s+(.{3,60}?)(?:[.,;!?]|$)/i))) add(`Prefiere ${m[1]}`);
  if ((m = t.match(/\bmi\s+(color|comida|equipo|marca|m[uú]sica|juego|serie|pel[ií]cula|deporte)\s+favorit[oa]\s+es\s+(.{2,50}?)(?:[.,;!?]|$)/i))) add(`Su ${m[1]} favorito es ${m[2]}`);
  if ((m = t.match(/\btrabajo\s+(en|como|de|para)\s+(.{3,50}?)(?:[.,;!?]|$)/i))) add(`Trabaja ${m[1]} ${m[2]}`);
  if ((m = t.match(/\bsoy\s+(?:de|del)\s+(.{3,40}?)(?:[.,;!?]|$)/i))) add(`Es de ${m[1]}`);
  if ((m = t.match(/\bsoy\s+(t[eé]cnic[oa]|ingenier[oa]|estudiante|supervisor[a]?|jefe|instalador[a]?|analista|programador[a]?)\b/i))) add(`Es ${m[1].toLowerCase()}`);
  if ((m = t.match(/\bmi cliente (?:principal|favorito|m[aá]s importante) es\s+(.{3,50}?)(?:[.,;!?]|$)/i))) add(`Su cliente principal es ${m[1]}`);
  if ((m = t.match(/\bhabla(?:me)?\s+(m[aá]s\s+\w+|con\s+\w+\s*\w*)/i))) add(`Prefiere que le hablen ${m[1]}`);
  return learned;
}

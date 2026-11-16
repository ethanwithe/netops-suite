/**
 * Enlace de datos entre ventanas: el CheckList guarda sus parámetros con nombres como WAN o NEXTHOP y la Gráfica
 * con otros (SUB INTERFACE, IP WAN CLARO…). Aquí se dicen cuáles son lo mismo para que lo que se llena en una
 * aparezca en la otra.
 */
export const DATOS_ALIAS: [string, string][] = [
  ["WAN", "SUB INTERFACE"],
  ["NEXTHOP", "IP WAN CLARO"],
  ["LAN", "PUERTO RJ45"],
  ["MODELO", "MODELO ROUTER"],
];

const up = (s: string) => s.trim().toUpperCase();

/** Pone cada dato también con el nombre de la otra ventana (sin pisar lo que ya exista). */
export function expandDatos(d: Record<string, string> | undefined | null): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(d ?? {})) if (v != null && String(v).trim()) o[up(k)] = String(v).trim();
  for (const [a, b] of DATOS_ALIAS) {
    if (o[a] && !o[b]) o[b] = o[a];
    else if (o[b] && !o[a]) o[a] = o[b];
  }
  return o;
}

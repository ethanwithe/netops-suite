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

/** Datos conocidos que se pueden editar en «Mis clientes» aunque estén vacíos (los que no estén aquí salen como «otros datos»). */
export const CAMPOS_DATOS: { titulo: string; campos: string[] }[] = [
  { titulo: "Servicio y sede", campos: ["SERVICIO", "SEDE", "DIRECCION", "CONTACTO"] },
  { titulo: "Red del proveedor y cliente", campos: ["POP", "OLT", "IP WAN CLARO", "IP WAN CPE", "RED WAN", "RED LAN", "VLAN", "SUB INTERFACE", "PUERTO RJ45", "IP LAN GW", "IP LAN SW"] },
  { titulo: "Equipo", campos: ["MODELO ROUTER", "MARCA ONT", "MODELO", "ANCHO_MBPS"] },
  { titulo: "CheckList (parámetros de los comandos)", campos: ["WAN", "LAN", "NEXTHOP", "REMOTE", "INTERNET", "MRA", "BGP_PEER", "VRF"] },
];

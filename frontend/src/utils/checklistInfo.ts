/** Datos que se sacan solos de lo que devuelve el equipo (modelo, ancho de banda) y utilidades del checklist. */

export const VENDOR_LABEL: Record<string, string> = {
  huawei: "Huawei",
  cisco: "CISCO",
  fortinet: "Fortinet",
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "2026-10-31" -> "31 de Octubre de 2026" */
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

export const hoyISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Reemplaza {WAN}, {NEXTHOP}... Devuelve también las claves que faltan. */
export function fillCmd(cmd: string, params: Record<string, string>): { cmd: string; missing: string[] } {
  const missing: string[] = [];
  const out = cmd.replace(/\{([A-Z_]+)\}/g, (_m, k: string) => {
    const v = (params[k] ?? "").trim();
    if (!v) missing.push(k);
    return v;
  });
  return { cmd: out, missing };
}

/** Modelo del equipo a partir de display device / version / inventory / get system status. */
export function extractModel(vendor: string, text: string): string {
  let m: RegExpExecArray | null;
  if (vendor === "huawei") {
    m = /\b(AR\d{3,4}[A-Z0-9\-]*)\b/.exec(text);
    if (m) return m[1];
  } else if (vendor === "cisco") {
    m = /PID:\s*([A-Z0-9][\w\-/]+)/.exec(text) || /[Cc]isco\s+([A-Z0-9][\w\-/]+)\s*\(/.exec(text);
    if (m) return m[1];
  } else if (vendor === "fortinet") {
    m = /Version:\s*(Forti\w+-?\w*)/.exec(text);
    if (m) return m[1];
  }
  return "";
}

/** Bloque de configuración de una interfaz (hasta el siguiente "#" o "!"). */
function ifaceBlock(config: string, iface: string): string {
  if (!iface.trim()) return "";
  const esc = iface.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*interface\\s+${esc}\\s*$([\\s\\S]*?)(?=^\\s*(?:#|!|interface\\s)|$(?![\\s\\S]))`, "im");
  const m = re.exec(config);
  return m ? m[1] : "";
}

/** Ancho de banda en Mbps: descripción de la sub-interfaz ("200 MBPS"), bandwidth, shape o gts/car. */
export function extractBandwidthMbps(vendor: string, config: string, wan: string): string {
  const block = ifaceBlock(config, wan);
  const scopes = [block, config];
  for (const sc of scopes) {
    if (!sc) continue;
    let m = /description[^\n]*?(\d+(?:[.,]\d+)?)\s*(?:MBPS|MB|MBP|MEGAS?|M\b)/i.exec(sc);
    if (m) return m[1].replace(",", ".");
    m = /\bbandwidth\s+(\d+)\b/.exec(sc); // Cisco: kbps
    if (m && vendor === "cisco") return trim(Number(m[1]) / 1000);
    m = /shape average\s+(\d+)/i.exec(sc); // Cisco: bps
    if (m) return trim(Number(m[1]) / 1e6);
    m = /\b(?:gts|car)\s+cir\s+(\d+)/i.exec(sc); // Huawei: kbps
    if (m) return trim(Number(m[1]) / 1024);
  }
  return "";
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

export function servicioLabel(servicio: string, vendor: string, ancho: string, modelo: string): string {
  const s = servicio === "rpv" ? "RPV" : "Internet";
  const bw = ancho.trim() ? ` ${ancho.trim()}Mbps` : "";
  const cpe = `${VENDOR_LABEL[vendor] ?? vendor} ${modelo}`.trim();
  return `Servicio ${s}${bw} - CPE ${cpe}`;
}


/** ¿El ítem solo vale con la saturación activa? (estadísticas de interfaz WAN/LAN) */
export function isSatItem(it: { sat?: boolean; nombre: string; cmd: string }): boolean {
  if (typeof it.sat === "boolean") return it.sat;
  return /\[(WAN|LAN)\s+Interface\]/i.test(it.nombre);
}

/** Tasa de entrada/salida (Mbps) que muestra el router en "display interface" / "show interfaces". */
export function parseRates(out: string): { inMbps: number; outMbps: number } | null {
  const re = /(?:last\s+\d+\s+seconds?|\d+\s+(?:second|minute)s?)\s+(input|output)\s+rate\s*:?\s*(\d+)\s*bits?\/sec/gi;
  let inB = -1, outB = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    const v = Number(m[2]);
    if (m[1].toLowerCase() === "input") inB = Math.max(inB, v);
    else outB = Math.max(outB, v);
  }
  if (inB < 0 && outB < 0) return null;
  return { inMbps: Math.max(inB, 0) / 1e6, outMbps: Math.max(outB, 0) / 1e6 };
}

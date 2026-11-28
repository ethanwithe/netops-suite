/** Colores tipo MobaXterm para la salida de la terminal (los mismos que lleva el PDF/Word del CheckList):
 *  IPs, MAC, interfaces, up/down, errores, comentarios «!», palabras de configuración y el nombre del equipo (prompt). */
type Name = "ip" | "mac" | "iface" | "ok" | "bad" | "kw" | "comment" | "prompt";

const RULES: [Name, RegExp][] = [
  ["bad", /\b(?:down|DOWN|Down|notconnect|err-disabled|deleted|failed|FAILED|Failed|error|Error|ERROR|unreachable|Unreachable|invalid|Invalid|timeout|Timeout)\b|\badministratively down\b/g],
  ["ok", /\b(?:up|UP|Up|connected|established|Established|ESTABLISHED|operational|Success|success)\b|!{3,}|\b100 percent\b/g],
  ["ip", /\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/g],
  ["mac", /\b[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\b|\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}\b|\b[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}\b/g],
  ["ip", /\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){3,7}(?:\/\d{1,3})?\b/g],
  ["iface", /\b(?:(?:Gigabit|TenGigabit|TwentyFiveGig|HundredGig|Fast)?Ethernet|Port-channel|Loopback|Tunnel|Serial|Vlanif|Vlan|Eth-Trunk|GigabitEthernet|XGigabitEthernet|MEth|GE|XGE|Gi|Te|Fa|Eth|Po|Lo|Vl|ae|xe|ge|et)-?\d[\d/.:]*/g],
  ["kw", /^\s*(?:interface|ip address|ip route|description|shutdown|no shutdown|router|network|neighbor|vlan|speed|duplex|switchport|sysname|undo|display|bandwidth)\b/g],
];

const DARK: Record<Name, string> = { ip: "#4fc3f7", mac: "#4dd0e1", iface: "#ffd54f", ok: "#66ff66", bad: "#ff6b6b", kw: "#ce93d8", comment: "#888888", prompt: "#59d858" };
const LIGHT: Record<Name, string> = { ip: "#0b61c4", mac: "#00838f", iface: "#b05c00", ok: "#0a8a1f", bad: "#d01010", kw: "#7b1fa2", comment: "#7a7a7a", prompt: "#6a1b9a" };

const PROMPT = /^(<[^<>\s]{1,60}>|\[[^\[\]\s]{1,60}\]|[\w.()/:@-]{1,60}?[#>$])(?=\S|\s|$)/;

/** Color por carácter (cadena vacía = sin color propio). */
export function colorMap(text: string, dark: boolean): string[] {
  const pal = dark ? DARK : LIGHT;
  const out: string[] = new Array(text.length).fill("");
  if (!text.trim()) return out;
  if (text.trimStart().startsWith("!") && !/^\s*!{3,}\s*$/.test(text)) return out.fill(pal.comment);
  const taken = new Array<boolean>(text.length).fill(false);
  const m = PROMPT.exec(text);
  if (m) {
    for (let i = 0; i < m[1].length; i++) { taken[i] = true; out[i] = pal.prompt; }
  }
  for (const [name, rx] of RULES) {
    rx.lastIndex = 0;
    let r: RegExpExecArray | null;
    while ((r = rx.exec(text))) {
      const a = r.index, b = a + r[0].length;
      if (b <= a) { rx.lastIndex++; continue; }
      let busy = false;
      for (let i = a; i < b; i++) if (taken[i]) { busy = true; break; }
      if (busy) continue;
      for (let i = a; i < b; i++) { taken[i] = true; out[i] = pal[name]; }
    }
  }
  return out;
}

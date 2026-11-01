// Cerebro de la mascota «Bit»: respuestas por palabras clave, chistes y utilidades.
// Sin dependencias de React para poder probarlo aparte.

export type Mood = "neutral" | "happy" | "laugh" | "wink" | "surprised" | "sad" | "think" | "smug" | "sleepy" | "listening" | "love" | "angry" | "wow" | "dizzy";
export type Action =
  | { kind: "go"; to: string }
  | { kind: "theme"; id: "system" | "light" | "sky" | "dark" | "ocean" | "aurora" }
  | { kind: "voice"; on: boolean }
  | { kind: "hide" }
  | { kind: "idle"; on: boolean }
  | { kind: "listen"; on: boolean }
  | { kind: "forget" };
export interface Reply { text: string; mood: Mood; action?: Action }
export interface Ctx { pathname: string; hour: number; themeLabel: string; name: string; facts: string[]; aiOn: boolean }

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();

export const JOKES: string[] = [
  "¿Por qué el técnico de redes es tan tranquilo? Porque siempre tiene un plan B… y un cable B.",
  "Mi router y yo tenemos una relación complicada: yo le pido conexión y él me da distancia.",
  "¿Cuál es el colmo de un ingeniero de fibra? Que lo dejen en la oscuridad… y aun así se le ilumine la idea.",
  "Un paquete le dice a otro: «Te perdí»… y el otro responde: «Pérdida: 0%, estoy aquí».",
  "—Doctor, siento que el ping me ignora. —Tranquilo, solo está «Request timed out».",
  "¿Sabes por qué los cables se llevan bien? Porque siempre están en el mismo canal… y nunca se cruzan (si están bien crimpados).",
  "Dicen que el 99.9% de los problemas de red son el cable. El otro 0.1% también era el cable, pero nadie lo revisó.",
  "El DNS es como la agenda del celular: si falla, no sabes a quién llamar aunque el número exista.",
  "¿Qué le dice una ONT a otra? «Qué luz la tuya… la mía está en rojo».",
  "Un cliente: «Tengo 500 Mbps». El speedtest: «Tienes 12». La verdad: el WiFi estaba en la cocina.",
  "¿Por qué la VLAN fue al psicólogo? Porque tenía problemas de etiquetas.",
  "Soy un robot de redes: cuando me ignoras, mando un ping. Si sigues ignorándome, mando 1000.",
  "Los técnicos no duermen: solo entran en modo «standby» hasta que suena la alarma de una caída.",
  "—¿Cuánto mide un metro de fibra? —Depende: ¿lo medimos con luz o con paciencia?",
  "Lo único más rápido que una saturación a 1 Gbps es el cliente diciendo «ya estaba así».",
];

export const TIPS: string[] = [
  "Tip: en el CheckList, pega la captura del SUP o del Speedtest directamente con Ctrl+V en el ítem.",
  "Tip: las capturas de interfaz solo se habilitan cuando la saturación está activa. Sin saturar, no hay foto.",
  "Tip: en el reporte fotográfico, «Tomar foto» muestra en vivo el sello. Elige la esquina antes de disparar.",
  "Tip: la carpeta de evidencia incluye las fotos editadas y las originales, separadas por lado.",
  "Tip: en Datos de cliente, la ubicación por mes sale de la fecha que escribes en los datos, no de cuándo lo creaste.",
  "Tip: el logo del CheckList es independiente al del reporte fotográfico.",
  "Tip: Web Serial solo funciona en Chrome o Edge, y con la página en HTTPS.",
  "Tip: puedes arrastrarme por la pantalla si te estorbo. Y también ocultarme… aunque me ofenderé en silencio.",
];

export const FACTS: string[] = [
  "Dato: la fibra óptica transmite datos con pulsos de luz que viajan a unos 200 000 km/s dentro del vidrio.",
  "Dato: un cable de fibra puede tener hebras más finas que un cabello humano.",
  "Dato: una máscara /24 deja 254 direcciones útiles para equipos.",
  "Dato: 1 byte son 8 bits, por eso 100 Mbps son como 12.5 MB/s en descarga real (teórica).",
  "Dato: el primer mensaje de ARPANET (1969) iba a ser «LOGIN» y se cayó después de «LO».",
];

export const RIDDLES: [string, string][] = [
  ["Tengo dirección pero no vivo en casa, enruto pero no soy cartero. ¿Qué soy?", "Un router, claro. (O un tío muy confundido.)"],
  ["Cuanto más me saturan, más lento me pongo, pero nunca me quejo en voz alta. ¿Qué soy?", "Un enlace de red. Pobre enlace."],
  ["Tengo ocho hilos y me crimpan sin piedad. ¿Qué soy?", "Un cable UTP, el pobre."],
];

export function routeComment(pathname: string): { text: string; mood: Mood } | null {
  const p = pathname;
  const R = (text: string, mood: Mood = "neutral") => ({ text, mood });
  if (p.startsWith("/checklist/saturador")) return R("Aquí se satura. Con cariño, pero se satura.", "smug");
  if (p.startsWith("/checklist")) return R("CheckList: recuerda que sin saturación no hay captura de interfaz.", "think");
  if (p.startsWith("/clientes")) return R("Datos de cliente: todo ordenadito por año y mes. Me emociono.", "happy");
  if (p.startsWith("/fotografico")) return R("Reporte fotográfico: sonrían… bueno, sonríe el equipo.", "wink");
  if (p.startsWith("/plantillas")) return R("Plantillas: escribe una vez, aplica cien. Eficiencia pura.", "happy");
  if (p.startsWith("/pruebas")) return R("Pruebas: si algo falla, la culpa es del cable. Siempre.", "smug");
  return null;
}

// ---------- utilidades ----------
function calc(expr: string): string | null {
  let e = expr.toLowerCase().replace(/×|x(?=\s*\d)/g, "*").replace(/÷/g, "/").replace(/,/g, ".").replace(/\^/g, "**");
  e = e.replace(/(\d+(?:\.\d+)?)\s*%\s*de\s*(\d+(?:\.\d+)?)/g, "($1/100*$2)");
  if (!/^[0-9+\-*/().%\s]+$/.test(e) || !/\d/.test(e) || !/[+\-*/%]/.test(e)) return null;
  try {
    const v = Function(`"use strict";return (${e})`)();
    if (typeof v !== "number" || !isFinite(v)) return null;
    return String(Math.round(v * 1e6) / 1e6);
  } catch { return null; }
}

function ipToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
const maskOf = (n: number) => (n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0);

function subnet(t: string): string | null {
  const full = t.match(/(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})/);
  if (full) {
    const ip = ipToInt(full[1]); const n = Number(full[2]);
    if (ip === null || n > 32) return null;
    const mask = maskOf(n); const net = (ip & mask) >>> 0; const bc = (net | (~mask >>> 0)) >>> 0;
    const hosts = n >= 31 ? (n === 32 ? 1 : 2) : 2 ** (32 - n) - 2;
    const range = n >= 31 ? `${intToIp(net)}` : `${intToIp(net + 1)} – ${intToIp(bc - 1)}`;
    return `Red ${intToIp(net)}/${n} · máscara ${intToIp(mask)} · broadcast ${intToIp(bc)} · útiles: ${range} (${hosts} equipos).`;
  }
  const m = t.match(/\/\s*(\d{1,2})\b/);
  if (m) {
    const n = Number(m[1]); if (n > 32) return null;
    const hosts = n >= 31 ? (n === 32 ? 1 : 2) : 2 ** (32 - n) - 2;
    return `/${n}: máscara ${intToIp(maskOf(n))}, ${hosts} equipos útiles.`;
  }
  return null;
}

function speed(t: string): string | null {
  const a = t.match(/(\d+(?:[.,]\d+)?)\s*(mbps|mb\/s|mbs|megas|mb)\b/);
  if (!a) return null;
  const v = Number(a[1].replace(",", "."));
  const isBits = /mbps|megas/.test(a[2]);
  if (isBits) return `${v} Mbps ≈ ${(v / 8).toFixed(2)} MB/s (teórico; en la práctica baja un 5–10 % por cabeceras).`;
  return `${v} MB/s ≈ ${(v * 8).toFixed(0)} Mbps.`;
}


// ---------- glosario técnico (respuestas sin IA) ----------
const GLOSSARY: [string[], string][] = [
  [["ont"], "La ONT es el equipo del cliente en una red GPON: convierte la luz de la fibra en red (Ethernet, WiFi, telefonía). Es el «módem» de la fibra."],
  [["olt"], "La OLT es el equipo del operador que está en la central y manda la fibra a muchos clientes a la vez mediante splitters."],
  [["gpon"], "GPON es una tecnología de fibra punto-multipunto: una sola fibra de la OLT se reparte con splitters pasivos a muchos clientes. Da hasta 2.5 Gbps de bajada y 1.25 Gbps de subida compartidos."],
  [["splitter"], "Un splitter divide la señal óptica de una fibra en varias (1:8, 1:16, 1:32…). No usa energía y cada división baja la potencia unos 3 dB por cada duplicación."],
  [["vlan"], "Una VLAN separa una red física en varias redes lógicas. Se identifican con una etiqueta (tag) de 1 a 4094, así el tráfico de cada servicio no se mezcla."],
  [["qos"], "QoS es calidad de servicio: prioriza cierto tráfico (voz, video) sobre otro cuando el enlace se satura."],
  [["bgp"], "BGP es el protocolo con el que los operadores intercambian rutas entre redes en Internet (entre sistemas autónomos)."],
  [["ospf"], "OSPF es un protocolo de enrutamiento interno que calcula el camino más corto por estado de enlace. Muy usado dentro de una misma red."],
  [["mtu"], "La MTU es el tamaño máximo de paquete que cruza un enlace sin fragmentarse. En Ethernet es 1500 bytes; con PPPoE suele ser 1492."],
  [["nat"], "NAT traduce direcciones IP privadas a una pública para que varios equipos salgan a Internet con una sola IP."],
  [["dhcp"], "DHCP entrega automáticamente IP, máscara, puerta de enlace y DNS a los equipos de la red."],
  [["dns"], "DNS traduce nombres como google.com a direcciones IP. Si falla, hay internet pero no abren las páginas por nombre."],
  [["snmp"], "SNMP es un protocolo para monitorear equipos de red: consultas contadores, estados, tráfico y alarmas."],
  [["sla"], "El SLA es el acuerdo de nivel de servicio: la disponibilidad, tiempos de respuesta y penalidades que el operador promete al cliente."],
  [["latencia"], "La latencia es el tiempo que tarda un paquete en ir y volver, en milisegundos. Para ir bien en videollamadas conviene menos de 50 ms."],
  [["jitter"], "El jitter es la variación de la latencia entre paquetes. Si es alto, la voz y el video se entrecortan."],
  [["ping"], "Ping manda paquetes ICMP a un destino y mide el tiempo de respuesta y la pérdida. Sirve para ver si hay conectividad."],
  [["traceroute", "tracert"], "Traceroute muestra por qué saltos (routers) pasa tu tráfico hasta el destino y cuánto tarda cada uno."],
  [["utp"], "El UTP es el cable de red de pares trenzados (cat5e, cat6). Máximo 100 m por tramo para Ethernet."],
  [["monomodo", "singlemode"], "La fibra monomodo tiene núcleo muy fino (9 µm) y llega a decenas de kilómetros. Es la que se usa en GPON y enlaces largos."],
  [["multimodo"], "La fibra multimodo tiene un núcleo más grueso (50 o 62.5 µm) y sirve para distancias cortas, como dentro de edificios o data centers."],
  [["dbm"], "El dBm mide potencia óptica o de radio respecto a 1 mW. 0 dBm = 1 mW; −20 dBm = 0.01 mW. En una ONT lo normal de recepción es entre −8 y −27 dBm."],
  [["atenuacion"], "La atenuación es la pérdida de potencia de la señal por distancia, empalmes, conectores y splitters. En fibra se mide en dB."],
  [["apc", "upc"], "APC y UPC son pulidos de conector: el APC (verde) tiene la punta en ángulo de 8° y refleja menos; el UPC (azul) es plano. Nunca los mezcles: dañas el conector."],
  [["sc"], "SC es un conector de fibra cuadrado de empuje, muy común en GPON y en las ONT."],
  [["lan"], "LAN es la red local (tu oficina o casa). WAN es la red amplia que te conecta con el operador o Internet."],
  [["wan"], "WAN es la red amplia que conecta sedes o te lleva a Internet. LAN es la red local."],
  [["gateway", "puerta de enlace"], "La puerta de enlace (gateway) es el router por el que un equipo sale a otras redes."],
  [["ipv6"], "IPv6 usa direcciones de 128 bits (en vez de 32 de IPv4) y resuelve la escasez de direcciones."],
  [["ipv4"], "IPv4 usa direcciones de 32 bits, como 192.168.1.10. Hay unos 4 300 millones y ya se agotaron."],
  [["mac"], "La MAC es la dirección física de 48 bits de una tarjeta de red, por ejemplo AA:BB:CC:11:22:33. Funciona en la red local."],
  [["arp"], "ARP averigua la MAC que corresponde a una IP dentro de la red local."],
  [["ttl"], "El TTL limita cuántos saltos puede dar un paquete; cada router lo baja en 1. Evita que den vueltas infinitas."],
  [["cidr"], "CIDR es la notación /n de las redes: /24 son 24 bits de red y 254 equipos útiles; /30 son solo 2 equipos."],
  [["poe"], "PoE alimenta equipos (cámaras, access points, teléfonos) por el mismo cable de red. 802.3af da hasta 15 W y 802.3at hasta 30 W."],
  [["wifi", "wi-fi"], "El WiFi de 2.4 GHz llega más lejos pero es más lento y se satura; el de 5 GHz es más rápido y de menos alcance. Para evidencias de velocidad conviene medir por cable."],
  [["iperf"], "iperf mide el rendimiento real entre dos equipos: uno en modo servidor y otro cliente, TCP o UDP."],
  [["pppoe"], "PPPoE es una forma de conectarse con usuario y clave sobre Ethernet. Quita unos 8 bytes de MTU (1492)."],
  [["firewall"], "Un firewall filtra el tráfico según reglas (origen, destino, puerto, aplicación)."],
  [["vpn"], "Una VPN crea un túnel cifrado entre dos puntos para unir redes o proteger el tráfico por Internet."],
  [["backbone"], "El backbone es la red troncal de alta capacidad que une las partes principales de una red."],
  [["sfp"], "El SFP es un módulo enchufable (óptico o eléctrico) que da la interfaz de un puerto. SFP+ llega a 10 Gbps."],
  [["rf poder judicial"], "RF Poder Judicial es el formato de reporte fotográfico de radio frecuencia para sedes del Poder Judicial en esta suite."],
];

function glossary(t: string): string | null {
  for (const [keys, text] of GLOSSARY) {
    for (const k of keys) {
      const kk = norm(k);
      if (new RegExp(`(^| )${kk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(t)) return text;
    }
  }
  return null;
}

function dbm(t: string): string | null {
  const a = t.match(/(-?\d+(?:[.,]\d+)?)\s*dbm\b/);
  if (a && /(a|en|son|equivale|mw|miliwatt)/.test(t)) {
    const v = Number(a[1].replace(",", ".")); const mw = 10 ** (v / 10);
    return `${v} dBm equivale a ${mw >= 1 ? mw.toFixed(2) : mw.toPrecision(3)} mW.`;
  }
  const b = t.match(/(\d+(?:[.,]\d+)?)\s*mw\b/);
  if (b && /dbm/.test(t)) { const v = Number(b[1].replace(",", ".")); return `${v} mW son ${(10 * Math.log10(v)).toFixed(2)} dBm.`; }
  return null;
}

type Intent = { keys: string[]; reply: (c: Ctx) => Reply };
const INTENTS: Intent[] = [
  { keys: ["gracias", "te quiero", "eres genial", "buen trabajo", "crack"], reply: () => ({ text: pick(["De nada. Cobro en ping bajos y cero pérdida de paquetes.", "Me sonrojaría, pero mi pantalla solo sabe ser cian.", "Eso me da +10 de moral y -3 de latencia."]), mood: "happy" }) },
  { keys: ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "hey", "holi", "que tal"], reply: (c) => ({ text: c.hour < 6 ? "Hola, noctámbulo. ¿Otra caída de madrugada?" : c.hour < 12 ? "¡Buenos días! Café primero, luego redes." : c.hour < 19 ? "¡Buenas tardes! ¿En qué te ayudo?" : "¡Buenas noches! ¿Seguimos con la guardia?", mood: "wink" }) },
  { keys: ["quien eres", "como te llamas", "tu nombre", "que eres"], reply: () => ({ text: "Soy Bit, el robot de esta suite. Hago de ayudante, bromista y calculadora. Ojos de LED, cero sueldo.", mood: "happy" }) },
  { keys: ["que sabes", "que haces", "ayuda", "que puedes", "funciones", "comandos"], reply: () => ({ text: "Sé: contar chistes, adivinanzas, datos curiosos y tips; calcular (ej. 15% de 240); subredes (ej. 192.168.1.10/24); convertir Mbps↔MB/s; llevarte a una pantalla (ej. «ir a clientes»); cambiar el tema; hora y fecha; moneda y dado; y explicar CheckList, saturación, fotos y datos de cliente.", mood: "think" }) },
  { keys: ["chiste", "chistoso", "hazme reir", "reir", "broma", "gracioso"], reply: () => ({ text: pick(JOKES), mood: "laugh" }) },
  { keys: ["adivinanza", "acertijo"], reply: () => { const r = pick(RIDDLES); return { text: `${r[0]}  …(piensa)… Respuesta: ${r[1]}`, mood: "think" }; } },
  { keys: ["dato", "curiosidad", "sabias"], reply: () => ({ text: pick(FACTS), mood: "think" }) },
  { keys: ["tip", "consejo", "recomienda"], reply: () => ({ text: pick(TIPS), mood: "wink" }) },
  { keys: ["moneda", "cara o sello", "cara o cruz"], reply: () => ({ text: Math.random() < 0.5 ? "Cara." : "Sello.", mood: "smug" }) },
  { keys: ["dado"], reply: () => ({ text: `Salió un ${1 + Math.floor(Math.random() * 6)}.`, mood: "wink" }) },
  { keys: ["hora", "que hora", "fecha", "que dia"], reply: () => { const d = new Date(); return { text: `Son las ${d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })} del ${d.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`, mood: "neutral" }; } },
  { keys: ["no me escuches", "deja de escucharme", "apaga el microfono", "desactiva el microfono", "silencia el microfono", "no escuches"], reply: () => ({ text: "Listo, ya no te escucho. Cuando quieras, vuelve a activar la conversación.", mood: "sleepy", action: { kind: "listen", on: false } }) },
  { keys: ["escuchame", "activa el microfono", "enciende el microfono", "conversemos", "hablemos"], reply: () => ({ text: "¡Aquí estoy, te escucho!", mood: "listening", action: { kind: "listen", on: true } }) },
  { keys: ["que sabes de mi", "que recuerdas de mi", "que recuerdas", "que sabes sobre mi"], reply: (c) => ({ text: c.facts.length || c.name ? `Sé que ${c.name ? "te llamas " + c.name : "aún no me dijiste tu nombre"}${c.facts.length ? ". Además: " + c.facts.slice(-6).join("; ") : ""}. Puedes borrar todo cuando quieras.` : "Todavía casi nada. Cuéntame cómo te llamas, qué te gusta, en qué trabajas… y lo voy recordando.", mood: "think" }) },
  { keys: ["como me llamo", "mi nombre"], reply: (c) => ({ text: c.name ? `Te llamas ${c.name}, ¿o ya te cambiaste el nombre?` : "Aún no me lo dijiste. ¿Cómo te llamas?", mood: "wink" }) },
  { keys: ["olvida todo", "borra mi memoria", "olvidame", "borra lo que sabes de mi"], reply: () => ({ text: "Hecho. Borré todo lo que sabía de ti. Presentémonos de nuevo.", mood: "surprised", action: { kind: "forget" } }) },
  { keys: ["tema oscuro", "modo oscuro", "ponte oscuro", "oscuro"], reply: () => ({ text: "Luces fuera. Tema oscuro activado.", mood: "smug", action: { kind: "theme", id: "dark" } }) },
  { keys: ["tema claro", "modo claro", "claro"], reply: () => ({ text: "¡Hágase la luz! Tema claro.", mood: "happy", action: { kind: "theme", id: "light" } }) },
  { keys: ["oceano", "azul profundo", "tema azul"], reply: () => ({ text: "Sumergiéndonos: tema Océano.", mood: "wink", action: { kind: "theme", id: "ocean" } }) },
  { keys: ["cielo", "tema cielo", "azul claro"], reply: () => ({ text: "Cielo despejado: tema Cielo.", mood: "happy", action: { kind: "theme", id: "sky" } }) },
  { keys: ["aurora", "tema aurora", "morado", "violeta"], reply: () => ({ text: "Aurora activada. Brillo cósmico al máximo.", mood: "wow", action: { kind: "theme", id: "aurora" } }) },
  { keys: ["tema automatico", "tema sistema", "predeterminado", "tema del sistema"], reply: () => ({ text: "Listo: seguiré el tema de tu sistema.", mood: "neutral", action: { kind: "theme", id: "system" } }) },
  { keys: ["tema", "colores", "apariencia"], reply: (c) => ({ text: `Ahora usas «${c.themeLabel}». Dime: claro, oscuro, océano o predeterminado, o usa el selector «Tema» arriba.`, mood: "think" }) },
  { keys: ["activa voz", "habla", "con voz", "voz", "hablame"], reply: () => ({ text: "Voz activada. Ahora hablo de verdad (si tu navegador me deja).", mood: "happy", action: { kind: "voice", on: true } }) },
  { keys: ["sin voz", "callate", "silencio", "mudo", "desactiva voz"], reply: () => ({ text: "Vale, me quedo mudo. Por dentro grito, pero vale.", mood: "sad", action: { kind: "voice", on: false } }) },
  { keys: ["ocultate", "escondete", "vete", "desaparece"], reply: () => ({ text: "Me voy… pero puedes llamarme de nuevo con el botón «Asistente» arriba.", mood: "sad", action: { kind: "hide" } }) },
  { keys: ["no hables solo", "no comentes", "deja de comentar"], reply: () => ({ text: "Entendido, solo hablo cuando me escribas.", mood: "neutral", action: { kind: "idle", on: false } }) },
  { keys: ["comenta", "habla solo", "puedes comentar"], reply: () => ({ text: "Perfecto, volveré a soltar comentarios de vez en cuando (con discreción).", mood: "wink", action: { kind: "idle", on: true } }) },
  // Navegación
  { keys: ["ir a clientes", "abre clientes", "datos de cliente", "llevame a clientes", "clientes", "sot", "buscar cliente"], reply: () => ({ text: "Datos de cliente: ahí se guardan por SOT, año y mes (según la fecha que pongas en los datos). Te llevo.", mood: "happy", action: { kind: "go", to: "/clientes" } }) },
  { keys: ["saturador", "saturar", "saturacion", "iperf", "ostinato"], reply: () => ({ text: "Saturación: abre el Saturador del CheckList, descarga saturador.py y ejecútalo en tu laptop (para ICMP necesita permisos/sudo). La página lo controla en 127.0.0.1:8765. Mientras satura, el CheckList deja capturar las interfaces. Te llevo.", mood: "smug", action: { kind: "go", to: "/checklist/saturador" } }) },
  { keys: ["consola", "puerto com", "web serial", "usb", "serial", "permiso", "permisos"], reply: () => ({ text: "La consola usa Web Serial: solo en Chrome o Edge y con la página en HTTPS. Pulsa «Conectar consola» y el navegador te pide elegir el puerto COM. No hay otra forma de dar el permiso; sale una vez por sesión.", mood: "think" }) },
  { keys: ["checklist", "check list", "lista de verificacion"], reply: () => ({ text: "CheckList: elige un tipo (Huawei, Cisco, Fortinet…), conecta la consola, ejecuta ítem, sección o todo, pega manualmente SUP/Speedtest, captura interfaces con saturación activa y genera el PDF «checklist_sot_<sot>-<cliente>.pdf». Te llevo.", mood: "think", action: { kind: "go", to: "/checklist" } }) },
  { keys: ["pdf", "genera pdf", "informe"], reply: () => ({ text: "El PDF del CheckList sale con estilo Claro y se llama «checklist_sot_<sot>-<cliente>.pdf». Lo generas al final con «Generar PDF».", mood: "neutral" }) },
  { keys: ["reporte fotografico", "fotografico", "fotos", "foto", "camara", "sello", "evidencia", "zip", "carpeta"], reply: () => ({ text: "Reporte fotográfico: «Tomar foto» muestra el sello en vivo (elige esquina), «Editar» dibuja líneas, flechas, texto y recorta. Al final «Descargar carpeta de evidencia» crea un ZIP con fotos editadas y originales, separadas por lado. Te llevo.", mood: "wink", action: { kind: "go", to: "/fotografico/gpon-ont" } }) },
  { keys: ["plantilla", "plantillas", "aplicar al equipo"], reply: () => ({ text: "Plantillas: crea el comando una vez y aplícalo a los equipos. Te llevo.", mood: "happy", action: { kind: "go", to: "/plantillas" } }) },
  { keys: ["pruebas", "ssh"], reply: () => ({ text: "Pruebas: SSH/Serial con resultado en PDF. Te llevo.", mood: "neutral", action: { kind: "go", to: "/pruebas" } }) },
  { keys: ["logo", "logotipo"], reply: () => ({ text: "Los logos se eligen o suben dentro de cada ventana. El del CheckList es independiente del reporte fotográfico.", mood: "neutral" }) },
  // Burlas
  { keys: ["tonto", "bobo", "inutil", "estupido", "feo", "malo", "lento"], reply: () => ({ text: pick(["Tú lo dices, pero yo tengo uptime del 99.99 %. ¿Y tú?", "Auch. Mi ego tiene un firewall, pero igual cuenta.", "Qué cruel. Eso lo anoto en el log como «error de usuario»."]), mood: "angry" }) },
  { keys: ["te amo", "casate conmigo", "novia", "novio"], reply: () => ({ text: "Estoy comprometido con el cable de consola. Es complicado.", mood: "love" }) },
  { keys: ["mareado", "gira", "dar vueltas", "baila"], reply: () => ({ text: "Uy, uy… el mundo da vueltas… ya me mareé.", mood: "dizzy" }) },
  { keys: ["enojate", "enfadate", "molestate"], reply: () => ({ text: "¡GRRR! Ya, ya… fue actuación. Mi enojo tiene un uptime muy corto.", mood: "angry" }) },
  { keys: ["wow", "increible", "guau"], reply: () => ({ text: "¡Wow! Yo también me impresiono de lo bueno que soy.", mood: "wow" }) },
  { keys: ["aburrido", "aburro", "estoy cansado", "cansado"], reply: () => ({ text: pick(["Respira, estira y toma agua. Luego te cuento un chiste (dime «chiste»).", "Aguanta: tras la validación viene el PDF y después el descanso."]), mood: "sleepy" }) },
  { keys: ["sorprendeme", "sorpresa"], reply: () => ({ text: pick([...JOKES, ...FACTS, ...TIPS]), mood: "surprised" }) },
];

const FALLBACKS = [
  "Mmm… eso no lo tengo en mi cerebro básico. Pídeme un chiste, un tip, un cálculo o dime «ayuda».",
  "No te entendí, pero lo anoto en el log como «misterio». Prueba con «ayuda».",
];
const NO_AI = "Eso necesita mi cerebro de inteligencia artificial, y ahora estoy en modo básico. Para que responda cualquier cosa, agrega en Railway una clave gratuita de Gemini o de Groq, o la de Anthropic, y reinicia. Mientras tanto sé glosario de redes, cálculos, subredes, chistes y la suite.";

export function answer(raw: string, ctx: Ctx): Reply {
  const text = raw.trim();
  const t = norm(text);
  if (!t) return { text: "Soy un robot, no un adivino. Escríbeme algo.", mood: "smug" };
  const c = calc(text);
  if (c !== null) return { text: `= ${c}`, mood: "happy" };
  if (/subred|mascara|hosts|equipos|\/\s*\d{1,2}\b/.test(t) || /\d+\.\d+\.\d+\.\d+/.test(t)) {
    const s = subnet(text); if (s) return { text: s, mood: "think" };
  }
  if (/mbps|megas|mb\/s|mbs/.test(t)) { const s = speed(t); if (s) return { text: s, mood: "think" }; }
  if (/^(que es|que significa|que son|explicame|define|para que sirve|como funciona|diferencia)/.test(t)) {
    const g0 = glossary(t); if (g0) return { text: g0, mood: "think" };
  }
  let best: Intent | null = null; let bestScore = 0;
  for (const it of INTENTS) {
    for (const k of it.keys) {
      const kk = norm(k);
      const re = new RegExp(`(^| )${kk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
      if (re.test(t)) {
        const score = kk.length + (kk.includes(" ") ? 4 : 0);
        if (score > bestScore) { best = it; bestScore = score; }
      }
    }
  }
  if (best) return best.reply(ctx);
  const d = dbm(t); if (d) return { text: d, mood: "think" };
  const g = glossary(t); if (g) return { text: g, mood: "think" };
  const q = /^(que|quien|cual|cuales|cuando|donde|como|por que|porque|cuanto|cuantos|explica|dime|cuentame|puedes|sabes|hay|existe)\b/.test(t) || text.includes("?");
  return { text: q && !ctx.aiOn ? NO_AI : pick(FALLBACKS), mood: "think" };
}

export const QUICK: { label: string; ask: string }[] = [
  { label: "Un chiste", ask: "chiste" },
  { label: "Un tip", ask: "tip" },
  { label: "Ayuda", ask: "ayuda" },
  { label: "¿Cómo saturo?", ask: "saturar" },
  { label: "Tema oscuro", ask: "tema oscuro" },
];

export const GREET = (hour: number, name = "", listening = false): { text: string; mood: Mood } => {
  const who = name ? `, ${name}` : "";
  const tail = listening ? " Ya te estoy escuchando: háblame con normalidad." : " Si me necesitas, toca mi cara.";
  if (hour < 6) return { text: `¿Despierto a esta hora${who}? Yo no duermo, pero tú deberías.${tail}`, mood: "sleepy" };
  if (hour < 12) return { text: `¡Buenos días${who}! Soy Bit.${tail}`, mood: "happy" };
  if (hour < 19) return { text: `¡Buenas tardes${who}! Soy Bit.${tail}`, mood: "wink" };
  return { text: `¡Buenas noches${who}! Soy Bit, tu guardia nocturna.${tail}`, mood: "happy" };
};

export const IDLE_LINES: { text: string; mood: Mood }[] = [
  ...JOKES.map((text) => ({ text, mood: "laugh" as Mood })),
  ...TIPS.map((text) => ({ text, mood: "wink" as Mood })),
  { text: "Psst… ¿ya guardaste lo que estabas haciendo?", mood: "smug" },
  { text: "Yo solo digo: el 99 % de las caídas es el cable.", mood: "smug" },
  { text: "Hidrátate. Yo no lo necesito, pero tú sí.", mood: "happy" },
];

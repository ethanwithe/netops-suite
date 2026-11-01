// Cerebro de la mascota «Bit»: respuestas por palabras clave, chistes y utilidades.
// Sin dependencias de React para poder probarlo aparte.

export type Mood = "neutral" | "happy" | "laugh" | "wink" | "surprised" | "sad" | "think" | "smug" | "sleepy" | "listening" | "love" | "angry" | "wow" | "dizzy";
export type Action =
  | { kind: "go"; to: string }
  | { kind: "theme"; id: "system" | "light" | "dark" | "ocean" }
  | { kind: "voice"; on: boolean }
  | { kind: "hide" }
  | { kind: "idle"; on: boolean };
export interface Reply { text: string; mood: Mood; action?: Action }
export interface Ctx { pathname: string; hour: number; themeLabel: string }

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
  { keys: ["tema oscuro", "modo oscuro", "ponte oscuro", "oscuro"], reply: () => ({ text: "Luces fuera. Tema oscuro activado.", mood: "smug", action: { kind: "theme", id: "dark" } }) },
  { keys: ["tema claro", "modo claro", "claro"], reply: () => ({ text: "¡Hágase la luz! Tema claro.", mood: "happy", action: { kind: "theme", id: "light" } }) },
  { keys: ["oceano", "azul profundo", "tema azul"], reply: () => ({ text: "Sumergiéndonos: tema Océano.", mood: "wink", action: { kind: "theme", id: "ocean" } }) },
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
  "Mmm… eso no lo tengo en mi base de datos. Pídeme un chiste, un tip, un cálculo o dime «ayuda».",
  "No te entendí, pero lo anoto en el log como «misterio». Prueba con «ayuda».",
  "Mi procesador de dudas dice: ¿me lo repites con otras palabras?",
];

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
  return { text: pick(FALLBACKS), mood: "think" };
}

export const QUICK: { label: string; ask: string }[] = [
  { label: "Un chiste", ask: "chiste" },
  { label: "Un tip", ask: "tip" },
  { label: "Ayuda", ask: "ayuda" },
  { label: "¿Cómo saturo?", ask: "saturar" },
  { label: "Tema oscuro", ask: "tema oscuro" },
];

export const GREET = (hour: number): { text: string; mood: Mood } =>
  hour < 6 ? { text: "¿Despierto a esta hora? Yo no duermo, pero tú deberías.", mood: "sleepy" }
  : hour < 12 ? { text: "¡Buenos días! Soy Bit. Si me necesitas, toca mi cara.", mood: "happy" }
  : hour < 19 ? { text: "¡Buenas tardes! Soy Bit. Pídeme un chiste cuando quieras.", mood: "wink" }
  : { text: "¡Buenas noches! Soy Bit, tu guardia nocturna.", mood: "happy" };

export const IDLE_LINES: { text: string; mood: Mood }[] = [
  ...JOKES.map((text) => ({ text, mood: "laugh" as Mood })),
  ...TIPS.map((text) => ({ text, mood: "wink" as Mood })),
  { text: "Psst… ¿ya guardaste lo que estabas haciendo?", mood: "smug" },
  { text: "Yo solo digo: el 99 % de las caídas es el cable.", mood: "smug" },
  { text: "Hidrátate. Yo no lo necesito, pero tú sí.", mood: "happy" },
];

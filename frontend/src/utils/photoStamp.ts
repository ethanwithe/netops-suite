/**
 * Foto con sello: al tomar la foto con la cámara se le imprime una franja con
 * cliente, fecha y hora, dirección y coordenadas, para que quede como
 * evidencia dentro del PDF.
 */

export interface Place {
  lat: number;
  lng: number;
  accuracy?: number;
  address?: string[];
  /** Ubicación recordada de antes (solo para mostrar); nunca se imprime en el sello. */
  approx?: boolean;
}

/** Esquina donde se imprime el sello: abajo-derecha (como el modelo), abajo-izquierda, arriba... */
export type StampPos = "br" | "bl" | "tr" | "tl";
export const STAMP_ORDER: StampPos[] = ["br", "bl", "tl", "tr"];
export const STAMP_ARROW: Record<StampPos, string> = { br: "↘", bl: "↙", tl: "↖", tr: "↗" };
const POS_KEY = "netops.stampPos";

export function getStampPos(): StampPos {
  try {
    const v = localStorage.getItem(POS_KEY) as StampPos | null;
    return v && STAMP_ORDER.includes(v) ? v : "br";
  } catch {
    return "br";
  }
}

export function setStampPos(p: StampPos): void {
  try {
    localStorage.setItem(POS_KEY, p);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

interface Addr {
  road?: string; pedestrian?: string; footway?: string;
  suburb?: string; neighbourhood?: string; city_district?: string;
  city?: string; town?: string; village?: string;
  county?: string; state?: string; state_district?: string;
}

/** Dirección en líneas cortas: calle, ciudad, provincia, región (como en el sello de ejemplo). */
async function reverseNominatim(lat: number, lng: number): Promise<string[] | undefined> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}&accept-language=es`,
      { signal: ctl.signal }
    );
    window.clearTimeout(timer);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { display_name?: string; address?: Addr };
    const a = j.address;
    if (!a) return j.display_name ? [j.display_name] : undefined;

    const parts = [
      a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb,
      a.city || a.town || a.village || a.city_district,
      a.county,
      a.state || a.state_district,
    ].filter((x): x is string => !!x);
    const unique = parts.filter((x, i) => parts.indexOf(x) === i);
    return unique.length ? unique : j.display_name ? [j.display_name] : undefined;
  } catch {
    return undefined; // sin internet o servicio caído: se sella solo con coordenadas
  }
}

/** Respaldo rápido y sin clave: da barrio/ciudad/región cuando Nominatim (calle) tarda o no responde. */
async function reverseBigData(lat: number, lng: number): Promise<string[] | undefined> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=es`, { signal: ctl.signal });
    window.clearTimeout(timer);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { locality?: string; city?: string; principalSubdivision?: string };
    const parts = [j.locality, j.city, j.principalSubdivision].filter((x): x is string => !!x);
    const unique = parts.filter((x, i) => parts.indexOf(x) === i);
    return unique.length ? unique : undefined;
  } catch {
    return undefined;
  }
}

// Direcciones ya resueltas (a ~10 m): volver al mismo lugar es instantáneo
const ADDR_KEY = "netops.addrCache";
const addrKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
function cachedAddress(lat: number, lng: number): string[] | undefined {
  try { return (JSON.parse(localStorage.getItem(ADDR_KEY) || "{}") as Record<string, string[]>)[addrKey(lat, lng)]; } catch { return undefined; }
}
function cacheAddress(lat: number, lng: number, a: string[]): void {
  try {
    const m = JSON.parse(localStorage.getItem(ADDR_KEY) || "{}") as Record<string, string[]>;
    m[addrKey(lat, lng)] = a;
    const keys = Object.keys(m);
    keys.slice(0, Math.max(0, keys.length - 30)).forEach((k) => delete m[k]);
    localStorage.setItem(ADDR_KEY, JSON.stringify(m));
  } catch { /* sin almacenamiento */ }
}

/**
 * Dirección en dos fases para que aparezca rápido: primero la zona (BigDataCloud, ~0,3 s) y, cuando llega,
 * la calle exacta (Nominatim, más lento). Se llama a cb con cada mejora; lo exacto queda en caché.
 */
function resolveAddress(lat: number, lng: number, cb: (a: string[]) => void): void {
  const hit = cachedAddress(lat, lng);
  if (hit) { cb(hit); return; }
  let streetOk = false, streetFailed = false;
  let zone: string[] | undefined;
  void reverseBigData(lat, lng).then((a) => {
    zone = a;
    if (!a || streetOk) return;
    cb(a);
    if (streetFailed) cacheAddress(lat, lng, a);
  });
  void reverseNominatim(lat, lng).then((a) => {
    if (a) { streetOk = true; cacheAddress(lat, lng, a); cb(a); }
    else { streetFailed = true; if (zone) cacheAddress(lat, lng, zone); }
  });
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

// ---------------------------------------------------------------
// Servicio de ubicación: un solo lugar que mantiene la última posición al día.
//  1) fix rápido y aproximado (wifi/antenas, con la caché del navegador) -> aparece en 1-2 s
//  2) fix preciso (GPS) que va mejorando la precisión por detrás
// La dirección se resuelve aparte y se guarda en caché. Se detiene solo si nadie lo usa.
// ---------------------------------------------------------------
const LAST_KEY = "netops.lastPlace";
const FRESH_MS = 120_000;
interface Fix { place: Place; at: number }

function loadLast(): Fix | null {
  try {
    const j = JSON.parse(localStorage.getItem(LAST_KEY) || "null") as (Place & { at: number }) | null;
    return j && typeof j.lat === "number" ? { place: { lat: j.lat, lng: j.lng, accuracy: j.accuracy, address: j.address, approx: true }, at: j.at } : null;
  } catch { return null; }
}
let current: Fix | null = loadLast();
const listeners = new Set<(p: Place) => void>();
let watchId: number | null = null;
let idleTimer: number | undefined;
let denied = false;

const isFresh = (f: Fix | null) => !!f && !f.place.approx && Date.now() - f.at < FRESH_MS;

function publish(place: Place) {
  current = { place, at: Date.now() };
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...place, approx: undefined, at: current.at })); } catch { /* ignorar */ }
  listeners.forEach((l) => l(place));
}

function accept(pos: GeolocationPosition, coarse: boolean) {
  const lat = pos.coords.latitude, lng = pos.coords.longitude, accuracy = pos.coords.accuracy;
  // un fix aproximado nunca pisa uno reciente que es más preciso
  if (coarse && isFresh(current) && (current!.place.accuracy ?? 1e9) <= (accuracy ?? 1e9)) return;
  const prev = current?.place;
  const address = prev?.address && distanceM(prev, { lat, lng }) < 60 ? prev.address : cachedAddress(lat, lng);
  // una lectura que el navegador tenía guardada de hace rato sirve para mostrar, pero nunca para el sello
  const stale = Date.now() - pos.timestamp > FRESH_MS;
  const place: Place = { lat, lng, accuracy, address, approx: stale || undefined };
  publish(place);
  if (!address) {
    resolveAddress(lat, lng, (a) => {
      if (current && distanceM(current.place, { lat, lng }) < 60) publish({ ...current.place, address: a });
    });
  }
}

function stopLocating() {
  if (watchId != null && typeof navigator !== "undefined") navigator.geolocation?.clearWatch(watchId);
  watchId = null;
}

function startLocating() {
  if (typeof navigator === "undefined" || !navigator.geolocation || denied) return;
  window.clearTimeout(idleTimer);
  const arm = () => { idleTimer = window.setTimeout(() => (listeners.size ? arm() : stopLocating()), 120_000); };
  arm();
  if (watchId != null) return;
  try {
    void navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((r) => {
      denied = r.state === "denied";
      if (denied) stopLocating();
      r.onchange = () => { denied = r.state === "denied"; };
    }).catch(() => undefined);
  } catch { /* sin Permissions API */ }
  navigator.geolocation.getCurrentPosition((p) => accept(p, true), () => undefined, { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8000 });
  watchId = navigator.geolocation.watchPosition((p) => accept(p, false), () => undefined, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
}

/**
 * Calienta la ubicación al abrir la página si el permiso YA fue concedido (no pide nada ni gasta batería:
 * es una sola lectura aproximada). Así, cuando abres la cámara, la posición y la dirección ya están listas.
 */
export function warmPlace(): void {
  try {
    if (typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions) return;
    void navigator.permissions.query({ name: "geolocation" as PermissionName }).then((r) => {
      if (r.state !== "granted") return;
      navigator.geolocation.getCurrentPosition((p) => accept(p, true), () => undefined, { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8000 });
    }).catch(() => undefined);
  } catch { /* sin Permissions API */ }
}

/** Empieza a buscar la ubicación en segundo plano (al abrir la cámara o una pantalla con fotos). */
export function prefetchPlace(): void {
  try {
    void document.fonts?.load('600 40px "Dancing Script"').catch(() => undefined); // letra del sello
  } catch {
    /* sin soporte */
  }
  startLocating();
}

/**
 * Ubicación para el sello sin hacer esperar a quien toma la foto: usa la última lectura reciente
 * (menos de 2 min) y, si no hay, espera como máximo ~2,5 s a la primera. Nunca imprime una ubicación vieja.
 */
export async function getPlaceFast(): Promise<Place | null> {
  startLocating();
  if (!isFresh(current)) {
    await new Promise<void>((resolve) => {
      const done = () => { listeners.delete(l); window.clearTimeout(t); resolve(); };
      const l = () => done();
      const t = window.setTimeout(done, 2500);
      listeners.add(l);
    });
  }
  if (!isFresh(current)) return null;
  for (let i = 0; i < 8 && !current!.place.address; i++) await sleep(150);   // hasta ~1,2 s por la dirección
  return current!.place;
}

/** Ubicación actual (con dirección si se puede). null si no hay permiso o señal. */
export const getPlace = getPlaceFast;

/**
 * Sigue la ubicación en tiempo real (coordenadas en la cámara). Muestra al instante la última
 * posición recordada (marcada «approx») mientras llega la lectura nueva. Devuelve la función que deja de seguir.
 */
export function watchPlace(onUpdate: (p: Place) => void): () => void {
  const l = (p: Place) => onUpdate(p);
  listeners.add(l);
  if (current) onUpdate(current.place);
  startLocating();
  return () => { listeners.delete(l); };
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const two = (n: number) => String(n).padStart(2, "0");

/**
 * Líneas del sello, de arriba hacia abajo:
 *   19 oct 2026 16:25:49 / calle / ciudad / provincia / región / lat lng / CLIENTE
 */
export function stampLines(cliente: string, place: Place | null, when = new Date()): string[] {
  const fecha = `${when.getDate()} ${MESES[when.getMonth()]} ${when.getFullYear()}`;
  const hora = `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}`;

  const lines: string[] = [`${fecha} ${hora}`];
  if (place) {
    if (place.address) lines.push(...place.address);
    lines.push(`${place.lat.toFixed(7)} ${place.lng.toFixed(7)}`);
  } else {
    lines.push("Ubicación no disponible");
  }
  // El cliente respeta los saltos de línea que escribió el usuario.
  cliente
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l) => lines.push(l.toUpperCase()));
  return lines;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la foto."));
    };
    img.src = url;
  });
}

/** Devuelve una copia JPEG de la foto con la franja de datos al pie. */
export async function stampImage(file: File, lines: string[], pos: StampPos = "br"): Promise<File> {
  const img = await loadImage(file);

  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  // Estilo del sello: letra cursiva blanca con sombra, pegada abajo a la derecha, sin franja.
  const size = Math.max(16, Math.round(Math.min(w, h) * 0.05));
  const lead = Math.round(size * 1.18);
  const pad = Math.round(size * 0.3);
  const family = '"Dancing Script", "Segoe Script", "Brush Script MT", cursive';
  try {
    await document.fonts.load(`600 ${size}px "Dancing Script"`);
  } catch {
    /* sin la letra descargada se usa una cursiva del sistema */
  }
  ctx.font = `600 ${size}px ${family}`;
  ctx.textBaseline = "alphabetic";
  const right = pos === "br" || pos === "tr";
  const bottom = pos === "br" || pos === "bl";
  ctx.textAlign = right ? "right" : "left";

  // Cada dato se parte en las líneas que necesite (un cliente largo ocupa 2 o más).
  const rows = lines.flatMap((l) => wrap(ctx, l, w - 2 * pad));

  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = Math.max(3, Math.round(size * 0.14));
  ctx.shadowOffsetX = Math.max(1, Math.round(size * 0.04));
  ctx.shadowOffsetY = Math.max(1, Math.round(size * 0.04));
  const x = right ? w - pad : pad;
  rows.forEach((r, i) => {
    const y = bottom
      ? h - pad - Math.round(size * 0.2) - (rows.length - 1 - i) * lead
      : pad + Math.round(size * 0.85) + i * lead;
    ctx.fillText(r, x, y);
  });

  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) return file;

  const base = (file.name || "foto").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}


function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

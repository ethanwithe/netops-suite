// Voz (síntesis: navegador o nube) y micrófono (reconocimiento) del asistente.

export const sttSupported = () => typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export const STYLES: { id: string; label: string; rate: number; pitch: number }[] = [
  { id: "normal", label: "Normal", rate: 1, pitch: 1 },
  { id: "grave", label: "Grave", rate: 0.95, pitch: 0.7 },
  { id: "aguda", label: "Aguda", rate: 1.05, pitch: 1.4 },
  { id: "pausada", label: "Pausada", rate: 0.82, pitch: 1 },
  { id: "rapida", label: "Rápida", rate: 1.22, pitch: 1 },
  { id: "robot", label: "Robot", rate: 0.9, pitch: 0.55 },
  { id: "dibujos", label: "Dibujos animados", rate: 1.12, pitch: 1.7 },
];

export interface VoiceOpt { id: string; label: string; group: "Nube" | "Español" | "Otros idiomas" }
const CLOUD_LABEL: Record<string, string> = { alloy: "Alloy · neutra", ash: "Ash · serena", coral: "Coral · cálida", echo: "Echo · masculina", fable: "Fable · narrador", nova: "Nova · joven", onyx: "Onyx · grave", sage: "Sage · tranquila", shimmer: "Shimmer · suave" };

/** Todas las voces disponibles: las de la nube (si el servidor las tiene) y las del navegador. */
export function listVoices(cloud: string[]): VoiceOpt[] {
  const out: VoiceOpt[] = cloud.map((v) => ({ id: `nube:${v}`, label: `${CLOUD_LABEL[v] ?? v} (muy natural)`, group: "Nube" }));
  if (ttsSupported()) {
    const vs = window.speechSynthesis.getVoices();
    const es = vs.filter((v) => v.lang.toLowerCase().startsWith("es")).sort((a, b) => score(b) - score(a));
    const rest = vs.filter((v) => !v.lang.toLowerCase().startsWith("es")).sort((a, b) => a.lang.localeCompare(b.lang));
    es.forEach((v) => out.push({ id: v.name, label: `${v.name} (${v.lang})`, group: "Español" }));
    rest.forEach((v) => out.push({ id: v.name, label: `${v.name} (${v.lang})`, group: "Otros idiomas" }));
  }
  return out;
}

function score(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase(), l = v.lang.toLowerCase().replace("_", "-");
  let s = 0;
  if (n.includes("natural")) s += 60;
  if (n.includes("online")) s += 20;
  if (n.includes("google")) s += 25;
  if (n.includes("neural") || n.includes("premium") || n.includes("enhanced")) s += 30;
  if (/compact|espeak|robot/.test(n)) s -= 30;
  if (l === "es-pe") s += 8; else if (l === "es-mx" || l === "es-us" || l === "es-419") s += 6; else if (l === "es-co" || l === "es-ar" || l === "es-cl") s += 4; else if (l.startsWith("es")) s += 2;
  if (!v.localService) s += 5;
  return s;
}

function browserVoice(name?: string): SpeechSynthesisVoice | undefined {
  if (!ttsSupported()) return undefined;
  const vs = window.speechSynthesis.getVoices();
  if (name) { const f = vs.find((v) => v.name === name); if (f) return f; }
  return vs.filter((v) => v.lang.toLowerCase().startsWith("es")).sort((a, b) => score(b) - score(a))[0];
}

export function onVoicesReady(cb: () => void) {
  if (!ttsSupported()) return () => {};
  window.speechSynthesis.addEventListener("voiceschanged", cb);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", cb);
}

function clean(t: string): string {
  return t
    .replace(/[«»<>*_`#]/g, "")
    .replace(/\bMbps\b/g, "megabits por segundo").replace(/\bMB\/s\b/g, "megabytes por segundo")
    .replace(/\/(\d{1,2})\b/g, " barra $1").replace(/Ctrl\+V/gi, "control ve")
    .replace(/\bSOT\b/g, "sot").replace(/\s+/g, " ").trim();
}

function chunks(t: string, max: number): string[] {
  const parts = t.match(/[^.!?…]+[.!?…]*/g) ?? [t];
  const out: string[] = []; let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let current = 0;
let audio: HTMLAudioElement | null = null;
export function stopSpeaking() {
  current++;
  try { window.speechSynthesis?.cancel(); } catch { /* ignorar */ }
  if (audio) { try { audio.pause(); } catch { /* ignorar */ } audio = null; }
}

async function speakCloud(text: string, voice: string, style: string, id: number): Promise<boolean> {
  for (const part of chunks(clean(text), 420)) {
    if (id !== current) return true;
    const r = await fetch("/api/mascot/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: part, voice, style }) });
    if (!r.ok) return false;
    const url = URL.createObjectURL(await r.blob());
    if (id !== current) { URL.revokeObjectURL(url); return true; }
    const a = new Audio(url); audio = a;
    await new Promise<void>((res) => { a.onended = () => res(); a.onerror = () => res(); a.play().catch(() => res()); });
    URL.revokeObjectURL(url);
  }
  return true;
}

function speakBrowser(text: string, voiceName: string, style: string, id: number): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve();
    const synth = window.speechSynthesis;
    synth.cancel();
    const v = browserVoice(voiceName);
    const natural = !!v && /natural|neural|google|premium|enhanced/i.test(v.name);
    const st = STYLES.find((x) => x.id === style) ?? STYLES[0];
    const list = chunks(clean(text), 170);
    let i = 0;
    const next = () => {
      if (id !== current || i >= list.length) return resolve();
      const u = new SpeechSynthesisUtterance(list[i++]);
      u.lang = v?.lang ?? "es-ES";
      if (v) u.voice = v;
      u.rate = (natural ? 1.02 : 0.97) * st.rate;
      u.pitch = (natural ? 1 : 1.1) * st.pitch;
      u.onend = next; u.onerror = next;
      synth.speak(u);
    };
    next();
  });
}

/** Habla el texto (voz de la nube o del navegador); la promesa termina cuando acaba o se cancela. */
export async function speakText(text: string, voiceId = "", style = "normal"): Promise<void> {
  const id = ++current;
  if (voiceId.startsWith("nube:")) {
    try { if (await speakCloud(text, voiceId.slice(5), style, id)) return; } catch { /* sigue con la voz del navegador */ }
    if (id !== current) return;
    return speakBrowser(text, "", style, id);
  }
  return speakBrowser(text, voiceId, style, id);
}

export interface Listener { stop: () => void }

function newRecognizer(lang: string, continuous: boolean) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang; rec.interimResults = true; rec.continuous = continuous; rec.maxAlternatives = 1;
  return rec;
}

/** Escucha UNA frase. */
export function listenOnce(opts: { lang?: string; onInterim?: (t: string) => void; onDone: (text: string, err?: string) => void }): Listener | null {
  const rec = newRecognizer(opts.lang ?? "es-PE", false);
  if (!rec) return null;
  let finalText = "", err = "", done = false;
  const finish = () => { if (done) return; done = true; opts.onDone(finalText.trim(), err || undefined); };
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
    }
    opts.onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (e: any) => { err = e.error || "error"; };
  rec.onend = finish;
  try { rec.start(); } catch { err = "start"; finish(); }
  return { stop: () => { try { rec.abort(); } catch { /* ignorar */ } finish(); } };
}

/** Escucha continua: avisa de cada frase terminada. Termina sola cuando el navegador la cierra (hay que reiniciarla). */
export function listenContinuous(opts: {
  lang?: string; onStart?: () => void; onInterim?: (t: string) => void; onFinal: (t: string) => void; onEnd: (err?: string) => void;
}): Listener | null {
  const rec = newRecognizer(opts.lang ?? "es-PE", true);
  if (!rec) return null;
  let err = "", ended = false;
  const end = () => { if (ended) return; ended = true; opts.onEnd(err || undefined); };
  rec.onstart = () => opts.onStart?.();
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { const t = String(r[0].transcript).trim(); if (t) opts.onFinal(t); } else interim += r[0].transcript;
    }
    opts.onInterim?.(interim.trim());
  };
  rec.onerror = (e: any) => { err = e.error || "error"; };
  rec.onend = end;
  try { rec.start(); } catch { err = "start"; end(); }
  return { stop: () => { try { rec.abort(); } catch { /* ignorar */ } end(); } };
}

// Voz (síntesis) y micrófono (reconocimiento) del asistente, con el navegador.

export const sttSupported = () => typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function spanishVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("es"));
}

function score(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase(), l = v.lang.toLowerCase().replace("_", "-");
  let s = 0;
  if (n.includes("natural")) s += 60;        // Edge/Windows: voces neuronales muy humanas
  if (n.includes("online")) s += 20;
  if (n.includes("google")) s += 25;          // Chrome: voces de Google
  if (n.includes("neural") || n.includes("premium") || n.includes("enhanced")) s += 30;
  if (/compact|espeak|robot/.test(n)) s -= 30;
  if (l === "es-pe") s += 8; else if (l === "es-mx" || l === "es-us" || l === "es-419") s += 6; else if (l === "es-co" || l === "es-ar" || l === "es-cl") s += 4; else s += 2;
  if (!v.localService) s += 5;
  return s;
}

export function bestVoice(preferred?: string): SpeechSynthesisVoice | undefined {
  const vs = spanishVoices();
  if (preferred) { const f = vs.find((v) => v.name === preferred); if (f) return f; }
  return [...vs].sort((a, b) => score(b) - score(a))[0];
}

/** Espera a que el navegador cargue sus voces (llegan de forma asíncrona). */
export function onVoicesReady(cb: () => void) {
  if (!ttsSupported()) return () => {};
  const h = () => cb();
  window.speechSynthesis.addEventListener("voiceschanged", h);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", h);
}

function clean(t: string): string {
  return t
    .replace(/[«»<>*_`#]/g, "")
    .replace(/\bMbps\b/g, "megabits por segundo").replace(/\bMB\/s\b/g, "megabytes por segundo")
    .replace(/\/(\d{1,2})\b/g, " barra $1").replace(/Ctrl\+V/gi, "control ve")
    .replace(/\bSOT\b/g, "sot").replace(/\s+/g, " ").trim();
}

function chunks(t: string): string[] {
  const parts = t.match(/[^.!?…]+[.!?…]*/g) ?? [t];
  const out: string[] = []; let cur = "";
  for (const p of parts) {
    if ((cur + p).length > 170 && cur) { out.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let current = 0;
export function stopSpeaking() {
  current++;
  try { window.speechSynthesis?.cancel(); } catch { /* ignorar */ }
}

/** Habla el texto por frases; la promesa termina cuando acaba (o se cancela). */
export function speakText(text: string, voiceName?: string, hooks: { onStart?: () => void } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve();
    const id = ++current;
    const synth = window.speechSynthesis;
    synth.cancel();
    const v = bestVoice(voiceName);
    const natural = !!v && /natural|neural|google|premium|enhanced/i.test(v.name);
    const list = chunks(clean(text));
    let i = 0, started = false;
    const next = () => {
      if (id !== current || i >= list.length) return resolve();
      const u = new SpeechSynthesisUtterance(list[i++]);
      u.lang = v?.lang ?? "es-ES";
      if (v) u.voice = v;
      u.rate = natural ? 1.02 : 0.97;
      u.pitch = natural ? 1.0 : 1.12;
      u.onstart = () => { if (!started) { started = true; hooks.onStart?.(); } };
      u.onend = next; u.onerror = next;
      synth.speak(u);
    };
    next();
  });
}

export interface Listener { stop: () => void }

/** Escucha UNA frase. `onInterim` recibe lo que va entendiendo; `onDone` el texto final ("" si no oyó nada). */
export function listenOnce(opts: { lang?: string; onInterim?: (t: string) => void; onDone: (text: string, err?: string) => void }): Listener | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = opts.lang ?? "es-PE";
  rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
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

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MascotFace from "./MascotFace";
import { Action, GREET, IDLE_LINES, Mood, QUICK, Reply, answer, norm, routeComment } from "./brain";
import { Listener, STYLES, VoiceOpt, listVoices, listenContinuous, onVoicesReady, speakText, stopSpeaking, sttSupported } from "./voice";
import { setMascot, useMascotSettings } from "./settings";
import { countChat, forget, forgetAll, habitsSummary, learnFrom, markAsked, remember, setName, topSection, trackRoute, useMemory } from "./memory";
import { THEME_OPTIONS, setTheme, useTheme } from "../store/theme";
import { useOverlayOpen } from "../components/useOverlayOpen";

interface Msg { who: "bot" | "me" | "note"; text: string }
interface Bubble { text: string; heard?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FIRST: Msg = { who: "bot", text: "Hola, soy Bit. Háblame o escríbeme lo que quieras: de la suite, de redes o de lo que se te ocurra. Voy aprendiendo de ti." };

export default function Mascot() {
  const cfg = useMascotSettings();
  const mem = useMemory();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const overlay = useOverlayOpen();
  // En pantallas pequeñas la barra de pestañas inferior ocupa el borde: Bit se sube sobre ella.
  const [lift, setLift] = useState(() => (window.innerWidth < 1024 ? 78 : 0));
  useEffect(() => { const f = () => setLift(window.innerWidth < 1024 ? 78 : 0); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);

  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<Mood>("neutral");
  const [talking, setTalking] = useState(false);
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([FIRST]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [aiOn, setAiOn] = useState(false);
  const [cloud, setCloud] = useState<string[]>([]);
  const [micState, setMicState] = useState<"off" | "on" | "denied" | "unsupported">("off");
  const [interim, setInterim] = useState("");
  const [voices, setVoices] = useState<VoiceOpt[]>([]);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });

  const root = useRef<HTMLButtonElement>(null);
  const moodT = useRef<number>();
  const talkT = useRef<number>();
  const bubbleT = useRef<number>();
  const lastSay = useRef(0);
  const lastTalk = useRef(0);
  const listEnd = useRef<HTMLDivElement>(null);
  const clicks = useRef<number[]>([]);
  const busyRef = useRef(false);
  const pausedRef = useRef(false);
  const micRef = useRef<Listener | null>(null);
  const failRef = useRef({ n: 0, t: 0 });
  const pendingName = useRef(false);
  const msgsRef = useRef<Msg[]>([]);
  const aiRef = useRef(false);
  const cloudRef = useRef<string[]>([]);
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const memRef = useRef(mem); memRef.current = mem;
  const openRef = useRef(open); openRef.current = open;
  const pathRef = useRef(pathname); pathRef.current = pathname;
  const themeRef = useRef(theme); themeRef.current = theme;
  msgsRef.current = msgs; aiRef.current = aiOn; cloudRef.current = cloud;

  const voiceId = () => cfgRef.current.voiceName || (cloudRef.current.length ? "nube:nova" : "");

  const express = useCallback((m: Mood, ms = 3200) => {
    setMood(m);
    window.clearTimeout(moodT.current);
    if (m !== "neutral") moodT.current = window.setTimeout(() => setMood("neutral"), ms);
  }, []);

  /** Habla en voz alta (solo si la voz está activada o se fuerza) y mueve la boca mientras tanto. */
  const speak = useCallback((text: string, force = false): Promise<void> => {
    setTalking(true);
    window.clearTimeout(talkT.current);
    if (cfgRef.current.mute || !(cfgRef.current.voice || force)) {
      talkT.current = window.setTimeout(() => setTalking(false), Math.min(5000, 600 + text.length * 38));
      return Promise.resolve();
    }
    return speakText(text, voiceId(), cfgRef.current.voiceStyle).then(() => setTalking(false));
  }, []);

  // Comentario flotante (no invasivo: pequeño, se va solo)
  const say = useCallback((text: string, m: Mood = "neutral") => {
    if (cfgRef.current.hidden || busyRef.current) return;
    lastSay.current = Date.now();
    express(m);
    void speak(text);
    if (!openRef.current) {
      setBubble({ text });
      window.clearTimeout(bubbleT.current);
      bubbleT.current = window.setTimeout(() => setBubble(null), Math.min(9000, 4500 + text.length * 40));
    }
  }, [express, speak]);

  // ---------- micrófono siempre atento ----------
  const handleHeard = useRef<(t: string) => void>(() => {});
  const wantMic = useRef(false);
  wantMic.current = cfg.listen && !cfg.hidden && sttSupported();

  const stopMic = useCallback(() => { const l = micRef.current; micRef.current = null; l?.stop(); }, []);
  const startMic = useCallback(() => {
    if (micRef.current || !wantMic.current || pausedRef.current) return;
    const l = listenContinuous({
      onStart: () => setMicState("on"),
      onInterim: setInterim,
      onFinal: (t) => { setInterim(""); handleHeard.current(t); },
      onEnd: (err) => {
        micRef.current = null; setInterim("");
        if (!wantMic.current) { setMicState("off"); return; }
        if (err === "not-allowed" || err === "service-not-allowed") {
          setMicState("denied");
          setBubble({ text: "No puedo oírte: permite el micrófono en el candado de la barra de direcciones y toca el punto de mi esquina." });
          return;
        }
        const f = failRef.current, now = Date.now();
        f.n = now - f.t < 4000 ? f.n + 1 : 0; f.t = now;
        if (f.n >= 6) { setMicState("off"); return; }
        if (!pausedRef.current) window.setTimeout(startMic, 250 + f.n * 400);
      },
    });
    micRef.current = l;
    if (!l) setMicState("unsupported");
  }, []);

  useEffect(() => {
    if (wantMic.current) { failRef.current = { n: 0, t: 0 }; startMic(); }
    else { stopMic(); setMicState("off"); }
    return () => stopMic();
  }, [cfg.listen, cfg.hidden, startMic, stopMic]);

  // si la pestaña vuelve a estar visible y el micrófono se había cerrado, se reabre
  useEffect(() => {
    const v = () => { if (document.visibilityState === "visible" && wantMic.current && !micRef.current && !pausedRef.current) startMic(); };
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, [startMic]);

  // ---------- servidor: ¿IA y voces en la nube? ----------
  useEffect(() => {
    fetch("/api/mascot/status").then((r) => (r.ok ? r.json() : null)).then((j) => { setAiOn(!!j?.ai); setCloud(j?.tts ? j.voices ?? [] : []); }).catch(() => {});
  }, []);
  useEffect(() => {
    const load = () => setVoices(listVoices(cloud));
    load();
    return onVoicesReady(load);
  }, [cloud]);

  // ---------- parpadeo ----------
  useEffect(() => {
    let alive = true;
    const loop = async () => {
      while (alive) {
        await sleep(2200 + Math.random() * 3200);
        if (!alive) return;
        setBlink(true); await sleep(120); setBlink(false);
      }
    };
    void loop();
    return () => { alive = false; };
  }, []);

  // ---------- los ojos siguen el cursor ----------
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = root.current; if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const d = Math.max(1, Math.hypot(dx, dy));
        const k = Math.min(1, d / 220);
        setLook({ x: (dx / d) * 4 * k, y: (dy / d) * 3 * k });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const onR = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  // ---------- saludo (una vez por sesión): si no te conoce, pregunta tu nombre ----------
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("netops.mascot.greeted") === "1"; sessionStorage.setItem("netops.mascot.greeted", "1"); } catch { /* ignorar */ }
    if (seen) return;
    const t = window.setTimeout(() => {
      const m = memRef.current;
      if (!m.name && !m.asked) {
        markAsked(); pendingName.current = true;
        say("¡Hola! Soy Bit, y quiero conocerte. ¿Cómo te llamas?", "happy");
        setMsgs((x) => [...x, { who: "bot", text: "¡Hola! Soy Bit, y quiero conocerte. ¿Cómo te llamas?" }]);
      } else {
        const g = GREET(new Date().getHours(), m.name, cfgRef.current.listen && sttSupported());
        say(g.text, g.mood);
      }
    }, 1800);
    return () => window.clearTimeout(t);
  }, [say]);

  // ---------- aprende tus hábitos y comenta al cambiar de sección (sin abusar) ----------
  const firstPath = useRef(true);
  const lastSection = useRef("");
  useEffect(() => {
    if (cfgRef.current.learn) trackRoute(pathname);
    if (firstPath.current) { firstPath.current = false; lastSection.current = "/" + pathname.split("/")[1]; return; }
    const section = "/" + pathname.split("/")[1];
    if (section === lastSection.current) return;
    lastSection.current = section;
    if (!cfgRef.current.idle || Date.now() - lastSay.current < 25000) return;
    const top = topSection();
    if (top && top.visits >= 10 && Math.random() < 0.2 && routeComment(pathname)) {
      say(`${memRef.current.name ? memRef.current.name + ", " : ""}veo que vives en ${top.name}. Si quieres, te preparo atajos o te ayudo con lo que más haces.`, "wink");
      return;
    }
    const c = routeComment(pathname);
    if (c) say(c.text, c.mood);
  }, [pathname, say]);

  // ---------- reacciona al cambio de tema ----------
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) { firstTheme.current = false; return; }
    const m: Record<string, string> = { light: "¡Qué luminosidad! Mis ojos agradecen el modo claro… o no.", dark: "Modo oscuro: ahora sí parecemos hackers.", ocean: "Océano: me siento un pez robot.", sky: "Cielo despejado, conexión estable.", aurora: "Aurora: ahora sí parece película de ciencia ficción.", system: "Seguiré el tema de tu sistema." };
    say(m[theme.pref], theme.pref === "dark" ? "smug" : "happy");
  }, [theme.pref, say]);

  // ---------- conexión ----------
  useEffect(() => {
    const off = () => say("Se cayó el internet… y no fui yo, lo juro.", "surprised");
    const on = () => say("¡Volvió la conexión! Siempre supe que regresarías.", "happy");
    window.addEventListener("offline", off); window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [say]);

  // ---------- comentarios espontáneos, escasos ----------
  useEffect(() => {
    let t: number;
    const next = () => {
      t = window.setTimeout(() => {
        const c = cfgRef.current;
        if (c.idle && !c.hidden && !openRef.current && document.visibilityState === "visible" && Date.now() - lastSay.current > 60000 && Date.now() - lastTalk.current > 90000) {
          const l = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
          say(l.text, l.mood);
        }
        next();
      }, 120000 + Math.random() * 120000);
    };
    next();
    return () => window.clearTimeout(t);
  }, [say]);

  useEffect(() => { listEnd.current?.scrollIntoView({ block: "end" }); }, [msgs, typing, open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  function runAction(a?: Action | null) {
    if (!a) return;
    if (a.kind === "go") navigate(a.to);
    else if (a.kind === "theme") setTheme(a.id as never);
    else if (a.kind === "voice") setMascot({ voice: a.on });
    else if (a.kind === "idle") setMascot({ idle: a.on });
    else if (a.kind === "listen") setMascot({ listen: a.on });
    else if (a.kind === "forget") forgetAll();
    else if (a.kind === "hide") setTimeout(() => { setOpen(false); setMascot({ hidden: true }); }, 900);
  }

  async function askAI(text: string): Promise<(Reply & { remember?: string[] }) | null> {
    if (!aiRef.current) return null;
    try {
      const history = msgsRef.current.filter((m) => m.who !== "note").slice(-12).map((m) => ({ role: m.who === "me" ? "user" : "assistant", content: m.text }));
      const m = memRef.current;
      const r = await fetch("/api/mascot/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: text }],
          pathname: pathRef.current, theme: themeRef.current.resolved,
          memory: m.facts, name: m.name || undefined, habits: habitsSummary() || undefined,
          now: new Date().toLocaleString("es-PE", { dateStyle: "full", timeStyle: "short" }),
        }),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  /** Procesa lo que dijiste o escribiste: aprende, piensa, responde (y habla si fue por voz). */
  async function ask(q: string, fromVoice = false) {
    const text = q.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    pausedRef.current = true; stopMic(); stopSpeaking();
    lastTalk.current = Date.now();
    setMsgs((m) => [...m.slice(-59), { who: "me", text }]);
    setDraft(""); setTyping(true); express("think", 8000);
    if (!openRef.current) setBubble({ heard: text, text: "Pensando…" });
    if (cfgRef.current.learn) countChat();

    let r: (Reply & { remember?: string[] }) | null = null;
    const notes: string[] = [];
    // ¿acaba de preguntarte el nombre?
    if (pendingName.current && text.split(/\s+/).length <= 5 && !text.includes("?")) {
      pendingName.current = false;
      const n = setName(text);
      if (n) { r = { text: `Mucho gusto, ${n}. Ya te tengo anotado. Cuéntame qué te gusta o en qué trabajas y lo recuerdo.`, mood: "happy" }; notes.push(`Se llama ${n}`); }
    }
    if (!r && cfgRef.current.learn) notes.push(...learnFrom(text));
    if (!r) {
      r = await askAI(text);
      if (r?.remember?.length && cfgRef.current.learn) r.remember.forEach((f) => { if (remember(f)) notes.push(f); });
    }
    if (!r) {
      await sleep(250 + Math.random() * 350);
      const m = memRef.current;
      r = answer(text, { pathname: pathRef.current, hour: new Date().getHours(), themeLabel: themeRef.current.pref, name: m.name, facts: m.facts, aiOn: aiRef.current });
    }
    setTyping(false);
    setMsgs((m) => [...m.slice(-59), { who: "bot", text: r!.text }, ...(notes.length ? [{ who: "note" as const, text: `Bit anotó: ${notes.join("; ")}` }] : [])]);
    express(r.mood, Math.min(10000, 2500 + r.text.length * 45));
    runAction(r.action);
    if (!openRef.current) {
      setBubble({ heard: text, text: r.text });
      window.clearTimeout(bubbleT.current);
    }
    await speak(r.text, fromVoice);
    if (!openRef.current) bubbleT.current = window.setTimeout(() => setBubble(null), 4500);
    busyRef.current = false; pausedRef.current = false;
    window.setTimeout(startMic, 350);
  }

  handleHeard.current = (raw: string) => {
    if (busyRef.current) return;
    const t = norm(raw);
    if (t.length < 2) return;
    if (cfgRef.current.needName) {
      const addressed = /(^| )bit( |$)/.test(t) || Date.now() - lastTalk.current < 25000;
      if (!addressed) return;
    }
    void ask(raw.replace(/^\s*(oye|hey|hola|ok)?[, ]*bit[,:]?\s*/i, "") || raw, true);
  };

  // ---------- arrastre ----------
  const drag = useRef<{ x: number; y: number; r: number; b: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, r: cfg.right, b: cfg.bottom, moved: false };
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    setMascot({ right: Math.max(4, Math.min(vp.w - 60, d.r - dx)), bottom: Math.max(4, Math.min(vp.h - 60, d.b - dy)) });
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved) return;
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 2000), now];
    if (clicks.current.length >= 5) {
      clicks.current = []; setOpen(false);
      say("¡Jajaja, cosquillas! Para, para… ¡que me desconfiguro!", "laugh");
      return;
    }
    if (talking) { stopSpeaking(); setTalking(false); }
    setBubble(null);
    setOpen((o) => !o);
    express("happy", 1500);
  };

  const toggleMic = () => {
    if (micState === "denied" || micState === "unsupported") {
      if (!sttSupported()) { say("Este navegador no tiene reconocimiento de voz. Usa Chrome o Edge.", "sad"); return; }
      failRef.current = { n: 0, t: 0 }; setMascot({ listen: true }); startMic(); return;
    }
    setMascot({ listen: !cfg.listen });
    say(cfg.listen ? "Micrófono apagado. Ya no te escucho." : "Te escucho. Háblame cuando quieras.", cfg.listen ? "sleepy" : "listening");
  };

  const toggleVoice = () => {
    if (!cfg.mute) { stopSpeaking(); setTalking(false); }
    setMascot({ mute: !cfg.mute });
  };

  const micLabel = !cfg.listen ? "Conversación apagada" : micState === "on" ? (busyRef.current ? "Pensando…" : "Escuchando") : micState === "denied" ? "Sin permiso de micrófono" : micState === "unsupported" ? "Este navegador no oye (usa Chrome o Edge)" : "Conectando micrófono…";

  const effMood: Mood = mood === "neutral" && cfg.listen && micState === "on" && !talking && !busyRef.current ? "neutral" : mood;
  const faceMood: Mood = effMood === "neutral" && interim ? "listening" : effMood;

  const panelW = Math.min(350, vp.w - 16);
  const panelRight = Math.max(8, Math.min(cfg.right, vp.w - panelW - 8));
  const panelBottom = cfg.bottom + lift + 62;
  const panelMax = Math.max(240, Math.min(vp.h * 0.7, vp.h - panelBottom - 12));

  if (cfg.hidden) return null;

  const grouped = (["Nube", "Español", "Otros idiomas"] as const).map((g) => [g, voices.filter((v) => v.group === g)] as const).filter(([, l]) => l.length);

  return (
    <div style={{ display: overlay ? "none" : "contents" }}>
      {open && (
        <section
          role="dialog" data-persist aria-label="Asistente Bit"
          className="fixed z-40 flex animate-pop flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft"
          style={{ right: panelRight, bottom: panelBottom, width: panelW, maxHeight: panelMax }}
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2" style={{ background: "linear-gradient(90deg, rgb(14 43 94), rgb(19 59 128))" }}>
            <MascotFace mood={faceMood} talking={talking} blink={blink} look={look} size={34} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-display text-sm font-bold text-white">Bit{mem.name ? ` · amigo de ${mem.name}` : ""}</div>
              <div className="truncate text-[11px] text-cyan2-300">{aiOn ? "Con inteligencia artificial" : "Modo básico (sin IA)"}</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10">Cerrar</button>
          </header>

          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <button type="button" onClick={toggleMic} className={cfg.listen && micState === "on" ? "btn-primary flex-1 py-1.5 text-xs" : "btn-secondary flex-1 py-1.5 text-xs"}>
              Micrófono: {cfg.listen ? "activado" : "apagado"}
            </button>
            <button type="button" onClick={toggleVoice} className={!cfg.mute ? "btn-primary flex-1 py-1.5 text-xs" : "btn-secondary flex-1 py-1.5 text-xs"}>
              Voz de Bit: {cfg.mute ? "apagada" : "activada"}
            </button>
            {cfg.listen && micState === "on" && (
              <span className="flex h-5 items-end gap-0.5" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`w-1 rounded-full bg-cyan2-400 ${interim ? "mf-bar" : "opacity-30"}`} style={{ height: 18, animationDelay: `${i * 0.12}s` }} />)}
              </span>
            )}
          </div>
          <div className="px-3 pt-1.5 text-[11px] text-slate-500">{interim ? `Te oigo: «${interim}»` : micLabel}</div>

          <div className="min-h-[110px] flex-1 space-y-2 overflow-y-auto px-3 py-2" aria-live="polite">
            {msgs.map((m, i) => m.who === "note" ? (
              <div key={i} className="text-center text-[10.5px] italic text-slate-500">{m.text}</div>
            ) : (
              <div key={i} className={`flex ${m.who === "me" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-snug ${m.who === "me" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"}`}>{m.text}</div>
              </div>
            ))}
            {typing && <div className="text-xs text-slate-500">Bit está pensando…</div>}
            <div ref={listEnd} />
          </div>

          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {QUICK.map((q) => (
              <button key={q.label} type="button" onClick={() => void ask(q.ask)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-cyan2-500 hover:text-brand-700">{q.label}</button>
            ))}
          </div>

          <form className="flex gap-2 border-t border-slate-200 p-2" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
            <input className="input py-1.5" placeholder="Escríbeme algo…" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn-primary px-3 py-1.5 text-xs" type="submit">Enviar</button>
          </form>

          <details className="border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-600">
            <summary className="cursor-pointer select-none">Voz y preferencias</summary>
            <div className="mt-2 space-y-2 pb-1">
              <label className="block">
                <span className="mb-0.5 block text-slate-500">Voz ({voices.length} disponibles)</span>
                <select className="input py-1 text-[11px]" value={cfg.voiceName} onChange={(e) => setMascot({ voiceName: e.target.value })}>
                  <option value="">Automática (la más natural)</option>
                  {grouped.map(([g, list]) => (
                    <optgroup key={g} label={g}>{list.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-slate-500">Estilo de voz</span>
                <select className="input py-1 text-[11px]" value={cfg.voiceStyle} onChange={(e) => setMascot({ voiceStyle: e.target.value })}>
                  {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <button type="button" className="btn-secondary px-2 py-1 text-[11px]" onClick={() => { express("happy"); void speak("Hola, así suena mi voz. ¿Te gusta?", true); }}>Probar la voz</button>
              {!cloud.length && <p className="text-slate-500">Para tener voces mucho más naturales y variadas, el servidor necesita OPENAI_API_KEY (voces en la nube). Mientras tanto uso las de tu navegador; en Edge hay voces «Natural».</p>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.voice} onChange={(e) => setMascot({ voice: e.target.checked })} />Responder en voz alta también cuando escribo</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.needName} onChange={(e) => setMascot({ needName: e.target.checked })} />Solo responder si digo «Bit» (ambientes con ruido)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.idle} onChange={(e) => setMascot({ idle: e.target.checked })} />Comentarios espontáneos</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.learn} onChange={(e) => setMascot({ learn: e.target.checked })} />Aprender de mí (gustos y hábitos)</label>

              <div className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1 flex items-center justify-between"><b className="text-slate-700">Lo que sé de ti</b>
                  <button type="button" className="text-red-600 hover:underline" onClick={() => { if (confirm("¿Borrar todo lo que Bit recuerda de ti?")) forgetAll(); }}>Olvidar todo</button></div>
                <label className="mb-1 flex items-center gap-2"><span className="w-14 text-slate-500">Nombre</span>
                  <input className="input py-1 text-[11px]" value={mem.name} placeholder="Aún no lo sé" onChange={(e) => setName(e.target.value)} /></label>
                {mem.facts.length ? (
                  <ul className="space-y-1">
                    {mem.facts.map((f, i) => (
                      <li key={i} className="flex items-start justify-between gap-2"><span>{f}</span><button type="button" className="shrink-0 text-slate-400 hover:text-red-600" onClick={() => forget(i)}>Quitar</button></li>
                    ))}
                  </ul>
                ) : <p className="text-slate-500">Aún no recuerdo nada. Dime «me gusta…», «trabajo en…», «prefiero…».</p>}
                <p className="mt-1 text-[10px] text-slate-400">Se guarda solo en este navegador.</p>
              </div>
            </div>
          </details>
          <div className="flex justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
            <span>{aiOn ? "Pregúntame lo que sea" : "Modo básico: sin IA en el servidor"}</span>
            <button type="button" className="hover:text-slate-800" onClick={() => { setOpen(false); setMascot({ hidden: true }); }}>Ocultar a Bit</button>
          </div>
        </section>
      )}

      {!open && (interim || bubble) && (
        <div
          role="status" data-persist
          onClick={() => setBubble(null)}
          className="fixed z-40 max-w-[min(280px,calc(100vw-90px))] animate-pop cursor-pointer rounded-2xl rounded-br-sm border border-slate-200 bg-white px-3 py-2 text-[12.5px] leading-snug text-slate-700 shadow-soft"
          style={{ right: cfg.right + 4, bottom: cfg.bottom + lift + 62 }}
        >
          {(interim || bubble?.heard) && <div className="mb-1 text-[11px] italic text-slate-500">«{interim || bubble?.heard}»</div>}
          {!interim && bubble?.text}
        </div>
      )}

      <button
        ref={root}
        type="button"
        aria-label="Asistente Bit: tócame para chatear, arrástrame para moverme"
        title="Bit · toca para chatear, arrastra para moverme"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
        className={`fixed z-40 flex h-[54px] w-[54px] touch-none select-none items-center justify-center rounded-full border border-white/20 shadow-glow transition-transform hover:scale-105 active:scale-95 ${faceMood === "laugh" ? "mascot-laugh" : faceMood === "surprised" ? "mascot-hop" : faceMood === "wink" || faceMood === "smug" ? "mascot-wiggle" : "mascot-idle"}`}
        style={{ right: cfg.right, bottom: cfg.bottom + lift, background: "radial-gradient(circle at 30% 25%, #2b72e6, #0e2b5e 75%)" }}
      >
        {cfg.listen && micState === "on" && <span className="mf-ring pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-400" />}
        <MascotFace mood={faceMood} talking={talking} blink={blink} look={look} size={46} />
      </button>

      {/* Indicador y interruptor del micrófono (siempre visible, pequeño) */}
      <button
        type="button" onClick={toggleMic} title={`${micLabel} · clic para ${cfg.listen ? "apagar" : "encender"}`} aria-label={`Micrófono: ${micLabel}`}
        className="fixed z-40 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white shadow-md transition-transform hover:scale-110"
        style={{ right: cfg.right - 4, bottom: cfg.bottom + lift + 38, background: !cfg.listen ? "#94a3b8" : micState === "on" ? "#22c55e" : micState === "denied" ? "#ef4444" : "#f59e0b" }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="#fff" stroke="none" /><path d="M5 11a7 7 0 0014 0M12 18v3" />
          {!cfg.listen && <path d="M4 4l16 16" stroke="#fff" />}
        </svg>
      </button>

      {/* Interruptor de la voz de Bit (independiente del micrófono) */}
      <button
        type="button" onClick={toggleVoice} title={`Voz de Bit: ${cfg.mute ? "apagada" : "activada"} · clic para ${cfg.mute ? "encender" : "apagar"}`} aria-label={`Voz de Bit: ${cfg.mute ? "apagada" : "activada"}`}
        className="fixed z-40 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white shadow-md transition-transform hover:scale-110"
        style={{ right: cfg.right + 40, bottom: cfg.bottom + lift + 38, background: cfg.mute ? "#94a3b8" : "#3b82f6" }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z" fill="#fff" />
          {cfg.mute ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11" />}
        </svg>
      </button>
    </div>
  );
}

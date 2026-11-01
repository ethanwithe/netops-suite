import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MascotFace from "./MascotFace";
import { Action, GREET, IDLE_LINES, Mood, QUICK, answer, routeComment } from "./brain";
import { setMascot, useMascotSettings } from "./settings";
import { THEME_OPTIONS, setTheme, useTheme } from "../store/theme";

interface Msg { who: "bot" | "me"; text: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Mascot() {
  const cfg = useMascotSettings();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();

  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<Mood>("neutral");
  const [talking, setTalking] = useState(false);
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [bubble, setBubble] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ who: "bot", text: "Hola, soy Bit. Pregúntame lo que quieras de la suite, pídeme un chiste o una cuenta. Escribe «ayuda» para ver todo lo que sé hacer." }]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });

  const root = useRef<HTMLButtonElement>(null);
  const moodT = useRef<number>();
  const talkT = useRef<number>();
  const bubbleT = useRef<number>();
  const lastSay = useRef(0);
  const listEnd = useRef<HTMLDivElement>(null);
  const clicks = useRef<number[]>([]);
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const openRef = useRef(open); openRef.current = open;

  const express = useCallback((m: Mood, ms = 3200) => {
    setMood(m);
    window.clearTimeout(moodT.current);
    if (m !== "neutral") moodT.current = window.setTimeout(() => setMood("neutral"), ms);
  }, []);

  const speak = useCallback((text: string) => {
    const ms = Math.min(5000, 600 + text.length * 38);
    setTalking(true);
    window.clearTimeout(talkT.current);
    talkT.current = window.setTimeout(() => setTalking(false), ms);
    if (!cfgRef.current.voice) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[«»<>]/g, ""));
      u.lang = "es-ES"; u.pitch = 1.5; u.rate = 1.05;
      const v = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith("es"));
      if (v) u.voice = v;
      synth.speak(u);
    } catch { /* sin voz */ }
  }, []);

  // Comentario flotante (no invasivo: pequeño, se va solo)
  const say = useCallback((text: string, m: Mood = "neutral") => {
    if (cfgRef.current.hidden) return;
    lastSay.current = Date.now();
    express(m);
    speak(text);
    if (!openRef.current) {
      setBubble(text);
      window.clearTimeout(bubbleT.current);
      bubbleT.current = window.setTimeout(() => setBubble(null), Math.min(9000, 4500 + text.length * 40));
    }
  }, [express, speak]);

  // ---- parpadeo
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

  // ---- los ojos siguen el cursor
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

  // ---- saludo (una vez por sesión)
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("netops.mascot.greeted") === "1"; sessionStorage.setItem("netops.mascot.greeted", "1"); } catch { /* ignorar */ }
    if (seen) return;
    const t = window.setTimeout(() => { const g = GREET(new Date().getHours()); say(g.text, g.mood); }, 1800);
    return () => window.clearTimeout(t);
  }, [say]);

  // ---- comentario al cambiar de sección (sin abusar)
  const firstPath = useRef(true);
  const lastSection = useRef("");
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; lastSection.current = "/" + pathname.split("/")[1]; return; }
    const section = "/" + pathname.split("/")[1];
    if (section === lastSection.current) return;
    lastSection.current = section;
    if (!cfgRef.current.idle || Date.now() - lastSay.current < 25000) return;
    const c = routeComment(pathname);
    if (c) say(c.text, c.mood);
  }, [pathname, say]);

  // ---- reacciona al cambio de tema
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) { firstTheme.current = false; return; }
    const m: Record<string, string> = { light: "¡Qué luminosidad! Mis ojos agradecen el modo claro… o no.", dark: "Modo oscuro: ahora sí parecemos hackers.", ocean: "Océano: me siento un pez robot.", system: "Seguiré el tema de tu sistema." };
    say(m[theme.pref], theme.pref === "dark" ? "smug" : "happy");
  }, [theme.pref, say]);

  // ---- conexión
  useEffect(() => {
    const off = () => say("Se cayó el internet… y no fui yo, lo juro.", "surprised");
    const on = () => say("¡Volvió la conexión! Siempre supe que regresarías.", "happy");
    window.addEventListener("offline", off); window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [say]);

  // ---- comentarios espontáneos, escasos y solo si la pestaña está visible
  useEffect(() => {
    let t: number;
    const next = () => {
      t = window.setTimeout(() => {
        const c = cfgRef.current;
        if (c.idle && !c.hidden && !openRef.current && document.visibilityState === "visible" && Date.now() - lastSay.current > 60000) {
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

  // Esc cierra el panel
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  function runAction(a?: Action) {
    if (!a) return;
    if (a.kind === "go") navigate(a.to);
    else if (a.kind === "theme") setTheme(a.id);
    else if (a.kind === "voice") { setMascot({ voice: a.on }); cfgRef.current = { ...cfgRef.current, voice: a.on }; }
    else if (a.kind === "idle") setMascot({ idle: a.on });
    else if (a.kind === "hide") setTimeout(() => { setOpen(false); setMascot({ hidden: true }); }, 900);
  }

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setMsgs((m) => [...m.slice(-39), { who: "me", text }]);
    setDraft("");
    setTyping(true); express("think", 900);
    await sleep(350 + Math.random() * 450);
    const r = answer(text, { pathname, hour: new Date().getHours(), themeLabel: THEME_OPTIONS.find((o) => o.id === theme.pref)?.label ?? "" });
    setTyping(false);
    setMsgs((m) => [...m.slice(-39), { who: "bot", text: r.text }]);
    express(r.mood, 3600);
    speak(r.text);
    runAction(r.action);
  }

  // ---- arrastre (la mascota se puede mover si estorba)
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
    setMascot({
      right: Math.max(4, Math.min(vp.w - 60, d.r - dx)),
      bottom: Math.max(4, Math.min(vp.h - 60, d.b - dy)),
    });
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
    setBubble(null);
    setOpen((o) => !o);
    express("happy", 1500);
  };

  if (cfg.hidden) return null;

  const panelW = Math.min(340, vp.w - 16);
  const panelRight = Math.max(8, Math.min(cfg.right, vp.w - panelW - 8));
  const panelBottom = cfg.bottom + 62;
  const panelMax = Math.max(220, Math.min(vp.h * 0.62, vp.h - panelBottom - 12));

  return (
    <>
      {open && (
        <section
          role="dialog" aria-label="Asistente Bit"
          className="fixed z-40 flex animate-pop flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft"
          style={{ right: panelRight, bottom: panelBottom, width: panelW, maxHeight: panelMax }}
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2" style={{ background: "linear-gradient(90deg, rgb(14 43 94), rgb(19 59 128))" }}>
            <MascotFace mood={mood} talking={talking} blink={blink} look={look} size={34} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-display text-sm font-bold text-white">Bit</div>
              <div className="truncate text-[11px] text-cyan2-300">Asistente · bromista oficial</div>
            </div>
            <button type="button" onClick={() => setMascot({ voice: !cfg.voice })} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10" title="Hablar en voz alta">
              Voz: {cfg.voice ? "sí" : "no"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10">Cerrar</button>
          </header>

          <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.who === "me" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-snug ${m.who === "me" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {typing && <div className="text-xs text-slate-500">Bit está pensando…</div>}
            <div ref={listEnd} />
          </div>

          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {QUICK.map((q) => (
              <button key={q.label} type="button" onClick={() => ask(q.ask)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-cyan2-500 hover:text-brand-700">
                {q.label}
              </button>
            ))}
          </div>

          <form className="flex gap-2 border-t border-slate-200 p-2" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
            <input className="input py-1.5" placeholder="Escríbeme algo…" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <button className="btn-primary px-3 py-1.5 text-xs" type="submit">Enviar</button>
          </form>
          <div className="flex justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
            <button type="button" className="hover:text-slate-800" onClick={() => setMascot({ idle: !cfg.idle })}>Comentarios solos: {cfg.idle ? "sí" : "no"}</button>
            <button type="button" className="hover:text-slate-800" onClick={() => { setOpen(false); setMascot({ hidden: true }); }}>Ocultar a Bit</button>
          </div>
        </section>
      )}

      {!open && bubble && (
        <div
          role="status"
          onClick={() => setBubble(null)}
          className="fixed z-40 max-w-[min(240px,calc(100vw-90px))] animate-pop cursor-pointer rounded-2xl rounded-br-sm border border-slate-200 bg-white px-3 py-2 text-[12.5px] leading-snug text-slate-700 shadow-soft"
          style={{ right: cfg.right + 4, bottom: cfg.bottom + 62 }}
        >
          {bubble}
        </div>
      )}

      <button
        ref={root}
        type="button"
        aria-label="Asistente Bit: tócame para chatear, arrástrame para moverme"
        title="Bit · toca para chatear, arrastra para moverme"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
        className={`fixed z-40 flex h-[54px] w-[54px] touch-none select-none items-center justify-center rounded-full border border-white/20 shadow-glow transition-transform hover:scale-105 active:scale-95 ${mood === "laugh" ? "mascot-laugh" : mood === "surprised" ? "mascot-hop" : mood === "wink" || mood === "smug" ? "mascot-wiggle" : "mascot-idle"}`}
        style={{ right: cfg.right, bottom: cfg.bottom, background: "radial-gradient(circle at 30% 25%, #2b72e6, #0e2b5e 75%)" }}
      >
        <MascotFace mood={mood} talking={talking} blink={blink} look={look} size={46} />
      </button>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { usePersistentState } from "../store/persistentState";
import type { ConsoleSession } from "../utils/webSerial";

type Saved = { id: string; name: string; cmds: string };

/** Convierte una tecla del navegador en lo que enviaría una terminal real (como MobaXterm/PuTTY). */
function keyToSeq(e: React.KeyboardEvent): string | null {
  if (e.ctrlKey && e.shiftKey) return null; // Ctrl+Shift+C/V: copiar/pegar del navegador
  if (e.ctrlKey && !e.altKey && e.key.length === 1) {
    const k = e.key.toUpperCase();
    if (k === "V") return null; // el pegado llega por onPaste
    if (k >= "A" && k <= "Z") return String.fromCharCode(k.charCodeAt(0) - 64);
    return null;
  }
  if (e.metaKey || e.altKey) return null;
  switch (e.key) {
    case "Enter": return "\r";
    case "Tab": return "\t";
    case "Backspace": return "\x7f";
    case "Escape": return "\x1b";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x01";
    case "End": return "\x05";
    case "Delete": return "\x1b[3~";
  }
  return e.key.length === 1 ? e.key : null;
}

const commonPrefix = (a: string[]) => a.reduce((p, s) => { let i = 0; while (i < p.length && i < s.length && p[i].toLowerCase() === s[i].toLowerCase()) i++; return p.slice(0, i); }, a[0] ?? "");

/**
 * CLI en vivo del router: salida, teclado directo al equipo (Tab, ?, flechas, Ctrl+C como en MobaXterm),
 * línea con autocompletado local (Tab) e historial, y «Mis comandos» guardados para enviar con un clic.
 */
export default function LiveCli({ onDownload, onForget, logSize, term, onClear, session, connected, busy, itemCmds, fill }: {
  onDownload: () => void;
  onForget: () => void;
  logSize: number;
  term: string;
  onClear: () => void;
  session: MutableRefObject<ConsoleSession | null>;
  connected: boolean;
  busy: boolean;
  itemCmds: string[];
  fill: (cmd: string) => string;
}) {
  const box = useRef<HTMLPreElement>(null);
  const [direct, setDirect] = useState(false);
  const [typed, setTyped] = useState("");
  const [hist, setHist] = usePersistentState<string[]>("checklist.cmdhist", []);
  const [saved, setSaved] = usePersistentState<Saved[]>("checklist.cmds", []);
  const [hi, setHi] = useState(-1);
  const [matches, setMatches] = useState<string[]>([]);
  const [form, setForm] = useState<Saved | null>(null);
  const [sending, setSending] = useState(false);
  const off = !connected || busy;

  // Se mantiene abajo mientras llega texto
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [term]);

  const pool = useMemo(() => {
    const all = [...saved.flatMap((s) => s.cmds.split("\n")), ...hist, ...itemCmds].map((x) => x.trim()).filter(Boolean);
    return Array.from(new Set(all));
  }, [saved, hist, itemCmds]);

  const remember = (line: string) => setHist((h) => [line, ...h.filter((x) => x !== line)].slice(0, 200));

  async function sendLine(line: string) {
    const s = session.current;
    if (!s || !line.trim()) return;
    remember(line.trim());
    await s.typed(line);
  }

  async function runSaved(c: Saved) {
    const s = session.current;
    if (!s || sending) return;
    setSending(true);
    try {
      for (const raw of c.cmds.split("\n")) {
        const line = fill(raw).trim();
        if (!line) continue;
        remember(line);
        await s.run(line, { maxMs: 30000 });
      }
    } finally { setSending(false); }
  }

  function onTermKey(e: React.KeyboardEvent) {
    if (!direct || off) return;
    const seq = keyToSeq(e);
    if (seq == null) return;
    e.preventDefault();
    void session.current?.raw(seq);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const q = typed.trimStart();
      const m = pool.filter((p) => p.toLowerCase().startsWith(q.toLowerCase()) && p.length > 0);
      if (!m.length) { setMatches([]); return; }
      if (m.length === 1) { setTyped(m[0]); setMatches([]); return; }
      const cp = commonPrefix(m);
      if (cp.length > q.length) setTyped(cp);
      setMatches(m.slice(0, 12));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const n = e.key === "ArrowUp" ? Math.min(hist.length - 1, hi + 1) : Math.max(-1, hi - 1);
      setHi(n);
      setTyped(n >= 0 ? hist[n] ?? "" : "");
    } else if (e.key === "Escape") setMatches([]);
  }

  function save() {
    if (!form || !form.cmds.trim()) return;
    const item = { ...form, name: form.name.trim() || form.cmds.trim().split("\n")[0].slice(0, 30) };
    setSaved((l) => (l.some((x) => x.id === item.id) ? l.map((x) => (x.id === item.id ? item : x)) : [...l, item]));
    setForm(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">CLI del router en vivo <span className="font-normal text-slate-400">· se guarda sola{logSize ? ` (${Math.max(1, Math.round(logSize / 1024))} KB)` : ""}</span></p>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-600" title="Cada tecla va directo al equipo: Tab completa, ? ayuda, ↑↓ historial del router, Ctrl+C cancela (como MobaXterm)">
            <input type="checkbox" checked={direct} onChange={(e) => { setDirect(e.target.checked); if (e.target.checked) setTimeout(() => box.current?.focus(), 0); }} />
            Teclado directo (Tab, ?, flechas)
          </label>
          <button className="text-xs font-medium text-sky-700 hover:underline disabled:opacity-40" disabled={!logSize} onClick={onDownload} title="Descarga todo lo de la sesión (comandos y respuestas) en un archivo de texto">⬇ Descargar .txt</button>
          <button className="text-xs text-slate-400 hover:underline" onClick={onClear} title="Solo limpia la pantalla; el registro guardado se conserva">limpiar pantalla</button>
          <button className="text-xs text-slate-400 hover:text-red-600 hover:underline" disabled={!logSize} onClick={onForget} title="Borra el registro guardado">borrar registro</button>
        </div>
      </div>

      <pre
        ref={box}
        tabIndex={direct ? 0 : -1}
        onKeyDown={onTermKey}
        onPaste={(e) => { if (direct && !off) { e.preventDefault(); void session.current?.raw(e.clipboardData.getData("text").replace(/\r?\n/g, "\r")); } }}
        className={`h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black p-3 font-mono text-[11px] leading-snug text-green-200 outline-none ${direct ? "ring-2 ring-sky-400" : ""}`}
      >{term || "(esperando datos de la consola…)"}</pre>
      {direct && <p className="text-[11px] text-sky-600">Escribiendo directo en el equipo: haz clic en la terminal y teclea. Tab completa el comando en el router, «?» muestra ayuda, Ctrl+C cancela, Ctrl+Shift+V pega.</p>}

      {!direct && (
        <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!connected) return; if (typed.trim()) { if (!off) { void sendLine(typed); setTyped(""); setHi(-1); setMatches([]); } } else void session.current?.raw("\r"); }}>
            <input className="input flex-1 font-mono text-xs" value={typed} disabled={off} spellCheck={false} autoComplete="off"
              placeholder="Comando + Enter · vacío + Enter = solo Enter al equipo · Tab completa · ↑↓ historial"
              onChange={(e) => { setTyped(e.target.value); setMatches([]); setHi(-1); }} onKeyDown={onInputKey} />
            <button className="btn-secondary text-xs" disabled={!connected} title="Con la línea vacía envía solo Enter">{typed.trim() ? "Enviar" : "Enter ↵"}</button>
          </form>
          {matches.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {matches.map((m) => (
                <button key={m} type="button" className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-sky-100" onClick={() => { setTyped(m); setMatches([]); }}>{m}</button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-400">Teclas al equipo:</span>
        {([["Enter ↵", "\r"], ["Espacio", " "], ["Y", "y"], ["N", "n"], ["Tab", "\t"], ["?", "?"], ["Esc", "\x1b"], ["Ctrl+C", "\x03"]] as const).map(([l, seq]) => (
          <button key={l} type="button" disabled={!connected} className="rounded border border-slate-200 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-sky-50 disabled:opacity-40"
            title="Se envía al router al instante (aunque esté corriendo algo)" onClick={() => void session.current?.raw(seq)}>{l}</button>
        ))}
      </div>

      <details className="rounded-lg border border-slate-200 px-3 py-2" open={saved.length > 0}>
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Mis comandos ({saved.length})</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {saved.map((c) => (
              <span key={c.id} className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 text-xs">
                <button type="button" className="px-2 py-1 hover:bg-sky-50 disabled:opacity-50" disabled={off || sending} title={c.cmds} onClick={() => void runSaved(c)}>{sending ? "…" : "▶"} {c.name}</button>
                <button type="button" className="border-l px-1.5 py-1 text-slate-400 hover:bg-slate-50" title="Editar" onClick={() => setForm(c)}>✎</button>
                <button type="button" className="border-l px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar" onClick={() => setSaved((l) => l.filter((x) => x.id !== c.id))}>×</button>
              </span>
            ))}
            {!saved.length && <span className="text-xs text-slate-400">Guarda comandos o secuencias (uno por línea) y envíalos con un clic.</span>}
          </div>
          {form ? (
            <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
              <input className="input w-full text-xs" placeholder="Nombre (ej. Ver interfaces)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <textarea className="input w-full font-mono text-xs" rows={4} spellCheck={false} placeholder={"Un comando por línea. Puedes usar {WAN}, {LAN}… de los parámetros.\nshow ip interface brief\nshow interfaces {WAN}"}
                value={form.cmds} onChange={(e) => setForm({ ...form, cmds: e.target.value })} />
              <div className="flex gap-2">
                <button type="button" className="btn-primary text-xs" onClick={save} disabled={!form.cmds.trim()}>Guardar</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setForm(null)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-secondary text-xs" onClick={() => setForm({ id: Math.random().toString(36).slice(2, 10), name: "", cmds: typed })}>+ Agregar comando</button>
          )}
        </div>
      </details>
    </div>
  );
}

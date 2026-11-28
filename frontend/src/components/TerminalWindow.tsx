import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "../store/persistentState";
import { connectTerminal, disconnectTerminal, sendRaw, termClear, termForget, termLog, getSession, useTerminal, vt, interruptCount, setBackMode, setKeepAlive, getHistory, clearHistory, termNote, watchFinish, isWatching, getLastOpts, reconnectTerminal } from "../store/terminal";
import type { BackMode } from "../store/terminal";
import { puenteEstado } from "../utils/puente";
import type { PuenteEstado } from "../utils/puente";
import { webSerialSupported } from "../utils/webSerial";
import TerminalView, { THEMES } from "./TerminalView";
import { canvasBlob, termCanvas } from "../utils/termImage";
import { notify, saveFile } from "../utils/saveFile";

type Saved = { id: string; name: string; cmds: string };
type Sesion = { id: string; name: string; via: "serial" | "ssh"; mode: "puente" | "navegador"; host: string; port: number; user: string; puerto: string; baud: number };

const PRESETS: Record<string, [string, string][]> = {
  Cisco: [["Sin paginación", "terminal length 0"], ["Interfaces (resumen)", "show ip interface brief"], ["Versión", "show version"], ["Config activa", "show running-config"], ["Rutas", "show ip route"], ["ARP", "show ip arp"], ["Interfaces", "show interfaces"], ["Descripciones", "show interfaces description"]],
  Huawei: [["Sin paginación", "screen-length 0 temporary"], ["Interfaces (resumen)", "display ip interface brief"], ["Versión", "display version"], ["Config activa", "display current-configuration"], ["Rutas", "display ip routing-table"], ["ARP", "display arp"], ["Interfaz", "display interface"]],
  Fortinet: [["Sin paginación", "config system console\nset output standard\nend"], ["Estado", "get system status"], ["Interfaces", "show system interface"], ["IPs", "diagnose ip address list"], ["Rutas", "get router info routing-table all"], ["ARP", "get system arp"]],
};
const NEW = (): Sesion => ({ id: Math.random().toString(36).slice(2, 9), name: "", via: "serial", mode: "puente", host: "", port: 22, user: "", puerto: "", baud: 9600 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Terminal estilo MobaXterm: consola o SSH, escribes directo en la pantalla, sesiones guardadas, comandos rápidos y más. */
export default function TerminalWindow() {
  const t = useTerminal();
  const connected = t.connected;
  const [via, setVia] = usePersistentState<"serial" | "ssh">("checklist.via", "serial");
  const [code, setCode] = usePersistentState("puente.codigo", "");
  const [puerto, setPuerto] = usePersistentState("checklist.puerto", "");
  const [ssh, setSsh] = usePersistentState("checklist.ssh", { host: "", port: 22, user: "" });
  const [baud, setBaud] = usePersistentState("checklist.baud", 9600);
  const [pass, setPass] = useState("");
  const [pst, setPst] = useState<PuenteEstado | null>(null);
  const [sesiones, setSesiones] = usePersistentState<Sesion[]>("terminal.sesiones", []);
  const [saved, setSaved] = usePersistentState<Saved[]>("checklist.cmds", []);
  const [theme, setTheme] = usePersistentState("terminal.tema", "Oscuro");
  const [fontSize, setFontSize] = usePersistentState("terminal.fuente", 13);
  const [keep, setKeep] = usePersistentState("terminal.mantener", true);
  const [autoCopy, setAutoCopy] = usePersistentState("terminal.copiarAuto", true);
  const [back, setBack] = usePersistentState<BackMode>("terminal.retroceso", "auto");
  const [panel, setPanel] = useState<"" | "cmds" | "multi" | "conn" | "hist">("");
  const [histQ, setHistQ] = useState("");
  const [delay, setDelay] = usePersistentState("terminal.pausa", 250);
  const [find, setFind] = useState<string | null>(null);
  const [hl, setHl] = useState<number | undefined>();
  const [multi, setMulti] = useState("");
  const [sending, setSending] = useState(false);
  const [vendor, setVendor] = usePersistentState<keyof typeof PRESETS>("terminal.marca", "Cisco");
  const [form, setForm] = useState<Saved | null>(null);

  // el puente se consulta solo mientras no hay conexión
  useEffect(() => {
    if (connected) return;
    let alive = true;
    const tick = async () => {
      const r = await puenteEstado(code);
      if (!alive) return;
      setPst((o) => (JSON.stringify(o) === JSON.stringify(r) ? o : r));
      if (r.kind === "ok" && r.ports.length && !r.ports.some((x) => x.device === puerto)) setPuerto((r.ports.find((x) => x.usb) ?? r.ports[0]).device);
    };
    void tick();
    const i = window.setInterval(() => void tick(), 3000);
    return () => { alive = false; window.clearInterval(i); };
  }, [connected, code]); // eslint-disable-line react-hooks/exhaustive-deps

  // mantener la sesión abierta (lo hace el almacén de la terminal, también con esta ventana cerrada) y el retroceso
  useEffect(() => { setKeepAlive(keep); }, [keep]);
  useEffect(() => { setBackMode(back); }, [back]);

  useEffect(() => { if (connected) setPanel((p) => (p === "conn" ? "" : p)); }, [connected]);

  const conn = (mode: "puente" | "navegador", v = via, extra: Partial<{ host: string; port: number; user: string; puerto: string; baud: number }> = {}) =>
    void connectTerminal({ mode, via: v, code, puerto: extra.puerto ?? puerto, baud: extra.baud ?? baud, host: extra.host ?? ssh.host, port: extra.port ?? ssh.port, user: extra.user ?? ssh.user, pass });

  function saveSession() {
    const s: Sesion = { ...NEW(), via, mode: "puente", host: ssh.host, port: ssh.port, user: ssh.user, puerto, baud,
      name: via === "ssh" ? `${ssh.user}@${ssh.host}` : `Consola ${puerto || ""}` };
    const n = prompt("Nombre de la sesión:", s.name);
    if (n === null) return;
    setSesiones((l) => [...l, { ...s, name: n.trim() || s.name }]);
  }
  function openSesion(s: Sesion) {
    setVia(s.via); setSsh({ host: s.host, port: s.port, user: s.user }); setPuerto(s.puerto); setBaud(s.baud);
    if (s.via === "ssh" && !pass) { setPanel("conn"); return; } // falta la contraseña: no se guarda
    conn(s.mode, s.via, { host: s.host, port: s.port, user: s.user, puerto: s.puerto, baud: s.baud });
  }

  async function sendLines(text: string, pause = delay) {
    if (!connected || sending) return;
    setSending(true);
    try {
      const stopAt = interruptCount();
      for (const raw of text.split("\n")) {
        if (!getSession()?.connected || interruptCount() !== stopAt) break;       // Ctrl+C corta el envío de lo que faltaba
        sendRaw(raw.replace(/\s+$/, "") + "\r");
        await sleep(pause);
      }
    } finally { setSending(false); }
  }

  function doFind(dir: 1 | -1) {
    const q = (find ?? "").toLowerCase();
    if (!q) return;
    const n = vt.lines.length;
    const start = hl ?? (dir === 1 ? -1 : n);
    for (let k = 1; k <= n; k++) {
      const y = (((start + dir * k) % n) + n) % n;
      if (vt.lines[y].map((c) => c.c).join("").toLowerCase().includes(q)) { setHl(y); return; }
    }
    setHl(undefined);
  }

  const dl = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([termLog() || vt.text() || "(sin registro)"], { type: "text/plain;charset=utf-8" }));
    a.download = `terminal_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copyAll = () => { void navigator.clipboard?.writeText(vt.text()).catch(() => undefined); };
  const pasteClip = async () => { try { const x = await navigator.clipboard.readText(); if (x) sendRaw(x.replace(/\r?\n/g, "\r")); } catch { /* sin permiso */ } };

  const fileRef = useRef<HTMLInputElement>(null);
  async function sendFile(f: File | undefined) {
    if (!f) return;
    const txt = (await f.text()).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    const n = txt ? txt.split("\n").length : 0;
    if (!n) { notify("El archivo está vacío.", "error"); return; }
    if (n > 3000 || !confirm(`¿Enviar las ${n} líneas de «${f.name}» al equipo, una tras otra (pausa de ${delay} ms)? Ctrl+C las detiene.`)) return;
    void sendLines(txt);
  }
  async function shot() {
    const th = THEMES[theme] ?? THEMES.Oscuro;
    const cv = termCanvas(vt.lines, { bg: th.bg, fg: th.fg, fontSize: fontSize + 1, paint: theme === "Verde" || theme === "Ámbar" ? "" : theme === "Claro" ? "light" : "dark" });
    const blob = cv ? await canvasBlob(cv) : null;
    if (!blob) { notify("No hay nada en pantalla para guardar.", "error"); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("Imagen copiada: pégala en Word, correo o chat.", "ok", { label: "Guardar PNG", run: () => void saveFile(blob, `terminal_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`) }, 7000);
    } catch { await saveFile(blob, `terminal_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`); }
  }
  const matches = useMemo(() => {
    const q = (find ?? "").toLowerCase();
    if (!q) return 0;
    return vt.lines.reduce((n, l) => n + (l.map((c) => c.c).join("").toLowerCase().includes(q) ? 1 : 0), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find, t.rev]);
  const hist = getHistory();

  const btn = "rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-sky-50 disabled:opacity-40";
  const keys = useMemo(() => [["Enter", "\r"], ["Tab", "\t"], ["?", "?"], ["Esc", "\x1b"], ["Espacio", " "], ["Y", "y"], ["N", "n"], ["↑", "\x1b[A"], ["↓", "\x1b[B"], ["Ctrl+C", "\x03"], ["Ctrl+Z", "\x1a"], ["Ctrl+D", "\x04"]] as const, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-slate-800">
      {/* barra */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${connected ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{connected ? `● ${t.label}` : "Sin conexión"}</span>
        {connected ? <button className={btn} onClick={() => void disconnectTerminal()}>Desconectar</button>
          : <>
            <button className={btn} onClick={() => setPanel(panel === "conn" ? "" : "conn")}>Conexión</button>
            {getLastOpts() && <button className={btn} onClick={() => void reconnectTerminal()} title="Vuelve a conectar con los mismos datos de la última vez">↻ Reconectar</button>}
          </>}
        {sesiones.length > 0 && (
          <select className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px]" value="" disabled={connected} onChange={(e) => { const s = sesiones.find((x) => x.id === e.target.value); if (s) openSesion(s); }} aria-label="Sesiones guardadas">
            <option value="">Sesiones guardadas…</option>
            {sesiones.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <button className={btn} onClick={() => setPanel(panel === "cmds" ? "" : "cmds")}>Comandos</button>
        <button className={btn} onClick={() => setPanel(panel === "multi" ? "" : "multi")}>Enviar varios</button>
        <button className={btn} onClick={() => setPanel(panel === "hist" ? "" : "hist")} title="Lo que has escrito o enviado: clic para volver a enviarlo">Historial</button>
        <button className={btn} onClick={() => setFind(find === null ? "" : null)}>Buscar</button>
        <button className={btn} onClick={() => setFontSize(Math.max(9, fontSize - 1))} title="Letra más chica">A−</button>
        <button className={btn} onClick={() => setFontSize(Math.min(24, fontSize + 1))} title="Letra más grande">A+</button>
        <select className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px]" value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Colores">
          {Object.keys(THEMES).map((k) => <option key={k}>{k}</option>)}
        </select>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className={btn} onClick={() => void shot()} title="Imagen de la pantalla con colores: se copia para pegarla (o se guarda como PNG)">📷 Imagen</button>
          <button className={btn} onClick={() => termNote("Marca")} title="Pone una línea con la fecha y hora en la pantalla y el registro (evidencia)">🕒 Hora</button>
          <button className={`${btn} ${isWatching() ? "!border-amber-400 !bg-amber-100" : ""}`} disabled={!connected} onClick={() => watchFinish(!isWatching())} title="Suena y avisa cuando el comando que está corriendo termine (vuelva el prompt), aunque estés en otra pestaña">{isWatching() ? "🔔 Avisando…" : "🔔 Avisar al terminar"}</button>
          <button className={btn} onClick={copyAll} title="Copia toda la pantalla">Copiar todo</button>
          <button className={btn} disabled={!connected} onClick={() => void pasteClip()} title="Pega del portapapeles (también clic derecho o Shift+Insert)">Pegar</button>
          <button className={btn} onClick={dl} title="Descarga todo lo de la sesión en un .txt">⬇ .txt</button>
          <button className={btn} onClick={termClear} title="Limpia la pantalla (el registro se conserva)">Limpiar</button>
          <button className={btn} onClick={() => confirm("¿Borrar también el registro guardado?") && termForget()}>Borrar registro</button>
        </span>
      </div>

      {find !== null && (
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <input autoFocus className="input !py-0.5 flex-1 text-xs" placeholder="Buscar en la pantalla…" value={find} onChange={(e) => { setFind(e.target.value); setHl(undefined); }} onKeyDown={(e) => { if (e.key === "Enter") doFind(e.shiftKey ? -1 : 1); if (e.key === "Escape") setFind(null); }} />
          <span className="text-[11px] text-slate-500">{find ? `${matches} línea${matches === 1 ? "" : "s"}` : ""}</span>
          <button className={btn} onClick={() => doFind(-1)}>↑</button>
          <button className={btn} onClick={() => doFind(1)}>↓</button>
          <button className={btn} onClick={() => { setFind(null); setHl(undefined); }}>✕</button>
        </div>
      )}

      {panel === "conn" && !connected && (
        <div className="space-y-2 border-b border-slate-200 bg-white p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg-mini inline-flex overflow-hidden rounded border border-slate-300">
              <button type="button" className={`px-3 py-1 ${via === "serial" ? "bg-brand-600 text-white" : "bg-white"}`} onClick={() => setVia("serial")}>Consola (cable USB/COM)</button>
              <button type="button" className={`px-3 py-1 ${via === "ssh" ? "bg-brand-600 text-white" : "bg-white"}`} onClick={() => setVia("ssh")}>SSH</button>
            </div>
            <label className="flex items-center gap-1 text-slate-500">Código del puente
              <input className="input !w-28 !py-0.5 font-mono text-xs uppercase" value={code} onChange={(e) => setCode(e.target.value.trim().toUpperCase())} placeholder="A1B2C3" /></label>
            {pst?.kind === "ok" && <span className="text-green-700">Puente conectado</span>}
            {pst?.kind === "codigo" && <span className="font-semibold text-red-600">El código del puente cambió: copia el nuevo.</span>}
            {pst?.kind === "ausente" && <span className="text-slate-500">Puente no detectado (ábrelo en tu laptop: <a className="underline" href="/api/tools/puente.py" download>descargar puente.py</a>).</span>}
          </div>
          {via === "serial" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-slate-500">Puerto
                <select className="input mt-0.5 block !w-56 !py-0.5 text-xs" value={puerto} onChange={(e) => setPuerto(e.target.value)}>
                  {pst?.kind === "ok" && pst.ports.length === 0 && <option value="">Sin puertos: conecta el cable</option>}
                  {pst?.kind === "ok" && pst.ports.map((p) => <option key={p.device} value={p.device}>{p.device} · {p.desc || p.fabricante || ""}</option>)}
                </select></label>
              <label className="text-slate-500">Baudios
                <select className="input mt-0.5 block !py-0.5 text-xs" value={baud} onChange={(e) => setBaud(Number(e.target.value))}>{[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}</select></label>
              <button className="btn-primary !py-1 text-xs" disabled={pst?.kind !== "ok" || !puerto} onClick={() => conn("puente")}>Conectar con el puente</button>
              {webSerialSupported() && <button className="btn-secondary !py-1 text-xs" onClick={() => conn("navegador")} title="Sin el puente: el navegador te deja elegir el puerto (Chrome/Edge)">Conectar con el navegador</button>}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-slate-500">IP o nombre<input className="input mt-0.5 block !w-40 !py-0.5 text-xs" placeholder="192.168.1.1" value={ssh.host} onChange={(e) => setSsh({ ...ssh, host: e.target.value })} /></label>
              <label className="text-slate-500">Puerto<input className="input mt-0.5 block !w-16 !py-0.5 text-xs" type="number" value={ssh.port} onChange={(e) => setSsh({ ...ssh, port: Number(e.target.value) })} /></label>
              <label className="text-slate-500">Usuario<input className="input mt-0.5 block !w-28 !py-0.5 text-xs" value={ssh.user} onChange={(e) => setSsh({ ...ssh, user: e.target.value })} /></label>
              <label className="text-slate-500">Contraseña<input className="input mt-0.5 block !w-32 !py-0.5 text-xs" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
              <button className="btn-primary !py-1 text-xs" disabled={pst?.kind !== "ok" || !ssh.host.trim() || !ssh.user.trim()} onClick={() => conn("puente")}>Conectar por SSH</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary !py-0.5 text-xs" onClick={saveSession}>Guardar esta conexión</button>
            {sesiones.map((s) => (
              <span key={s.id} className="inline-flex items-center overflow-hidden rounded border border-slate-200">
                <button className="px-2 py-0.5 hover:bg-sky-50" onClick={() => openSesion(s)}>{s.name}</button>
                <button className="border-l px-1.5 text-slate-400 hover:text-red-600" title="Quitar" onClick={() => setSesiones((l) => l.filter((x) => x.id !== s.id))}>×</button>
              </span>
            ))}
            
          </div>
          {t.status && <p className="font-mono text-[11px] text-slate-500">{t.status}</p>}
        </div>
      )}

      {panel === "cmds" && (
        <div className="space-y-2 border-b border-slate-200 bg-white p-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="rounded border border-slate-300 bg-white px-1 py-0.5" value={vendor} onChange={(e) => setVendor(e.target.value as keyof typeof PRESETS)}>{Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}</select>
            {PRESETS[vendor].map(([n, c]) => <button key={n} className={btn} disabled={!connected || sending} title={c} onClick={() => void sendLines(c)}>{n}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400">Mis comandos:</span>
            {saved.map((c) => (
              <span key={c.id} className="inline-flex items-center overflow-hidden rounded border border-slate-200">
                <button className="px-2 py-0.5 hover:bg-sky-50 disabled:opacity-40" disabled={!connected || sending} title={c.cmds} onClick={() => void sendLines(c.cmds)}>▶ {c.name}</button>
                <button className="border-l px-1.5 text-slate-400 hover:bg-slate-50" onClick={() => setForm(c)}>✎</button>
                <button className="border-l px-1.5 text-slate-400 hover:text-red-600" onClick={() => setSaved((l) => l.filter((x) => x.id !== c.id))}>×</button>
              </span>
            ))}
            {!form && <button className={btn} onClick={() => setForm({ id: Math.random().toString(36).slice(2, 10), name: "", cmds: "" })}>+ Nuevo</button>}
          </div>
          {form && (
            <div className="space-y-1 rounded bg-slate-50 p-2">
              <input className="input w-full !py-0.5 text-xs" placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <textarea className="input w-full font-mono text-xs" rows={3} placeholder="Un comando por línea" value={form.cmds} onChange={(e) => setForm({ ...form, cmds: e.target.value })} />
              <div className="flex gap-2">
                <button className="btn-primary !py-0.5 text-xs" disabled={!form.cmds.trim()} onClick={() => { const it = { ...form, name: form.name.trim() || form.cmds.split("\n")[0].slice(0, 30) }; setSaved((l) => (l.some((x) => x.id === it.id) ? l.map((x) => (x.id === it.id ? it : x)) : [...l, it])); setForm(null); }}>Guardar</button>
                <button className="btn-secondary !py-0.5 text-xs" onClick={() => setForm(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {panel === "multi" && (
        <div className="space-y-1 border-b border-slate-200 bg-white p-2 text-xs">
          <textarea className="input w-full font-mono text-xs" rows={4} placeholder="Pega aquí varios comandos (uno por línea) y se envían uno tras otro" value={multi} onChange={(e) => setMulti(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary !py-0.5 text-xs" disabled={!connected || sending || !multi.trim()} onClick={() => void sendLines(multi)}>{sending ? "Enviando…" : "Enviar"}</button>
            <button className="btn-secondary !py-0.5 text-xs" onClick={() => setMulti("")}>Limpiar</button>
            <button className="btn-secondary !py-0.5 text-xs" disabled={!connected || sending} onClick={() => fileRef.current?.click()} title="Envía un archivo de texto (configuración) línea por línea">📄 Enviar archivo…</button>
            <input ref={fileRef} type="file" accept=".txt,.cfg,.conf,.log,text/plain" className="hidden" onChange={(e) => { void sendFile(e.target.files?.[0]); e.target.value = ""; }} />
            <label className="ml-auto flex items-center gap-1 text-slate-500">Pausa entre líneas
              <select className="rounded border border-slate-300 bg-white px-1 py-0 text-xs" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                {[100, 250, 500, 1000, 2000].map((d) => <option key={d} value={d}>{d} ms</option>)}
              </select></label>
          </div>
        </div>
      )}

      {panel === "hist" && (
        <div className="space-y-1 border-b border-slate-200 bg-white p-2 text-xs">
          <div className="flex items-center gap-2">
            <input className="input !py-0.5 flex-1 text-xs" placeholder="Filtrar el historial…" value={histQ} onChange={(e) => setHistQ(e.target.value)} />
            <button className="btn-secondary !py-0.5 text-xs" onClick={() => confirm("¿Borrar el historial de comandos?") && clearHistory()}>Borrar</button>
          </div>
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {hist.length === 0 && <span className="text-slate-400">Aquí aparece lo que escribas o envíes.</span>}
            {[...hist].reverse().filter((c) => !histQ || c.toLowerCase().includes(histQ.toLowerCase())).slice(0, 80).map((c) => (
              <span key={c} className="inline-flex items-center overflow-hidden rounded border border-slate-200 font-mono">
                <button className="px-2 py-0.5 hover:bg-sky-50 disabled:opacity-40" disabled={!connected || sending} title="Enviar al equipo" onClick={() => void sendLines(c)}>{c}</button>
                <button className="border-l px-1.5 text-slate-400 hover:bg-slate-50" title="Copiar" onClick={() => { void navigator.clipboard?.writeText(c); notify("Copiado", "ok", undefined, 900); }}>⧉</button>
                <button className="border-l px-1.5 text-slate-400 hover:bg-slate-50" title="Guardar en «Mis comandos»" onClick={() => { setSaved((l) => (l.some((x) => x.cmds === c) ? l : [...l, { id: Math.random().toString(36).slice(2, 10), name: c.slice(0, 30), cmds: c }])); notify("Guardado en Mis comandos", "ok", undefined, 1200); }}>★</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <TerminalView connected={connected} theme={theme} fontSize={fontSize} hl={hl} autoCopy={autoCopy} onZoom={(d) => setFontSize(Math.max(9, Math.min(24, fontSize + d)))} onSearchKey={() => setFind(find ?? "")} />

      <div className="flex flex-wrap items-center gap-1 border-t border-slate-200 bg-slate-50 px-2 py-1">
        {keys.map(([l, seq]) => <button key={l} className={`${btn} font-mono`} disabled={!connected} onClick={() => sendRaw(seq)}>{l}</button>)}
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-600" title="Marcar texto lo copia solo (Ctrl+C siempre cancela; Ctrl+Shift+C copia; clic derecho pega)">
          <input type="checkbox" checked={autoCopy} onChange={(e) => setAutoCopy(e.target.checked)} /> Copiar al marcar
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-600" title="Retroceso: Auto usa Ctrl+H en Huawei (<equipo>) y DEL en el resto. Si no borra, prueba la otra opción.">
          Borrar:
          <select className="rounded border border-slate-300 bg-white px-1 py-0 text-[11px]" value={back} onChange={(e) => setBack(e.target.value as BackMode)}>
            <option value="auto">Auto</option><option value="del">DEL</option><option value="bs">Ctrl+H</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-600" title="Si no usas la sesión, envía un espacio y su borrado cada 40 s para que el equipo no la cierre por inactividad (no se ve en pantalla)">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Mantener sesión abierta
        </label>
      </div>
    </div>
  );
}

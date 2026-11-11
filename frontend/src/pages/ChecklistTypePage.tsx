import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import ChecklistStructure from "../components/ChecklistStructure";
import ImageAnnotator from "../components/ImageAnnotator";
import SaturadorPanel from "../components/SaturadorPanel";
import LiveCli from "../components/LiveCli";
import { NO_LOGO } from "../logo";
import type { LogoSel } from "../logo";
import { usePersistentState } from "../store/persistentState";
import { deleteChecklistType, updateChecklistType, useChecklistTypes } from "../store/checklistTypes";
import type { CkData, CkItem, CkType } from "../store/checklistTypes";
import ClientPicker from "../components/ClientPicker";
import { syncClient, useSotSync } from "../store/clients";
import { useWorkspace } from "../store/workspaces";
import WorkspaceBar from "../components/WorkspaceBar";
import type { ClientRecord } from "../store/clients";
import { SerialSession, webSerialSupported } from "../utils/webSerial";
import type { ConsoleSession } from "../utils/webSerial";
import { PuenteSession, puenteEstado } from "../utils/puente";
import type { PuenteEstado } from "../utils/puente";
import {
  extractBandwidthMbps, extractModel, fechaLarga, fillCmd, hoyISO, isSatItem, parseRates, servicioLabel,
} from "../utils/checklistInfo";

interface Row {
  incluir: boolean;
  /** Salida del comando (o lo que pegues a mano). */
  texto: string;
  images: { path: string; url: string }[];
}

interface RunState {
  sot: string;
  cid: string;
  cliente: string;
  fecha: string; // yyyy-mm-dd
  modelo: string;
  ancho: string;
  params: Record<string, string>;
  rows: Record<string, Row>;
}

const freshRun = (data: CkData): RunState => ({
  sot: "", cid: "", cliente: "", fecha: hoyISO(), modelo: "", ancho: "",
  params: Object.fromEntries(data.params.map((p) => [p.key, p.default])),
  rows: {},
});

const emptyRow: Row = { incluir: true, texto: "", images: [] };

/** Página de un tipo de CheckList: datos, ejecución por consola y PDF. */
export default function ChecklistTypePage() {
  const { id = "" } = useParams();
  const { list, loaded } = useChecklistTypes();
  const type = list.find((t) => t.id === id);
  if (!loaded) return <Spinner />;
  if (!type) return <Navigate to="/checklist" replace />;
  return <Inner key={type.id} type={type} />;
}

function Inner({ type }: { type: CkType }) {
  const { data } = type;
  const navigate = useNavigate();
  const [tab, setTab] = usePersistentState<"run" | "edit">(`checklist.tab.${type.id}`, "run");
  const [s, setS] = usePersistentState<RunState>(`checklist.run.${type.id}`, () => freshRun(data));

  // Logo propio del CheckList (independiente del reporte fotográfico)
  const [logo, setLogo] = usePersistentState<LogoSel>("checklist.logo", NO_LOGO);
  const mem = { persist: false } as const;
  const [log, setLog] = usePersistentState<string>(`checklist.log.${type.id}`, "", mem);
  const [busy, setBusy] = usePersistentState<string | null>(`checklist.busy.${type.id}`, null, mem);
  const [pdf, setPdf] = usePersistentState<{ url: string; filename: string; warnings: string[] } | null>(`checklist.pdf.${type.id}`, null, mem);
  const [word, setWord] = usePersistentState<{ url: string; filename: string; warnings: string[] } | null>(`checklist.docx.${type.id}`, null, mem);
  const [pdfError, setPdfError] = usePersistentState<string | null>(`checklist.pdfError.${type.id}`, null, mem);
  const [baud, setBaud] = usePersistentState("checklist.baud", 9600);
  const [connected, setConnected] = useState(false);
  const session = useRef<ConsoleSession | null>(null);

  // Puente local (programa en tu laptop): consola por cable detectada sola + SSH desde tu red
  const [via, setVia] = usePersistentState<"serial" | "ssh">("checklist.via", "serial");
  const [code, setCode] = usePersistentState("puente.codigo", "");
  const [puerto, setPuerto] = usePersistentState("checklist.puerto", "");
  const [ssh, setSsh] = usePersistentState("checklist.ssh", { host: "", port: 22, user: "" });
  const [pass, setPass] = useState("");
  const [pst, setPst] = useState<PuenteEstado | null>(null);

  // CLI en vivo: todo lo que se envía y devuelve el router
  // La sesión completa se guarda sola (en este navegador) y se puede bajar como .txt
  const [savedLog, setSavedLog] = usePersistentState<string>(`checklist.clilog.${type.id}`, "");
  const fullRef = useRef(savedLog);
  const saveTimer = useRef<number | null>(null);
  const termRef = useRef(savedLog.slice(-40000));
  const [term, setTerm] = useState(termRef.current);
  const termTimer = useRef<number | null>(null);
  // Aplica el eco del equipo como una terminal: el retroceso borra, y se ignoran \r, campana y colores
  const applyChunk = (prev: string, chunk: string) => {
    let out = prev;
    for (const ch of chunk.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")) {
      if (ch === "\b" || ch === "\x7f") { if (out && !out.endsWith("\n")) out = out.slice(0, -1); }
      else if (ch !== "\r" && ch !== "\x07" && ch !== "\0") out += ch;
    }
    return out;
  };
  const pushTerm = (chunk: string) => {
    termRef.current = applyChunk(termRef.current, chunk).slice(-40000);
    fullRef.current = applyChunk(fullRef.current, chunk).slice(-800_000);
    if (saveTimer.current == null) saveTimer.current = window.setTimeout(() => { saveTimer.current = null; setSavedLog(fullRef.current); }, 2000);
    if (termTimer.current == null) {
      termTimer.current = window.setTimeout(() => { termTimer.current = null; setTerm(termRef.current); }, 120);
    }
  };
  const mark = (txt: string) => pushTerm(`\n===== ${new Date().toLocaleString("es-PE")} · ${txt} =====\n`);
  function downloadLog() {
    const blob = new Blob([fullRef.current || "(sin registro)"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `consola_${(s.sot || "sesion").replace(/[^\w.-]+/g, "_")}_${hoyISO()}.txt`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function forgetLog() {
    if (!confirm("¿Borrar el registro guardado de la consola? No se puede deshacer.")) return;
    fullRef.current = ""; termRef.current = ""; setTerm(""); setSavedLog("");
  }

  // Saturación: el agente local o, si usas iperf/Ostinato, la marcas tú
  const [agentRunning, setAgentRunning] = useState(false);
  const [manualSat, setManualSat] = useState(false);
  const saturando = agentRunning || manualSat;
  const [readings, setReadings] = useState<Record<string, { inMbps: number; outMbps: number }>>({});
  const [editImg, setEditImg] = useState<{ itemId: string; idx: number; url: string } | null>(null);

  // Los parámetros nuevos (si editaste la estructura) aparecen con su valor por defecto.
  useEffect(() => {
    setS((p) => {
      const params = { ...p.params };
      let changed = false;
      for (const prm of data.params) if (!(prm.key in params)) { params[prm.key] = prm.default; changed = true; }
      return changed ? { ...p, params } : p;
    });
  }, [data.params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    void session.current?.close();
    if (saveTimer.current != null) { window.clearTimeout(saveTimer.current); setSavedLog(fullRef.current); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (connected) return;
    let alive = true;
    const tick = async () => { const r = await puenteEstado(code); if (alive) { setPst(r); if (r.kind === "ok" && r.ports.length && !r.ports.some((x) => x.device === puerto)) setPuerto((r.ports.find((x) => x.usb) ?? r.ports[0]).device); } };
    void tick();
    const t = window.setInterval(() => void tick(), 3000);
    return () => { alive = false; window.clearInterval(t); };
  }, [connected, code]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (itemId: string): Row => s.rows[itemId] ?? emptyRow;
  const setRow = (itemId: string, patch: Partial<Row>) =>
    setS((p) => ({ ...p, rows: { ...p.rows, [itemId]: { ...(p.rows[itemId] ?? emptyRow), ...patch } } }));
  const setParam = (k: string, v: string) => setS((p) => ({ ...p, params: { ...p.params, [k]: v } }));
  const setF = <K extends keyof RunState>(k: K, v: RunState[K]) => setS((p) => ({ ...p, [k]: v }));

  // Lo que se sabe de la SOT (IPs, interfaces, modelo, ancho de banda) se guarda solo en "Datos de cliente".
  const datosSot = useMemo(() => {
    const d: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.params)) if (v.trim()) d[k] = v.trim();
    if (s.modelo.trim()) d["MODELO"] = s.modelo.trim();
    if (s.ancho.trim()) d["ANCHO_MBPS"] = s.ancho.trim();
    return d;
  }, [s.params, s.modelo, s.ancho]);
  useSotSync({ sot: s.sot, nombre: s.cliente, fecha: s.fecha, cid: s.cid, datos: datosSot });

  // Todo lo de esta ventana (datos, salidas de comandos, capturas) se guarda solo por SOT y se puede traer de vuelta.
  const ws = useWorkspace({
    key: `checklist:${type.id}`, label: `CheckList · ${type.nombre}`, sot: s.sot, nombre: s.cliente, fecha: s.fecha,
    state: s,
    apply: (saved) => setS((p) => ({ ...p, ...saved, params: { ...p.params, ...(saved?.params ?? {}) } })),
    // Lo que necesita esta ventana de un cliente que ya existe: CID, nombre, modelo, ancho y sus parámetros (IPs, interfaces).
    fill: (c) => setS((p) => {
      const params = { ...p.params };
      for (const prm of data.params) if (c.datos?.[prm.key] && params[prm.key] === prm.default) params[prm.key] = c.datos[prm.key];
      return {
        ...p, cid: p.cid || c.cid, cliente: p.cliente || c.nombre,
        modelo: p.modelo || c.datos?.MODELO || "", ancho: p.ancho || c.datos?.ANCHO_MBPS || "", params,
      };
    }),
  });

  function pickClient(c: ClientRecord) {
    setS((p) => {
      const params = { ...p.params };
      for (const prm of data.params) if (c.datos?.[prm.key]) params[prm.key] = c.datos[prm.key];
      return {
        ...p, sot: c.sot, cid: c.cid || p.cid, cliente: c.nombre || p.cliente, fecha: c.fecha || p.fecha,
        modelo: c.datos?.MODELO || p.modelo, ancho: c.datos?.ANCHO_MBPS || p.ancho, params,
      };
    });
  }

  const allItems = useMemo(() => data.sections.flatMap((sec) => sec.items), [data]);
  const wan = s.params["WAN"] ?? "";

  // ---------------- conexión por consola ----------------
  async function connect(mode: "puente" | "navegador" = "puente") {
    try {
      let sess: ConsoleSession;
      setLog(via === "ssh" ? "Conectando por SSH desde tu laptop…" : "Abriendo la consola…");
      if (mode === "navegador") {
        const w = new SerialSession();
        w.onData = pushTerm;
        await w.connect(baud);
        sess = w;
      } else {
        const ps = new PuenteSession(code.trim());
        ps.onData = pushTerm;
        await ps.connect(via === "ssh"
          ? { kind: "ssh", host: ssh.host, port: Number(ssh.port) || 22, user: ssh.user, password: pass }
          : { kind: "serial", port: puerto, baud });
        sess = ps;
      }
      sess.onClose = (why) => { setConnected(false); session.current = null; setLog(why); mark("Conexión cerrada: " + why); };
      session.current = sess;
      setConnected(true);
      mark(via === "ssh" && mode === "puente" ? `Conectado por SSH a ${ssh.host}` : "Conectado por consola");
      setLog(via === "ssh" && mode === "puente" ? "SSH conectado. Preparando el equipo..." : "Consola conectada. Preparando el equipo...");
      for (const c of data.setup) await sess.run(c, { maxMs: 8000 });
      setLog(via === "ssh" && mode === "puente" ? "SSH listo." : "Consola lista.");
    } catch (e) {
      setConnected(false);
      session.current?.close().catch(() => {});
      session.current = null;
      setLog(`No se pudo conectar: ${(e as Error).message || e}`);
    }
  }
  async function disconnect() {
    mark("Desconectado");
    await session.current?.close();
    session.current = null;
    setConnected(false);
    setLog("Desconectado.");
  }

  /** Datos que se leen solos de la salida (solo si aún están vacíos). */
  function learn(text: string, isConfig: boolean) {
    setS((p) => {
      let next = p;
      if (!p.modelo) {
        const m = extractModel(data.vendor, text);
        if (m) next = { ...next, modelo: m };
      }
      if (!p.ancho && isConfig) {
        const b = extractBandwidthMbps(data.vendor, text, p.params["WAN"] ?? "");
        if (b) next = { ...next, ancho: b };
      }
      return next;
    });
  }

  async function runItems(items: CkItem[], label: string) {
    const sess = session.current;
    if (!sess?.connected) { alert("Primero conecta la consola o el SSH (tarjeta de conexión)."); return; }
    const candidates = items.filter((it) => it.cmd.trim() && row(it.id).incluir);
    const omitidos = candidates.filter((it) => isSatItem(it) && !saturando);
    const todo = candidates.filter((it) => !(isSatItem(it) && !saturando));
    if (!candidates.length) { alert("No hay ítems con comando para ejecutar."); return; }
    if (!todo.length) {
      alert("Esos ítems son de SATURACIÓN: solo se capturan mientras el enlace está saturado.\n\nInicia la saturación (tarjeta «Saturación») o márcala si usas iperf/Ostinato, espera a que suba el tráfico y vuelve a ejecutar.");
      return;
    }
    sess.stopRequested = false;
    setBusy(label);
    try {
      let n = 0;
      for (const it of todo) {
        if (sess.stopRequested) break;
        n++;
        const { cmd, missing } = fillCmd(it.cmd, s.params);
        if (missing.length) {
          setLog(`(${n}/${todo.length}) Omitido «${it.nombre}»: falta ${missing.join(", ")}.`);
          continue;
        }
        setLog(`(${n}/${todo.length}) ${cmd}`);
        const out = await sess.run(cmd, { maxMs: it.modo === "texto" ? 180000 : 60000 });
        setRow(it.id, { texto: out });
        if (isSatItem(it)) {
          const rt = parseRates(out);
          if (rt) setReadings((p) => ({ ...p, [it.id]: rt }));
        }
        learn(out, /current-config|running-config/.test(cmd));
      }
      setLog(
        (sess.stopRequested ? "Detenido." : "Listo: ejecución terminada.") +
          (omitidos.length ? ` Omitidos por no estar saturando: ${omitidos.map((o) => o.nombre.split(" (")[0]).join(", ")}.` : "")
      );
    } catch (e) {
      setLog(`Error: ${(e as Error).message || e}`);
    } finally {
      setBusy(null);
    }
  }

  // ---------------- PDF ----------------
  async function generate(kind: "pdf" | "docx" = "pdf") {
    const sections = data.sections
      .map((sec) => ({
        titulo: sec.titulo,
        items: sec.items
          .filter((it) => row(it.id).incluir)
          .map((it) => ({
            nombre: it.nombre, modo: it.modo, cmd: "",
            texto: row(it.id).texto, images: row(it.id).images.map((i) => i.path),
          })),
      }))
      .filter((sec) => sec.items.length);
    if (!sections.length) { alert("Marca al menos un ítem."); return; }
    const vacios = sections.flatMap((x) => x.items).filter((i) => !i.texto.trim() && !i.images.length).length;
    if (vacios && !confirm(`${vacios} ítem(s) están vacíos (sin salida ni captura). ¿Generar de todas formas?`)) return;

    setBusy(kind);
    if (kind === "pdf") setPdf(null); else setWord(null);
    setPdfError(null);
    try {
      const { data: r } = await api.post(kind === "pdf" ? "/checklist/report-pdf" : "/checklist/report-docx", {
        titulo: "CheckList de Claro",
        servicio_label: servicioLabel(data.servicio, data.vendor, s.ancho, s.modelo),
        sot: s.sot, cid: s.cid, cliente: s.cliente, fecha: fechaLarga(s.fecha),
        logo_id: logo.id, logo_path: logo.id ? null : logo.path || null,
        sections,
      });
      (kind === "pdf" ? setPdf : setWord)({ url: r.url, filename: r.filename, warnings: r.warnings ?? [] });
      if (s.sot.trim()) {
        void syncClient({
          sot: s.sot, nombre: s.cliente, fecha: s.fecha, cid: s.cid, datos: datosSot,
          reporte: { tipo: "checklist", nombre: type.nombre + (kind === "docx" ? " (Word)" : ""), filename: r.filename, url: r.url },
        }).catch(() => {});
      }
    } catch (e) {
      setPdfError(apiErrorMessage(e, kind === "pdf" ? "No se pudo generar el PDF." : "No se pudo generar el Word."));
    } finally {
      setBusy(null);
    }
  }

  function newReport() {
    if (confirm("¿Empezar un checklist nuevo?\n\nSe borran los datos, salidas y capturas. El logo se conserva.")) {
      setS(freshRun(data));
      setPdf(null); setWord(null);
      setLog("");
    }
  }

  const label = servicioLabel(data.servicio, data.vendor, s.ancho, s.modelo);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">CheckList — {type.nombre}</h2>
        <p className="text-sm text-slate-500">
          Servicio <b>{data.servicio === "rpv" ? "RPV" : "Internet"}</b> · {data.vendor.toUpperCase()}. Se conecta a la
          consola desde tu navegador, ejecuta los comandos y arma el PDF.
        </p>
        <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">Cómo se usa (tutorial)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Llena <b>SOT, CID, Cliente</b> y la <b>fecha</b> (se elige en el calendario). Elige el logo.</li>
            <li>Completa los <b>parámetros</b> (interfaz WAN/LAN, IP del siguiente salto, IP remota…). Los comandos los usan solos.</li>
            <li>
              Abre el <b>puente</b> en tu laptop y conecta por <b>consola</b> (el puerto se detecta solo) o por <b>SSH</b> a un equipo de tu red. Luego ejecuta{" "}
              <b>un ítem</b>, <b>una sección</b> o <b>todo</b>. Puedes repetir los que quieras las veces que quieras.
            </li>
            <li>El <b>modelo</b> y el <b>ancho de banda</b> se leen solos de la configuración; si no, escríbelos.</li>
            <li>Los ítems de <b>TEXTO</b> salen como texto en el PDF; los de <b>FOTO</b> con tus capturas (pega con Ctrl+V o sube la imagen). Speedtest e iperf van como captura.</li>
            <li>Sin cable de consola, pega la salida del comando a mano en el cuadro de cada ítem.</li>
            <li>Pulsa <b>Generar PDF</b> (o <b>Generar Word</b> para tenerlo editable). El archivo se llama <i>checklist_sot_&lt;sot&gt;-&lt;cliente&gt;.pdf</i>.</li>
            <li>En <b>Estructura</b> puedes agregar, quitar o reordenar secciones, ítems y comandos.</li>
          </ol>
        </details>
      </div>

      <WorkspaceBar ws={ws} />

      <div className="flex flex-wrap gap-2">
        <button className={tab === "run" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("run")}>Ejecutar / Generar PDF</button>
        <button className={tab === "edit" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("edit")}>Estructura (editar)</button>
      </div>

      {tab === "edit" ? (
        <ChecklistStructure
          type={type}
          onSave={async (nombre, d) => { await updateChecklistType(type.id, nombre, d); }}
          onDelete={async () => { await deleteChecklistType(type.id); navigate("/checklist", { replace: true }); }}
        />
      ) : (
        <>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Tu avance se guarda solo en este navegador; los datos de la SOT, en «Datos de cliente».</p>
              <div className="flex flex-wrap items-center gap-2">
                <ClientPicker onPick={pickClient} />
                <button type="button" className="btn-secondary text-xs" onClick={newReport} disabled={!!busy}>Nuevo checklist</button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Fecha del pie de página</span>
                <input type="date" className="input w-full" value={s.fecha} onChange={(e) => setF("fecha", e.target.value)} />
                <span className="text-[11px] text-slate-400">{fechaLarga(s.fecha)}</span>
              </label>
              <Field label="SOT" value={s.sot} onChange={(v) => setF("sot", v)} />
              <Field label="CID" value={s.cid} onChange={(v) => setF("cid", v)} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Cliente (para el nombre del archivo)" value={s.cliente} onChange={(v) => setF("cliente", v)} />
              <Field label="Modelo del equipo (se lee solo)" value={s.modelo} onChange={(v) => setF("modelo", v)} />
              <Field label="Ancho de banda en Mbps (se lee solo)" value={s.ancho} onChange={(v) => setF("ancho", v)} />
            </div>

            {data.params.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <h3 className="text-sm font-semibold text-slate-700">Parámetros para los comandos</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.params.map((p) => (
                    <Field key={p.key} label={`${p.label}  {${p.key}}`} value={s.params[p.key] ?? ""} onChange={(v) => setParam(p.key, v)} />
                  ))}
                </div>
                {wan.trim() === "" && <p className="text-xs text-amber-600">Escribe la interfaz WAN para que se lea el ancho de banda y se ejecuten sus comandos.</p>}
              </div>
            )}

            <p className="text-xs text-slate-500">
              Cabecera del PDF: <span className="font-mono text-slate-700">{label}</span> · SOT: {s.sot} CID: {s.cid}
            </p>
            <LogoPicker posicion="izq" label="Logo del CheckList (independiente del reporte fotográfico)" value={logo} onChange={setLogo} />
          </div>

          <div className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {connected ? (
                <>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">{via === "ssh" ? "SSH conectado" : "Consola conectada"}</span>
                  <button className="btn-secondary text-xs" onClick={disconnect} disabled={!!busy}>Desconectar</button>
                </>
              ) : (
                <div className="w-full space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="seg">
                      <button type="button" className={via === "serial" ? "on" : ""} onClick={() => setVia("serial")}>Consola (cable USB/COM)</button>
                      <button type="button" className={via === "ssh" ? "on" : ""} onClick={() => setVia("ssh")}>SSH</button>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${pst?.kind === "ok" ? "bg-green-100 text-green-700" : pst?.kind === "codigo" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>
                      {pst?.kind === "ok" ? "Puente de tu laptop: activo" : pst?.kind === "codigo" ? "Puente abierto: falta el código" : "Puente de tu laptop: no detectado"}
                    </span>
                  </div>

                  {pst?.kind !== "ok" && (
                    <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
                      <p>
                        La página está en la nube y no ve el cable ni tu red. El <b>puente</b> es un programa que se abre en tu laptop y le presta a la página
                        la consola y el SSH (sale desde tu laptop, así que llega a tu red local).
                      </p>
                      <ol className="list-decimal space-y-1 pl-5">
                        <li><a className="font-medium text-brand-600 underline" href="/api/tools/puente.py" download>Descarga puente.py</a> (necesita Python 3.8+; la primera vez instala solo <code>pyserial</code> y <code>paramiko</code>).</li>
                        <li>Ábrelo: <code>python puente.py</code> (en Windows: <code>py puente.py</code>) y déjalo abierto.</li>
                        <li>Copia el código que muestra y pégalo aquí (se recuerda).</li>
                      </ol>
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="input w-40 font-mono text-xs uppercase" placeholder="Código del puente" value={code} onChange={(e) => setCode(e.target.value.trim())} />
                        {pst?.kind === "codigo" && <span className="text-amber-700">El código no coincide con el que muestra el puente.</span>}
                      </div>
                    </div>
                  )}

                  {via === "serial" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {pst?.kind === "ok" ? (
                        pst.ports.length ? (
                          <label className="text-xs text-slate-500">
                            Puerto{" "}
                            <select className="input" value={puerto} onChange={(e) => setPuerto(e.target.value)}>
                              {pst.ports.map((p) => <option key={p.device} value={p.device}>{p.device} — {p.desc || "puerto serie"}{p.usb ? " (USB)" : ""}</option>)}
                            </select>
                          </label>
                        ) : (
                          <span className="text-xs text-amber-700">El puente no ve ningún puerto COM. Conecta el cable de consola (instala el driver CP210x/FTDI/CH340 si hace falta) y se detecta solo.</span>
                        )
                      ) : null}
                      <label className="text-xs text-slate-500">
                        Baudios{" "}
                        <select className="input" value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
                          {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}
                        </select>
                      </label>
                      <button className="btn-primary text-sm" disabled={pst?.kind !== "ok" || !puerto} onClick={() => connect("puente")}>Conectar consola</button>
                      {webSerialSupported() && <button className="btn-secondary text-xs" onClick={() => connect("navegador")} title="Sin el puente: el navegador te deja elegir el puerto (Chrome/Edge)">Elegir puerto con el navegador</button>}
                    </div>
                  )}

                  {via === "ssh" && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-slate-500">IP o nombre del equipo<input className="input mt-0.5 block w-44" placeholder="192.168.1.1" value={ssh.host} onChange={(e) => setSsh({ ...ssh, host: e.target.value })} /></label>
                      <label className="text-xs text-slate-500">Puerto<input className="input mt-0.5 block w-20" type="number" value={ssh.port} onChange={(e) => setSsh({ ...ssh, port: Number(e.target.value) })} /></label>
                      <label className="text-xs text-slate-500">Usuario<input className="input mt-0.5 block w-32" value={ssh.user} onChange={(e) => setSsh({ ...ssh, user: e.target.value })} /></label>
                      <label className="text-xs text-slate-500">Contraseña<input className="input mt-0.5 block w-36" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
                      <button className="btn-primary text-sm" disabled={pst?.kind !== "ok" || !ssh.host.trim() || !ssh.user.trim()} onClick={() => connect("puente")}>Conectar por SSH</button>
                      <p className="w-full text-[11px] text-slate-400">La conexión sale de tu laptop (no de la nube) y la contraseña no se guarda ni sale de tu computadora.</p>
                    </div>
                  )}
                </div>
              )}
              <div className="ml-auto flex gap-2">
                <button className="btn-primary text-sm" disabled={!connected || !!busy} onClick={() => runItems(allItems, "all")}>Ejecutar todo</button>
                {busy && busy !== "pdf" && (
                  <button className="btn-secondary text-sm" onClick={() => { if (session.current) session.current.stopRequested = true; }}>Detener</button>
                )}
              </div>
            </div>
            {log && <p className="font-mono text-xs text-slate-600 break-all">{log}</p>}

            {(connected || term) && (
              <LiveCli onDownload={downloadLog} onForget={forgetLog} logSize={fullRef.current.length || savedLog.length} term={term} onClear={() => { termRef.current = ""; setTerm(""); }} session={session} connected={connected} busy={!!busy}
                itemCmds={allItems.map((i) => i.cmd).filter(Boolean)} fill={(c) => fillCmd(c, s.params).cmd} />
            )}
          </div>

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">Saturación</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${saturando ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                {saturando ? "Saturando: ya puedes capturar las interfaces" : "Sin saturar: las capturas de interfaz están bloqueadas"}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Las estadísticas de la interfaz WAN/LAN (sección de saturación) solo valen con el enlace saturado. Inicia la saturación aquí, espera a que el
              contador del router suba (Huawei y Cisco promedian los últimos 5 min o 30 s) y recién ahí ejecuta esos ítems. Speedtest y la captura del
              software / SUP las pegas tú como imagen.
            </p>
            <SaturadorPanel defaultMbps={s.ancho || undefined} onRunning={setAgentRunning} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={manualSat} onChange={(e) => setManualSat(e.target.checked)} />
              Estoy saturando con otra herramienta (iperf, Ostinato…) y ya está al máximo
            </label>
          </div>

          <details className="card text-sm text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Permisos que necesita (qué te va a pedir el navegador y tu laptop)</summary>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                <b>Puente de tu laptop (recomendado, consola y SSH):</b> como la página está en la nube, no puede ver tu cable de consola ni los equipos de tu red.
                <code>puente.py</code> corre en tu laptop, detecta solo los puertos COM y abre el SSH desde tu red local. La página solo se comunica con él en{" "}
                <code>127.0.0.1</code> y con su código. Chrome/Edge pueden preguntar si permites a este sitio conectarse a dispositivos de tu red local: acepta.
                Safari no lo permite; usa Chrome, Edge o Firefox.
              </li>
              <li>
                <b>Consola con el navegador (alternativa sin el puente):</b> al pulsar «Conectar consola» el navegador te muestra una lista de puertos y tú eliges el del cable; ese es el
                permiso. Hace falta <b>Chrome o Edge</b> en computadora y la página en <b>https</b> (Railway ya lo es).{" "}
                <span className={webSerialSupported() && window.isSecureContext ? "text-green-700" : "text-red-600"}>
                  {webSerialSupported() && window.isSecureContext ? "Sí: este navegador lo permite." : "No: este navegador/página no lo permite."}
                </span>{" "}
                Si no ves tu puerto, instala el driver del adaptador (CP210x, FTDI o CH340) y revisa que ningún otro programa (PuTTY, SecureCRT…) lo tenga abierto.
              </li>
              <li>
                <b>Saturación:</b> el tráfico lo genera un pequeño programa en tu laptop (<i>saturador.py --agente</i>), porque la nube no puede saturar el enlace
                del cliente ni enviar ping desde tu red. En Linux/Mac se abre con <code>sudo</code>; en Windows no necesita administrador (el firewall puede pedirte
                permitir Python). La página solo se comunica con él en <code>127.0.0.1</code> y con el código que te muestra.
              </li>
              <li><b>Cámara y ubicación</b> (reporte fotográfico): el navegador las pide la primera vez que tomas una foto.</li>
            </ul>
          </details>

          {data.sections.map((sec) => (
            <div key={sec.id} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-800">{sec.titulo}</h3>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={sec.items.every((i) => row(i.id).incluir)}
                      onChange={(e) => sec.items.forEach((i) => setRow(i.id, { incluir: e.target.checked }))} />
                    Incluir todos
                  </label>
                  <button className="btn-secondary text-xs" disabled={!connected || !!busy} onClick={() => runItems(sec.items, sec.id)}>Ejecutar sección</button>
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {sec.items.map((it) => {
                const r = row(it.id);
                const filled = it.cmd ? fillCmd(it.cmd, s.params) : null;
                return (
                  <div key={it.id} className="rounded-lg border border-slate-200 p-3 space-y-2" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="checkbox" checked={r.incluir} onChange={(e) => setRow(it.id, { incluir: e.target.checked })} />
                      <span className="font-medium text-sm text-slate-800 flex-1 min-w-[180px]">{it.nombre}</span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${it.modo === "texto" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                        {it.modo === "texto" ? "TEXTO" : "FOTO"}
                      </span>
                      {it.cmd && (
                        <button className="btn-secondary text-xs" disabled={!connected || !!busy} onClick={() => runItems([it], it.id)} title="Ejecutar solo este ítem">Ejecutar</button>
                      )}
                    </div>
                    {isSatItem(it) && (
                      <p className={`text-[11px] ${saturando ? "text-green-700" : "text-amber-700"}`}>
                        {saturando ? "Saturación activa: se puede capturar." : "Solo se captura con la saturación activa."}
                        {readings[it.id] && (() => {
                          const rt = readings[it.id];
                          const bw = Number(s.ancho) || 0;
                          const peak = Math.max(rt.inMbps, rt.outMbps);
                          const pct = bw ? Math.round((peak / bw) * 100) : null;
                          const low = pct !== null && pct < 70;
                          return (
                            <span className={low ? "ml-2 font-semibold text-red-600" : "ml-2 font-semibold"}>
                              Router: bajada {rt.inMbps.toFixed(1)} / subida {rt.outMbps.toFixed(1)} Mbps{pct !== null ? ` (${pct}% de ${bw} Mbps)` : ""}
                              {low ? " — Atención: parece que NO está saturando; espera y repite la captura" : ""}
                            </span>
                          );
                        })()}
                      </p>
                    )}
                    {filled && (
                      <p className="font-mono text-[11px] text-slate-500 break-all">
                        $ {filled.cmd}
                        {filled.missing.length > 0 && <span className="text-amber-600">  (falta: {filled.missing.join(", ")})</span>}
                      </p>
                    )}

                    {it.modo === "foto" && (
                      <div className="flex flex-wrap items-start gap-2">
                        {r.images.map((im, k) => (
                          <div key={im.path} className="relative">
                            <img src={im.url} alt="" className="h-20 w-28 rounded border object-cover" />
                            <button type="button" aria-label="Editar captura" title="Editar (líneas, flechas, texto, recorte…)"
                              className="absolute -left-1 -top-1 rounded-full bg-slate-700 px-1.5 text-xs text-white"
                              onClick={() => setEditImg({ itemId: it.id, idx: k, url: im.url })}>Editar</button>
                            <button type="button" aria-label="Quitar captura"
                              className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-xs text-white"
                              onClick={() => setRow(it.id, { images: r.images.filter((_, j) => j !== k) })}>×</button>
                          </div>
                        ))}
                        <ImageUpload
                          key={r.images.length}
                          compact
                          camera={false}
                          label="Agregar captura..."
                          onUploaded={(path, url) => path && setRow(it.id, { images: [...r.images, { path, url }] })}
                        />
                      </div>
                    )}

                    <details open={it.modo === "texto" || undefined}>
                      <summary className="cursor-pointer text-xs text-slate-500">
                        {it.modo === "texto" ? "Salida del comando" : "Salida del comando (sale como terminal si no hay captura)"}
                        {r.texto ? ` · ${r.texto.split("\n").length} líneas` : ""}
                      </summary>
                      <textarea
                        className="input mt-1 h-32 w-full font-mono text-[11px]"
                        value={r.texto}
                        placeholder="Se llena al ejecutar, o pega aquí la salida"
                        onChange={(e) => setRow(it.id, { texto: e.target.value })}
                      />
                    </details>
                  </div>
                );
              })}
              </div>
            </div>
          ))}

          <div className="card flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={() => generate("pdf")} disabled={!!busy}>
              {busy === "pdf" ? "Generando PDF..." : "Generar PDF"}
            </button>
            <button className="btn-secondary" onClick={() => generate("docx")} disabled={!!busy} title="El mismo CheckList en Word, editable">
              {busy === "docx" ? "Generando Word..." : "Generar Word"}
            </button>
            {pdfError && <span className="text-sm text-red-600">{pdfError}</span>}
            {pdf && (
              <a href={pdf.url} target="_blank" rel="noreferrer" download={pdf.filename} className="text-sm font-medium text-brand-600 hover:underline break-all">
                Descargar {pdf.filename}
              </a>
            )}
            {word && (
              <a href={word.url} target="_blank" rel="noreferrer" download={word.filename} className="text-sm font-medium text-brand-600 hover:underline break-all">
                Descargar {word.filename}
              </a>
            )}
            {[...(pdf?.warnings ?? []), ...(word?.warnings ?? [])].filter((w, i, a) => a.indexOf(w) === i).map((w) => <p key={w} className="w-full text-xs text-amber-600">{w}</p>)}
          </div>
        </>
      )}

      {editImg && (
        <ImageAnnotator
          imageUrl={editImg.url}
          onClose={() => setEditImg(null)}
          onSaved={(path, url) =>
            setRow(editImg.itemId, { images: row(editImg.itemId).images.map((im, i) => (i === editImg.idx ? { path, url } : im)) })
          }
        />
      )}
    </div>
  );
}

/** Casilla que se estira hacia abajo si el texto es largo (se puede arrastrar la esquina). Solo mide cuando cambia el texto. */
function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; }
  }, [value]);
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <textarea
        ref={ref}
        rows={1}
        className="input w-full resize-y overflow-hidden"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      />
    </label>
  );
}

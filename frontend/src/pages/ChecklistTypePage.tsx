import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import ChecklistStructure from "../components/ChecklistStructure";
import ImageAnnotator from "../components/ImageAnnotator";
import SaturadorPanel from "../components/SaturadorPanel";
import { NO_LOGO } from "../logo";
import type { LogoSel } from "../logo";
import { usePersistentState } from "../store/persistentState";
import { deleteChecklistType, updateChecklistType, useChecklistTypes } from "../store/checklistTypes";
import type { CkData, CkItem, CkType } from "../store/checklistTypes";
import ClientPicker from "../components/ClientPicker";
import { syncClient, useSotSync } from "../store/clients";
import type { ClientRecord } from "../store/clients";
import { SerialSession, webSerialSupported } from "../utils/webSerial";
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
  const [pdfError, setPdfError] = usePersistentState<string | null>(`checklist.pdfError.${type.id}`, null, mem);
  const [baud, setBaud] = usePersistentState("checklist.baud", 9600);
  const [connected, setConnected] = useState(false);
  const session = useRef<SerialSession | null>(null);

  // CLI en vivo: todo lo que se envía y devuelve el router
  const termRef = useRef("");
  const [term, setTerm] = useState("");
  const termTimer = useRef<number | null>(null);
  const termBox = useRef<HTMLPreElement>(null);
  const [typed, setTyped] = useState("");
  const pushTerm = (chunk: string) => {
    termRef.current = (termRef.current + chunk.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "")).slice(-40000);
    if (termTimer.current == null) {
      termTimer.current = window.setTimeout(() => { termTimer.current = null; setTerm(termRef.current); }, 120);
    }
  };
  useEffect(() => { if (termBox.current) termBox.current.scrollTop = termBox.current.scrollHeight; }, [term]);

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

  useEffect(() => () => { void session.current?.close(); }, []);

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
  async function connect() {
    try {
      const sess = new SerialSession();
      sess.onData = pushTerm;
      await sess.connect(baud);
      session.current = sess;
      setConnected(true);
      setLog("Consola conectada. Preparando el equipo...");
      for (const c of data.setup) await sess.run(c, { maxMs: 8000 });
      setLog("Consola lista.");
    } catch (e) {
      setConnected(false);
      session.current = null;
      setLog(`No se pudo abrir la consola: ${(e as Error).message || e}`);
    }
  }
  async function disconnect() {
    await session.current?.close();
    session.current = null;
    setConnected(false);
    setLog("Consola desconectada.");
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
    if (!sess?.connected) { alert("Primero conecta la consola (botón «Conectar consola»)."); return; }
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
  async function generate() {
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

    setBusy("pdf");
    setPdf(null);
    setPdfError(null);
    try {
      const { data: r } = await api.post("/checklist/report-pdf", {
        titulo: "CheckList de Claro",
        servicio_label: servicioLabel(data.servicio, data.vendor, s.ancho, s.modelo),
        sot: s.sot, cid: s.cid, cliente: s.cliente, fecha: fechaLarga(s.fecha),
        logo_id: logo.id, logo_path: logo.id ? null : logo.path || null,
        sections,
      });
      setPdf({ url: r.url, filename: r.filename, warnings: r.warnings ?? [] });
      if (s.sot.trim()) {
        void syncClient({
          sot: s.sot, nombre: s.cliente, fecha: s.fecha, cid: s.cid, datos: datosSot,
          reporte: { tipo: "checklist", nombre: type.nombre, filename: r.filename, url: r.url },
        }).catch(() => {});
      }
    } catch (e) {
      setPdfError(apiErrorMessage(e, "No se pudo generar el PDF."));
    } finally {
      setBusy(null);
    }
  }

  function newReport() {
    if (confirm("¿Empezar un checklist nuevo?\n\nSe borran los datos, salidas y capturas. El logo se conserva.")) {
      setS(freshRun(data));
      setPdf(null);
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
              Pulsa <b>Conectar consola</b> (Chrome o Edge) y elige el puerto del cable de consola. Luego ejecuta{" "}
              <b>un ítem</b>, <b>una sección</b> o <b>todo</b>. Puedes repetir los que quieras las veces que quieras.
            </li>
            <li>El <b>modelo</b> y el <b>ancho de banda</b> se leen solos de la configuración; si no, escríbelos.</li>
            <li>Los ítems de <b>TEXTO</b> salen como texto en el PDF; los de <b>FOTO</b> con tus capturas (pega con Ctrl+V o sube la imagen). Speedtest e iperf van como captura.</li>
            <li>Sin cable de consola, pega la salida del comando a mano en el cuadro de cada ítem.</li>
            <li>Pulsa <b>Generar PDF</b>. El archivo se llama <i>checklist_sot_&lt;sot&gt;-&lt;cliente&gt;.pdf</i>.</li>
            <li>En <b>Estructura</b> puedes agregar, quitar o reordenar secciones, ítems y comandos.</li>
          </ol>
        </details>
      </div>

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
          <div className="card grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Tu avance se guarda solo en este navegador; los datos de la SOT, en «Datos de cliente».</p>
              <ClientPicker onPick={pickClient} />
              <button type="button" className="btn-secondary text-xs" onClick={newReport} disabled={!!busy}>Nuevo checklist</button>
            </div>
            <Field label="SOT" value={s.sot} onChange={(v) => setF("sot", v)} />
            <Field label="CID" value={s.cid} onChange={(v) => setF("cid", v)} />
            <Field label="Cliente (para el nombre del archivo)" value={s.cliente} onChange={(v) => setF("cliente", v)} className="sm:col-span-2" />
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Fecha del pie de página</span>
              <input type="date" className="input w-full" value={s.fecha} onChange={(e) => setF("fecha", e.target.value)} />
              <span className="text-[11px] text-slate-400">{fechaLarga(s.fecha)}</span>
            </label>
            <Field label="Modelo del equipo (se lee solo)" value={s.modelo} onChange={(v) => setF("modelo", v)} />
            <Field label="Ancho de banda en Mbps (se lee solo)" value={s.ancho} onChange={(v) => setF("ancho", v)} />
            <p className="sm:col-span-2 text-xs text-slate-500">
              Cabecera del PDF: <span className="font-mono text-slate-700">{label}</span> · SOT: {s.sot} CID: {s.cid}
            </p>
            <div className="sm:col-span-2">
              <LogoPicker posicion="izq" label="Logo del CheckList (independiente del reporte fotográfico)" value={logo} onChange={setLogo} />
            </div>
          </div>

          {data.params.length > 0 && (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Parámetros para los comandos</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {data.params.map((p) => (
                  <Field key={p.key} label={`${p.label}  {${p.key}}`} value={s.params[p.key] ?? ""} onChange={(v) => setParam(p.key, v)} />
                ))}
              </div>
              {wan.trim() === "" && <p className="text-xs text-amber-600">Escribe la interfaz WAN para que se lea el ancho de banda y se ejecuten sus comandos.</p>}
            </div>
          )}

          <div className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {!webSerialSupported() ? (
                <p className="text-sm text-amber-700">
                  Tu navegador no permite usar la consola (hace falta Chrome o Edge en computadora). Puedes pegar las salidas a mano.
                </p>
              ) : connected ? (
                <>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Consola conectada</span>
                  <button className="btn-secondary text-xs" onClick={disconnect} disabled={!!busy}>Desconectar</button>
                </>
              ) : (
                <>
                  <button className="btn-primary text-sm" onClick={connect}>Conectar consola (USB/COM)</button>
                  <label className="text-xs text-slate-500">
                    Baudios{" "}
                    <select className="input" value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
                      {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                </>
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
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500">CLI del router en vivo (todo lo que se envía y devuelve)</p>
                  <button className="text-xs text-slate-400 hover:underline" onClick={() => { termRef.current = ""; setTerm(""); }}>limpiar</button>
                </div>
                <pre ref={termBox} className="h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black p-3 font-mono text-[11px] leading-snug text-green-200">{term || "(esperando datos de la consola…)"}</pre>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim() && connected && !busy) { void session.current?.typed(typed); setTyped(""); } }}>
                  <input className="input flex-1 font-mono text-xs" value={typed} disabled={!connected || !!busy} placeholder="Escribe un comando y Enter (se ejecuta en el router)" onChange={(e) => setTyped(e.target.value)} />
                  <button className="btn-secondary text-xs" disabled={!connected || !!busy || !typed.trim()}>Enviar</button>
                </form>
              </div>
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
                <b>Consola (cable USB/COM):</b> al pulsar «Conectar consola» el navegador te muestra una lista de puertos y tú eliges el del cable; ese es el
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

              {sec.items.map((it) => {
                const r = row(it.id);
                const filled = it.cmd ? fillCmd(it.cmd, s.params) : null;
                return (
                  <div key={it.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
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
          ))}

          <div className="card flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={generate} disabled={!!busy}>
              {busy === "pdf" ? "Generando PDF..." : "Generar PDF"}
            </button>
            {pdfError && <span className="text-sm text-red-600">{pdfError}</span>}
            {pdf && (
              <a href={pdf.url} target="_blank" rel="noreferrer" download={pdf.filename} className="text-sm font-medium text-brand-600 hover:underline break-all">
                Descargar {pdf.filename}
              </a>
            )}
            {pdf?.warnings.map((w) => <p key={w} className="w-full text-xs text-amber-600">{w}</p>)}
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

function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

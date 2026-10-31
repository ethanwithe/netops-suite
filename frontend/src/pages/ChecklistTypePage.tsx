import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import ChecklistStructure from "../components/ChecklistStructure";
import { setField, usePhotoReport } from "../store/photoReportStore";
import { usePersistentState } from "../store/persistentState";
import { deleteChecklistType, updateChecklistType, useChecklistTypes } from "../store/checklistTypes";
import type { CkData, CkItem, CkType } from "../store/checklistTypes";
import { SerialSession, webSerialSupported } from "../utils/webSerial";
import {
  extractBandwidthMbps, extractModel, fechaLarga, fillCmd, hoyISO, servicioLabel,
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

  const logo = usePhotoReport("fibra").logoIzq; // el mismo logo de empresa del reporte fotográfico
  const mem = { persist: false } as const;
  const [log, setLog] = usePersistentState<string>(`checklist.log.${type.id}`, "", mem);
  const [busy, setBusy] = usePersistentState<string | null>(`checklist.busy.${type.id}`, null, mem);
  const [pdf, setPdf] = usePersistentState<{ url: string; filename: string; warnings: string[] } | null>(`checklist.pdf.${type.id}`, null, mem);
  const [pdfError, setPdfError] = usePersistentState<string | null>(`checklist.pdfError.${type.id}`, null, mem);
  const [baud, setBaud] = usePersistentState("checklist.baud", 9600);
  const [connected, setConnected] = useState(false);
  const session = useRef<SerialSession | null>(null);

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

  const allItems = useMemo(() => data.sections.flatMap((sec) => sec.items), [data]);
  const wan = s.params["WAN"] ?? "";

  // ---------------- conexión por consola ----------------
  async function connect() {
    try {
      const sess = new SerialSession();
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
    const todo = items.filter((it) => it.cmd.trim() && row(it.id).incluir);
    if (!todo.length) { alert("No hay ítems con comando para ejecutar."); return; }
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
        learn(out, /current-config|running-config/.test(cmd));
      }
      setLog(sess.stopRequested ? "Detenido." : "Listo: ejecución terminada.");
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
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800">CheckList — {type.nombre}</h2>
        <p className="text-sm text-slate-500">
          Servicio <b>{data.servicio === "rpv" ? "RPV" : "Internet"}</b> · {data.vendor.toUpperCase()}. Se conecta a la
          consola desde tu navegador, ejecuta los comandos y arma el PDF.
        </p>
        <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">📖 Cómo se usa (tutorial)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Llena <b>SOT, CID, Cliente</b> y la <b>fecha</b> (se elige en el calendario). Elige el logo.</li>
            <li>Completa los <b>parámetros</b> (interfaz WAN/LAN, IP del siguiente salto, IP remota…). Los comandos los usan solos.</li>
            <li>
              Pulsa <b>🔌 Conectar consola</b> (Chrome o Edge) y elige el puerto del cable de consola. Luego ejecuta{" "}
              <b>un ítem (▶)</b>, <b>una sección</b> o <b>todo</b>. Puedes repetir los que quieras las veces que quieras.
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
              <p className="text-xs text-slate-400">Tu avance se guarda solo en este navegador.</p>
              <button type="button" className="btn-secondary text-xs" onClick={newReport} disabled={!!busy}>🆕 Nuevo checklist</button>
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
              <LogoPicker posicion="izq" label="Logo de la empresa (el mismo del reporte fotográfico)" value={logo} onChange={(v) => setField("fibra", "logoIzq", v)} />
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
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">● Consola conectada</span>
                  <button className="btn-secondary text-xs" onClick={disconnect} disabled={!!busy}>Desconectar</button>
                </>
              ) : (
                <>
                  <button className="btn-primary text-sm" onClick={connect}>🔌 Conectar consola (USB/COM)</button>
                  <label className="text-xs text-slate-500">
                    Baudios{" "}
                    <select className="input" value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
                      {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                </>
              )}
              <div className="ml-auto flex gap-2">
                <button className="btn-primary text-sm" disabled={!connected || !!busy} onClick={() => runItems(allItems, "all")}>▶ Ejecutar todo</button>
                {busy && busy !== "pdf" && (
                  <button className="btn-secondary text-sm" onClick={() => { if (session.current) session.current.stopRequested = true; }}>⏹ Detener</button>
                )}
              </div>
            </div>
            {log && <p className="font-mono text-xs text-slate-600 break-all">{log}</p>}
          </div>

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
                  <button className="btn-secondary text-xs" disabled={!connected || !!busy} onClick={() => runItems(sec.items, sec.id)}>▶ Ejecutar sección</button>
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
                        <button className="btn-secondary text-xs" disabled={!connected || !!busy} onClick={() => runItems([it], it.id)} title="Ejecutar solo este ítem">▶</button>
                      )}
                    </div>
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
              {busy === "pdf" ? "Generando PDF..." : "📄 Generar PDF"}
            </button>
            {pdfError && <span className="text-sm text-red-600">{pdfError}</span>}
            {pdf && (
              <a href={pdf.url} target="_blank" rel="noreferrer" download={pdf.filename} className="text-sm font-medium text-brand-600 hover:underline break-all">
                ⬇ {pdf.filename}
              </a>
            )}
            {pdf?.warnings.map((w) => <p key={w} className="w-full text-xs text-amber-600">{w}</p>)}
          </div>
        </>
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

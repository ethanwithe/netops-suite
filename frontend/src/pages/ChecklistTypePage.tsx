import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import ChecklistStructure from "../components/ChecklistStructure";
import ImageAnnotator from "../components/ImageAnnotator";
import { NO_LOGO } from "../logo";
import type { LogoSel } from "../logo";
import { useAuth } from "../store/auth";
import { usePersistentState } from "../store/persistentState";
import { deleteChecklistType, publishChecklistType, restoreChecklistBase, setChecklistBase, updateChecklistType, useChecklistTypes } from "../store/checklistTypes";
import type { CkData, CkItem, CkType } from "../store/checklistTypes";
import ClientPicker from "../components/ClientPicker";
import { syncClient, useSotSync } from "../store/clients";
import { expandDatos } from "../store/clientLink";
import { useWorkspace } from "../store/workspaces";
import WorkspaceBar from "../components/WorkspaceBar";
import type { ClientRecord } from "../store/clients";
import type { ConsoleSession } from "../utils/webSerial";
import { getSession, openWindow, setSetupCommands, useDock, useTerminal } from "../store/terminal";
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
  const { me } = useAuth();
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
  // La conexión (consola/SSH) y la saturación viven en las ventanas flotantes «Terminal» y «Saturación» (barra superior)
  const term = useTerminal();
  const dock = useDock();
  const connected = term.connected;
  const session = useMemo(() => ({ get current() { return getSession(); } }), []);
  const saturando = dock.satRunning || dock.manualSat;
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

  useEffect(() => { setSetupCommands(data.setup); return () => setSetupCommands([]); }, [data.setup]);

  const row = (itemId: string): Row => s.rows[itemId] ?? emptyRow;
  const setRow = useCallback((itemId: string, patch: Partial<Row>) =>
    setS((p) => ({ ...p, rows: { ...p.rows, [itemId]: { ...(p.rows[itemId] ?? emptyRow), ...patch } } })), [setS]);
  const runRef = useRef<(items: CkItem[], id: string) => void>(() => undefined);
  const onRun = useCallback((items: CkItem[], id: string) => runRef.current(items, id), []);
  const onEdit = useCallback((itemId: string, idx: number, url: string) => setEditImg({ itemId, idx, url }), []);
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

  // Deja la ventana vacía (datos, salidas, capturas) para otro cliente; el logo se conserva.
  const clearAll = () => { setS(freshRun(data)); setPdf(null); setWord(null); setPdfError(null); setLog(""); setReadings({}); };

  // Todo lo de esta ventana (datos, salidas de comandos, capturas) se guarda solo por SOT y se puede traer de vuelta.
  const ws = useWorkspace({
    key: `checklist:${type.id}`, label: `CheckList · ${type.nombre}`, sot: s.sot, nombre: s.cliente, fecha: s.fecha,
    state: s,
    clear: clearAll,
    clientData: { sot: s.sot, nombre: s.cliente, fecha: s.fecha, cid: s.cid, datos: datosSot },
    apply: (saved) => setS((p) => ({ ...p, ...saved, params: { ...p.params, ...(saved?.params ?? {}) } })),
    // Lo que necesita esta ventana de un cliente que ya existe: CID, nombre, modelo, ancho y sus parámetros (IPs, interfaces).
    fill: (c) => setS((p) => {
      const d = expandDatos(c.datos);
      const params = { ...p.params };
      for (const prm of data.params) if (d[prm.key] && (params[prm.key] ?? "") === prm.default) params[prm.key] = d[prm.key];
      return {
        ...p, cid: p.cid || c.cid, cliente: p.cliente || c.nombre,
        modelo: p.modelo || d.MODELO || "", ancho: p.ancho || d.ANCHO_MBPS || "", params,
      };
    }),
  });

  async function pickClient(c: ClientRecord) {
    if (!(await ws.confirmReplace())) return;
    let full = c;
    try { full = (await api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(c.sot)}`)).data; } catch { /* se usa lo de la lista */ }
    const d = expandDatos(full.datos);
    ws.open(c.sot); // si ya había algo guardado de este cliente en esta ventana, se trae solo
    setPdf(null); setWord(null); setPdfError(null); setLog(""); setReadings({});
    // Se parte de una ventana vacía: lo que el cliente no tenga queda en blanco
    const base = freshRun(data);
    const params = { ...base.params };
    for (const prm of data.params) if (d[prm.key]) params[prm.key] = d[prm.key];
    setS({ ...base, sot: c.sot, cid: c.cid, cliente: c.nombre, fecha: c.fecha || base.fecha, modelo: d.MODELO || "", ancho: d.ANCHO_MBPS || "", params });
  }

  const allItems = useMemo(() => data.sections.flatMap((sec) => sec.items), [data]);
  const wan = s.params["WAN"] ?? "";

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

  runRef.current = (items, label) => void runItems(items, label);
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
      </div>

      <WorkspaceBar ws={ws} />

      <div className="flex flex-wrap gap-2">
        <button className={tab === "run" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("run")}>Ejecutar / Generar PDF</button>
        <button className={tab === "edit" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("edit")}>Estructura (editar)</button>
      </div>

      {tab === "edit" ? (
        <ChecklistStructure
          key={`${type.id}:${type.personal ? 1 : 0}:${JSON.stringify(type.data).length}`}
          type={type}
          isSuper={me?.role === "superadmin"}
          onPublish={async (nombre, d) => { await publishChecklistType(type.id, nombre, d); }}
          onSetBase={async (nombre, d) => { await setChecklistBase(type.id, nombre, d); }}
          onRestore={async () => { await restoreChecklistBase(type.id); }}
          onSave={async (nombre, d) => { await updateChecklistType(type.id, nombre, d); }}
          onDelete={async () => { await deleteChecklistType(type.id); navigate("/checklist", { replace: true }); }}
        />
      ) : (
        <>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Tu avance se guarda solo en este navegador; los datos de la SOT, en «Datos de cliente».</p>
              <div className="flex flex-wrap items-center gap-2">
                <ClientPicker onPick={(c) => void pickClient(c)} />
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

          <div className="card flex flex-wrap items-center gap-2">
            <button className="btn-primary text-sm" disabled={!connected || !!busy} onClick={() => runItems(allItems, "all")}>Ejecutar todo</button>
            {busy && busy !== "pdf" && (
              <button className="btn-secondary text-sm" onClick={() => { if (session.current) session.current.stopRequested = true; }}>Detener</button>
            )}
            {log && <span className="font-mono text-xs text-slate-600 break-all">{log}</span>}
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
                  <button className="btn-secondary text-xs" disabled={!connected || !!busy} onClick={() => runItems(sec.items, sec.id)}>Ejecutar sección</button>
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {sec.items.map((it) => (
                <ItemCard key={it.id} it={it} r={row(it.id)} params={s.params} ancho={s.ancho} connected={connected} busy={!!busy}
                  saturando={saturando} reading={readings[it.id]} onRow={setRow} onRun={onRun} onEdit={onEdit} />
              ))}
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
const ItemCard = memo(function ItemCard({ it, r, params, ancho, connected, busy, saturando, reading, onRow, onRun, onEdit }: {
  it: CkItem; r: Row; params: Record<string, string>; ancho: string; connected: boolean; busy: boolean; saturando: boolean;
  reading?: { inMbps: number; outMbps: number };
  onRow: (id: string, patch: Partial<Row>) => void; onRun: (items: CkItem[], id: string) => void; onEdit: (id: string, idx: number, url: string) => void;
}) {
  const filled = it.cmd ? fillCmd(it.cmd, params) : null;
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={r.incluir} onChange={(e) => onRow(it.id, { incluir: e.target.checked })} />
        <span className="font-medium text-sm text-slate-800 flex-1 min-w-[180px]">{it.nombre}</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${it.modo === "texto" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
          {it.modo === "texto" ? "TEXTO" : "FOTO"}
        </span>
        {it.cmd && (
          <button className="btn-secondary text-xs" disabled={!connected || busy} onClick={() => onRun([it], it.id)} title="Ejecutar solo este ítem">Ejecutar</button>
        )}
      </div>
      {isSatItem(it) && (
        <p className={`text-[11px] ${saturando ? "text-green-700" : "text-amber-700"}`}>
          {saturando ? "Saturación activa: se puede capturar." : "Solo se captura con la saturación activa."}
          {reading && (() => {
            const rt = reading;
            const bw = Number(ancho) || 0;
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
                onClick={() => onEdit(it.id, k, im.url)}>Editar</button>
              <button type="button" aria-label="Quitar captura"
                className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-xs text-white"
                onClick={() => onRow(it.id, { images: r.images.filter((_, j) => j !== k) })}>×</button>
            </div>
          ))}
          <ImageUpload
            key={r.images.length}
            compact
            camera={false}
            label="Agregar captura..."
            onUploaded={(path, url) => path && onRow(it.id, { images: [...r.images, { path, url }] })}
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
          onChange={(e) => onRow(it.id, { texto: e.target.value })}
        />
      </details>
    </div>
  );
});

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

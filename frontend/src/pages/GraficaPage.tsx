import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ClientPicker from "../components/ClientPicker";
import WorkspaceBar from "../components/WorkspaceBar";
import Editor from "../diagram/Editor";
import { DATOS_KEYS, resolveDoc } from "../diagram/templates";
import { fabricaOf, grupoOf, optId, storageId, templateFor } from "../diagram/groups";
import type { OptionInfo } from "../diagram/groups";
import Spinner from "../components/Spinner";
import { fetchOption, fetchVersion, publishOption, setOptionBase, useDiagramOptions } from "../store/diagramOptions";
import type { OptionDetail } from "../store/diagramOptions";
import type { Fields } from "../diagram/templates";
import type { Doc } from "../diagram/types";
import { useUndo } from "../diagram/useUndo";
import { useAuth } from "../store/auth";
import { toISODate, useSotSync } from "../store/clients";
import type { ClientRecord } from "../store/clients";
import { usePersistentState } from "../store/persistentState";
import { useWorkspace } from "../store/workspaces";

interface Saved { fields: Fields; doc: Doc | null }
const EMPTY: Saved = { fields: {}, doc: null };
const dmy = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || ""; };
const today = () => dmy(new Date().toISOString().slice(0, 10));

/** Ventana Gráfica: una opción por marca y tipo de servicio; los datos se piden al inicio y todo se puede editar como en PowerPoint. */
export default function GraficaPage() {
  const { grupo = "", slug = "" } = useParams();
  const { list, loaded } = useDiagramOptions();
  const id = optId(grupo, slug);
  const g = grupoOf(grupo);
  const options: OptionInfo[] = useMemo(() => [
    ...fabricaOf(grupo),
    ...list.filter((o) => o.grupo === grupo && o.custom).map((o) => ({ id: o.id, grupo: grupo as OptionInfo["grupo"], slug: o.id.slice(grupo.length + 1), label: o.nombre, custom: true })),
  ], [list, grupo]);
  const info = options.find((o) => o.id === id);
  const [remote, setRemote] = useState<OptionDetail | null | undefined>(undefined);
  const reload = useCallback(() => fetchOption(id).then(setRemote).catch(() => setRemote((r) => r ?? null)), [id]);
  useEffect(() => { setRemote(undefined); void reload(); }, [reload]);
  if (!g || (loaded && !info)) return <Navigate to="/grafica" replace />;
  if (!info || remote === undefined) return <Spinner />;
  return <GraficaInner key={id} info={info} options={options} remote={remote} reload={reload} />;
}

function GraficaInner({ info, options, remote, reload }: { info: OptionInfo; options: OptionInfo[]; remote: OptionDetail | null; reload: () => Promise<void> }) {
  const tpl = templateFor(storageId(info.id), info.label);
  const { me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = usePersistentState<Saved>(`grafica.${tpl.id}`, EMPTY);
  const fields = data.fields;
  const baseDoc: Doc = remote?.published ?? tpl.doc;     // lo que ven todos hasta que alguien edite su copia
  const doc = data.doc ?? baseDoc;
  const hist = useUndo<Doc>(doc, useCallback((d: Doc) => setData((p) => ({ ...p, doc: d })), [setData]));
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<"" | "pptx" | "pdf">("");
  const [error, setError] = useState<string | null>(null);

  const setField = (k: string, v: string) => setData((p) => ({ ...p, fields: { ...p.fields, [k]: v } }));
  const setMany = (patch: Fields, onlyEmpty = false, replace = false) =>
    setData((p) => {
      // replace: al elegir otro cliente se parte de cero (solo se conserva «Realizado por»); lo que ese cliente no tenga queda en blanco
      const next: Fields = replace ? { realizado: p.fields.realizado ?? myName, fecha: today() } : { ...p.fields };
      for (const [k, v] of Object.entries(patch)) if (v && (!onlyEmpty || !next[k]?.trim())) next[k] = v;
      return { ...p, fields: next };
    });

  // «Realizado por»: automático según el nombre del perfil de la cuenta.
  const myName = (me?.full_name || me?.username || "").toUpperCase();
  useEffect(() => { if (myName && fields.realizado === undefined) setField("realizado", myName); }, [myName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fields.fecha === undefined) setField("fecha", today()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromClient = useCallback((c: ClientRecord, onlyEmpty: boolean, replace = false) => {
    const patch: Fields = { sot: c.sot, cliente: c.nombre, cid: c.cid, proyecto: c.proy, empresa: c.contrata, fecha: dmy(c.fecha) };
    const norm = (s: string) => s.trim().toUpperCase();
    const datos = Object.fromEntries(Object.entries(c.datos ?? {}).map(([k, v]) => [norm(k), v]));
    for (const [key, name] of Object.entries(DATOS_KEYS)) if (datos[name]) patch[key] = datos[name];
    setMany(patch, onlyEmpty, replace);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickClient(c: ClientRecord) {
    fromClient(c, false, true);
    try { const { data: full } = await api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(c.sot)}`); fromClient(full, false); } catch { /* ya se usó lo básico */ }
  }

  // Lo que se guarda por cliente: todo el diagrama (datos + lienzo editable).
  const wsState = useMemo(() => ({ fields, doc: data.doc }), [fields, data.doc]);
  const ws = useWorkspace({
    key: `grafica:${tpl.id}`, label: `Gráfica · ${tpl.label}`, sot: fields.sot ?? "", nombre: fields.cliente, fecha: toISODate(fields.fecha ?? ""),
    state: wsState,
    apply: (saved: Saved) => { setData({ fields: saved?.fields ?? {}, doc: saved?.doc ?? null }); hist.clear(); },
    fill: (c) => fromClient(c, true),
  });

  // Los datos del diagrama también enriquecen al cliente en «Mis clientes».
  const datos = useMemo(() => {
    const o: Record<string, string> = {};
    for (const [key, name] of Object.entries(DATOS_KEYS)) if (fields[key]?.trim()) o[name] = fields[key].trim();
    return o;
  }, [fields]);
  useSotSync({ sot: fields.sot ?? "", nombre: fields.cliente ?? "", fecha: fields.fecha ?? "", cid: fields.cid ?? "", proy: fields.proyecto ?? "", contrata: fields.empresa ?? "", datos });

  const baseName = `DIAGRAMA-SOT-${(fields.sot || "SIN-SOT").trim()}${fields.cliente ? "_" + fields.cliente.trim().replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/g, "_").replace(/^_|_$/g, "") : ""}`;
  async function download(kind: "pptx" | "pdf") {
    setBusy(kind); setError(null);
    try {
      const r = await api.post(`/diagrams/${kind}`, { doc: resolveDoc(doc, fields), filename: baseName }, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${baseName}.${kind}`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      // con responseType "blob" el mensaje del servidor llega dentro de un Blob: se lee para mostrarlo
      let err: unknown = e;
      const blob = (e as { response?: { data?: unknown } })?.response?.data;
      if (blob instanceof Blob) {
        try { err = { response: { data: JSON.parse(await blob.text()) } }; } catch { /* se usa el mensaje genérico */ }
      }
      setError(apiErrorMessage(err, `No se pudo generar el ${kind.toUpperCase()}.`));
    }
    setBusy("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="page-title">Gráfica</h2>
          <p className="text-sm text-slate-500">{tpl.desc}</p>
        </div>
        <select className="input w-auto" value={info.id} onChange={(e) => { const o = options.find((x) => x.id === e.target.value); if (o) navigate(`/grafica/${o.grupo}/${o.slug}`); }} aria-label="Opción de gráfica">
          {options.map((o) => <option key={o.id} value={o.id}>{grupoOf(o.grupo)?.label.replace("Gráficas ", "")} · {o.label}</option>)}
        </select>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 font-semibold text-slate-800">Datos del diagrama</h3>
          <ClientPicker onPick={(c) => void pickClient(c)} />
          <button className="btn-secondary text-xs" onClick={() => setOpen(!open)}>{open ? "Ocultar" : "Mostrar"}</button>
        </div>
        <WorkspaceBar ws={ws} />
        {open && (
          <div className="space-y-4">
            {tpl.groups.map((g) => (
              <div key={g.title} className="border-t border-slate-200 pt-3 first:border-0 first:pt-0">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-600">{g.title}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="label">{f.label}</span>
                      {f.multiline ? (
                        <textarea className="input" rows={2} placeholder={f.hint} value={fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                      ) : (
                        <input className="input" placeholder={f.hint} value={fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-slate-400">Los datos se escriben en el diagrama (y en «Mis clientes»). Si luego editas un texto directamente en el lienzo, ese texto ya no cambia con el formulario.</p>
          </div>
        )}
      </div>

      <Editor doc={doc} fields={fields} hist={hist} />

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => void download("pptx")} disabled={!!busy}>{busy === "pptx" ? "Generando…" : "Descargar PowerPoint (.pptx)"}</button>
        <button className="btn-secondary" onClick={() => void download("pdf")} disabled={!!busy}>{busy === "pdf" ? "Generando…" : "Descargar PDF"}</button>
        <span className="text-xs text-slate-500">{baseName}.pptx</span>
      </div>
      <DesignBar doc={doc} remote={remote} factory={tpl.doc} optId={info.id} isSuper={me?.role === "superadmin"} hist={hist} reload={reload} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}


/** Diseño de la gráfica: restaurar al base (todos) y, para el superadmin, publicar para todos y gestionar los diseños base. */
function DesignBar({ doc, remote, factory, optId: oid, isSuper, hist, reload }: {
  doc: Doc; remote: OptionDetail | null; factory: Doc; optId: string; isSuper: boolean;
  hist: ReturnType<typeof useUndo<Doc>>; reload: () => Promise<void>;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = remote?.base ?? factory;
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); } catch (e) { setMsg(apiErrorMessage(e, "No se pudo completar.")); }
    setBusy(false);
  };
  const versions = remote?.versions ?? [];
  return (
    <div className="card space-y-2 !p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Diseño</span>
        <button className="btn-secondary text-xs" disabled={busy}
          onClick={() => { if (confirm("¿Restaurar al diseño base? Puedes deshacerlo con Ctrl+Z.")) { hist.commit(base); setMsg("Restaurado al diseño base"); } }}>
          Restaurar a diseño base
        </button>
        {isSuper && (
          <>
            <button className="btn-secondary text-xs" disabled={busy}
              onClick={() => confirm("¿Actualizar esta gráfica para TODOS con el diseño que ves ahora?") && void run(async () => { await publishOption(oid, doc); await reload(); }, "Actualizado para todos")}>
              Actualizar cambios para todos
            </button>
            <button className="btn-secondary text-xs" disabled={busy}
              onClick={() => confirm("¿Poner el diseño actual como diseño base? Se guarda como la versión base más reciente (las anteriores se conservan) y pasa a ser la de todos.") && void run(async () => { await setOptionBase(oid, doc); await reload(); }, "Diseño base guardado")}>
              Poner como diseño base
            </button>
            <button className="btn-secondary text-xs" disabled={busy || !remote?.base}
              onClick={() => { if (remote?.base && confirm("¿Cargar el diseño base más reciente en el lienzo? Puedes deshacerlo con Ctrl+Z.")) { hist.commit(remote.base); setMsg("Cargado el diseño base reciente"); } }}>
              Ir a diseño base reciente
            </button>
            <select className="input !w-auto !py-1 text-xs" value="" disabled={busy || versions.length === 0} aria-label="Recuperar un diseño base anterior"
              onChange={(e) => {
                const v = versions.find((x) => x.id === e.target.value);
                if (!v) return;
                void run(async () => { const d = await fetchVersion(oid, v.id); hist.commit(d); }, "Diseño base anterior cargado: revísalo y, si te sirve, ponlo como base o actualiza para todos");
              }}>
              <option value="">{versions.length ? "Recuperar diseño base anterior…" : "Sin diseños base anteriores"}</option>
              {versions.map((v, i) => <option key={v.id} value={v.id}>{i === 0 ? "Vigente · " : ""}{new Date(v.at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}{v.by ? ` · ${v.by}` : ""}</option>)}
            </select>
          </>
        )}
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>
      <p className="text-[11px] text-slate-400">Tus cambios se guardan solo en tu cuenta{isSuper ? "; «Actualizar cambios para todos» y «Poner como diseño base» los comparten" : ""}.</p>
    </div>
  );
}

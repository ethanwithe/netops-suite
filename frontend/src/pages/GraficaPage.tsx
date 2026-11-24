import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ClientPicker from "../components/ClientPicker";
import WorkspaceBar from "../components/WorkspaceBar";
import Editor from "../diagram/Editor";
import { resolveDoc } from "../diagram/templates";
import { fabricaOf, optId, shortLabel, storageId, templateFor } from "../diagram/groups";
import type { OptionInfo } from "../diagram/groups";
import Spinner from "../components/Spinner";
import { fetchOption, fetchVersion, publishOption, setOptionBase, useDiagramOptions, useGrupos } from "../store/diagramOptions";
import type { OptionDetail } from "../store/diagramOptions";
import type { Fields } from "../diagram/templates";
import type { Doc, FieldGroups } from "../diagram/types";
import { useUndo } from "../diagram/useUndo";
import { useAuth } from "../store/auth";
import { attachFile, toISODate, useSotSync } from "../store/clients";
import { expandDatos } from "../store/clientLink";
import type { ClientRecord } from "../store/clients";
import { usePersistentState } from "../store/persistentState";
import { useWorkspace } from "../store/workspaces";
import { createVariable, datosFromFields, deleteVariable, renameVariable, useVariables, valuesFromClient } from "../store/diagramVars";
import type { DiagramVar } from "../store/diagramVars";

type FGroup = FieldGroups[number];
/** Quita los campos de arriba del documento (se guardan aparte: el lienzo solo lleva el dibujo). */
const stripGroups = (d: Doc): Doc => { if (!d || !("fieldGroups" in d)) return d; const { fieldGroups: _f, ...rest } = d; return rest; };
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
interface Saved { fields: Fields; doc: Doc | null; groups?: FGroup[] }
const EMPTY: Saved = { fields: {}, doc: null };
const dmy = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || ""; };
const today = () => dmy(new Date().toISOString().slice(0, 10));

/** Ventana Gráfica: una opción por marca y tipo de servicio; los datos se piden al inicio y todo se puede editar como en PowerPoint. */
export default function GraficaPage() {
  const { grupo = "", slug = "" } = useParams();
  const { list, loaded, layout } = useDiagramOptions();
  const id = optId(grupo, slug);
  const grupos = useGrupos();
  const g = grupos.find((x) => x.id === grupo);
  const options: OptionInfo[] = useMemo(() => [
    ...fabricaOf(grupo, layout.labels),
    ...list.filter((o) => o.grupo === grupo && o.custom).map((o) => ({ id: o.id, grupo: grupo as OptionInfo["grupo"], slug: o.id.slice(grupo.length + 1), label: o.nombre, custom: true })),
  ], [list, grupo, layout]);
  const info = options.find((o) => o.id === id);
  const [remote, setRemote] = useState<OptionDetail | null | undefined>(undefined);
  const reload = useCallback(() => fetchOption(id).then(setRemote).catch(() => setRemote((r) => r ?? null)), [id]);
  useEffect(() => { setRemote(undefined); void reload(); }, [reload]);
  if (loaded && (!g || !info)) return <Navigate to="/grafica" replace />;
  if (!g || !info || remote === undefined) return <Spinner />;
  return <GraficaInner key={id} info={info} options={options} remote={remote} reload={reload} />;
}

function GraficaInner({ info, options, remote, reload }: { info: OptionInfo; options: OptionInfo[]; remote: OptionDetail | null; reload: () => Promise<void> }) {
  const tpl = templateFor(storageId(info.id), info.label);
  const grupos = useGrupos();
  const { me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = usePersistentState<Saved>(`grafica.${tpl.id}`, EMPTY);
  const fields = data.fields;
  const fieldsRef = useRef(fields); fieldsRef.current = fields;
  // Campos de arriba: los del diseño base/publicado para todos, salvo que esta cuenta los haya cambiado a su gusto.
  const sharedGroups: FGroup[] = remote?.published?.fieldGroups ?? tpl.groups;
  const groups: FGroup[] = data.groups ?? sharedGroups;
  const [editFields, setEditFields] = useState(false);
  const vars = useVariables();
  const varsRef = useRef(vars); varsRef.current = vars;
  const isSuper = me?.role === "superadmin";
  const setGroups = (fn: (g: FGroup[]) => FGroup[]) => setData((p) => ({ ...p, groups: fn(p.groups ?? sharedGroups) }));
  const patchField = (gi: number, fi: number, patch: Partial<FGroup["fields"][number]>) =>
    setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, fields: g.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) } : g)));
  const baseDoc: Doc = useMemo(() => stripGroups(remote?.published ?? tpl.doc), [remote, tpl.doc]);     // lo que ven todos hasta que alguien edite su copia
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
    // Cada variable sabe qué dato del cliente jalar (los datos del CheckList también cuentan, ver clientLink.ts)
    setMany(valuesFromClient(varsRef.current, c, expandDatos(c.datos)), onlyEmpty, replace);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const usedKeys = useMemo(() => new Set(groups.flatMap((g) => g.fields.map((f) => f.key))), [groups]);
  /** Trae del cliente el dato de esa variable (si hay cliente y el campo está vacío). */
  async function refill(key: string) {
    const sot = (fieldsRef.current.sot ?? "").trim();
    if (!sot || (fieldsRef.current[key] ?? "").trim()) return;
    try {
      const { data: c } = await api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(sot)}`);
      const v = valuesFromClient(varsRef.current, c, expandDatos(c.datos))[key];
      if (v) setField(key, v);
    } catch { /* no es cliente todavía */ }
  }
  function bindVar(gi: number, fi: number, key: string) {
    const v: DiagramVar | undefined = vars.find((x) => x.key === key);
    patchField(gi, fi, { key, label: v?.label ?? key });
    void refill(key);
  }
  function addField(gi: number) {
    const free = vars.find((v) => !usedKeys.has(v.key));
    if (!free) { alert("Ya están todas las variables en la pantalla."); return; }
    setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, fields: [...x.fields, { key: free.key, label: free.label }] } : x)));
    void refill(free.key);
  }
  async function newVariable() {
    const name = prompt("Nombre de la variable nueva (por ejemplo: IP GESTION).\nSe crea para todos los clientes y se guarda en sus datos con ese nombre:");
    if (!name?.trim()) return;
    try {
      const v = await createVariable(name.trim());
      setGroups((gs) => (gs.length ? gs.map((x, i) => (i === gs.length - 1 && !usedKeys.has(v.key) ? { ...x, fields: [...x.fields, { key: v.key, label: v.label }] } : x)) : gs));
    } catch (e) { alert(apiErrorMessage(e, "No se pudo crear la variable.")); }
  }
  // Si el diseño para todos suma campos nuevos arriba, se llenan solos con lo que ya tiene el cliente.
  const keysSig = groups.flatMap((g) => g.fields.map((f) => f.key)).join("|");
  useEffect(() => {
    const sot = (fieldsRef.current.sot ?? "").trim();
    const missing = keysSig.split("|").filter((k) => k && !(fieldsRef.current[k] ?? "").trim());
    if (!sot || !missing.length) return;
    let dead = false;
    api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(sot)}`).then(({ data: c }) => {
      if (dead) return;
      const vals = valuesFromClient(varsRef.current, c, expandDatos(c.datos));
      const patch: Fields = {};
      for (const k of missing) if (vals[k]) patch[k] = vals[k];
      if (Object.keys(patch).length) setMany(patch, true);
    }).catch(() => undefined);
    return () => { dead = true; };
  }, [keysSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearAll = () => { setData((p) => ({ fields: { realizado: myName, fecha: today() }, doc: null, groups: p.groups })); hist.clear(); };
  async function pickClient(c: ClientRecord) {
    if (!(await ws.confirmReplace())) return;
    ws.open(c.sot); // si ya había un diagrama guardado de este cliente, se trae solo
    setData((p) => ({ fields: {}, doc: null, groups: p.groups })); hist.clear();   // se parte de cero: nada del cliente anterior
    fromClient(c, false, true);
    try { const { data: full } = await api.get<ClientRecord>(`/clients/by-sot/${encodeURIComponent(c.sot)}`); fromClient(full, false); } catch { /* ya se usó lo básico */ }
  }

  // Los datos del diagrama también enriquecen al cliente en «Mis clientes».
  const datos = useMemo(() => {
    return datosFromFields(vars, fields);
  }, [fields, vars]);

  // Lo que se guarda por cliente: todo el diagrama (datos + lienzo editable).
  const wsState = useMemo(() => ({ fields, doc: data.doc, groups: data.groups }), [fields, data.doc, data.groups]);
  const ws = useWorkspace({
    key: `grafica:${tpl.id}`, label: `Gráfica · ${tpl.label}`, sot: fields.sot ?? "", nombre: fields.cliente, fecha: toISODate(fields.fecha ?? ""),
    state: wsState,
    clear: () => clearAll(),
    clientData: { sot: fields.sot ?? "", nombre: fields.cliente ?? "", fecha: fields.fecha ?? "", cid: fields.cid ?? "", proy: fields.proyecto ?? "", contrata: fields.empresa ?? "", datos },
    apply: (saved: Saved) => { setData({ fields: saved?.fields ?? {}, doc: saved?.doc ?? null, groups: saved?.groups }); hist.clear(); },
    fill: (c) => fromClient(c, true),
  });

  useSotSync({ sot: fields.sot ?? "", nombre: fields.cliente ?? "", fecha: fields.fecha ?? "", cid: fields.cid ?? "", proy: fields.proyecto ?? "", contrata: fields.empresa ?? "", datos });

  const baseName = `DIAGRAMA-SOT-${(fields.sot || "SIN-SOT").trim()}${fields.cliente ? "_" + fields.cliente.trim().replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/g, "_").replace(/^_|_$/g, "") : ""}`;
  async function download(kind: "pptx" | "pdf") {
    setBusy(kind); setError(null);
    try {
      const r = await api.post(`/diagrams/${kind}`, { doc: resolveDoc(doc, fields), filename: baseName }, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${baseName}.${kind}`; document.body.appendChild(a); a.click(); a.remove();
      // También queda en los reportes del cliente (para la carpeta del cliente)
      if ((fields.sot ?? "").trim()) void attachFile(fields.sot, "grafica", `${tpl.label} (${kind.toUpperCase()})`, `${baseName}.${kind}`, r.data as Blob).catch(() => undefined);
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
          {options.map((o) => <option key={o.id} value={o.id}>{shortLabel(grupos.find((x) => x.id === o.grupo))} · {o.label}</option>)}
        </select>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 font-semibold text-slate-800">Datos del diagrama</h3>
          <ClientPicker onPick={(c) => void pickClient(c)} />
          <button className="btn-secondary text-xs" onClick={() => { setEditFields(!editFields); setOpen(true); }}>{editFields ? "Listo" : "Editar campos"}</button>
          <button className="btn-secondary text-xs" onClick={() => setOpen(!open)}>{open ? "Ocultar" : "Mostrar"}</button>
        </div>
        <WorkspaceBar ws={ws} />
        {open && (
          <div className="space-y-4">
            {groups.map((g, gi) => (
              <div key={gi} className="border-t border-slate-200 pt-3 first:border-0 first:pt-0">
                {editFields && isSuper ? (
                  <div className="mb-2 flex items-center gap-2">
                    <input className="input !py-1 flex-1 text-xs font-bold uppercase tracking-wider" value={g.title} aria-label="Título del grupo"
                      onChange={(e) => setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, title: e.target.value } : x)))} />
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => confirm(`¿Quitar el grupo «${g.title}» con sus ${g.fields.length} campos?`) && setGroups((gs) => gs.filter((_, i) => i !== gi))}>Quitar grupo</button>
                  </div>
                ) : (
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-600">{g.title}</p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.fields.map((f, fi) => (
                    <label key={f.key} className="block">
                      {editFields ? (
                        <span className="mb-1 flex flex-wrap items-center gap-1">
                          {isSuper && <input className="input !py-0.5 min-w-0 flex-1 text-xs" value={f.label} aria-label="Nombre del campo" onChange={(e) => patchField(gi, fi, { label: e.target.value })} />}
                          <select className="input !py-0.5 min-w-0 flex-1 text-xs" value={f.key} aria-label="Variable de este campo" title="Variable: de aquí jala el dato del cliente"
                            onChange={(e) => bindVar(gi, fi, e.target.value)}>
                            {!vars.some((v) => v.key === f.key) && <option value={f.key}>{`(sin variable) ${f.key}`}</option>}
                            <optgroup label="De fábrica">{vars.filter((v) => v.builtin).map((v) => <option key={v.key} value={v.key} disabled={v.key !== f.key && usedKeys.has(v.key)}>{v.label}</option>)}</optgroup>
                            {vars.some((v) => !v.builtin) && <optgroup label="Creadas con los datos de clientes">{vars.filter((v) => !v.builtin).map((v) => <option key={v.key} value={v.key} disabled={v.key !== f.key && usedKeys.has(v.key)}>{v.label}</option>)}</optgroup>}
                          </select>
                          <button type="button" className="btn-secondary !px-2 !py-0.5 text-xs" title="Quitar este campo"
                            onClick={() => { setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, fields: x.fields.filter((_, j) => j !== fi) } : x))); setField(f.key, ""); }}>✕</button>
                        </span>
                      ) : (
                        <span className="label">{f.label}</span>
                      )}
                      {f.multiline ? (
                        <textarea className="input" rows={2} placeholder={f.hint} value={fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                      ) : (
                        <input className="input" placeholder={f.hint} value={fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                      )}
                      {editFields && <span className="mt-0.5 block select-all text-[10px] text-slate-400" title="Escríbelo en un texto del lienzo para que se llene solo">{`{{${f.key}}}`}</span>}
                    </label>
                  ))}
                </div>
                {editFields && (
                  <button className="btn-secondary mt-2 !px-2 !py-1 text-xs"
                    onClick={() => addField(gi)}>+ Campo</button>
                )}
              </div>
            ))}
            {editFields && (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isSuper && <button className="btn-secondary text-xs" onClick={() => setGroups((gs) => [...gs, { title: "NUEVO GRUPO", fields: [] }])}>+ Grupo</button>}
                  {isSuper && <button className="btn-secondary text-xs" onClick={() => void newVariable()}>+ Variable nueva</button>}
                  <button className="btn-secondary text-xs" onClick={() => confirm("¿Volver a los campos del diseño base (los de todos)?") && setData((p) => ({ ...p, groups: undefined }))}>Restaurar campos originales</button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Cada campo tiene su <b>variable</b>: elígela en el desplegable y el dato se jala solo del cliente.
                  Las variables se crean solas cuando aparece un dato nuevo en «Datos de cliente» y son las mismas para todos los clientes.
                  Para verla en el lienzo, elige «Insertar variable» en las propiedades de un texto.
                  {!isSuper && " Solo el superadmin puede crear o renombrar variables y cambiar los grupos."}
                </p>
                {isSuper && vars.some((v) => !v.builtin) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-600">Variables creadas por los datos de clientes ({vars.filter((v) => !v.builtin).length})</summary>
                    <ul className="mt-1 space-y-1">
                      {vars.filter((v) => !v.builtin).map((v) => (
                        <li key={v.key} className="flex items-center gap-1">
                          <input className="input !py-0.5 flex-1 text-xs" defaultValue={v.label} aria-label={`Nombre de ${v.key}`} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== v.label) void renameVariable(v.key, e.target.value); }} />
                          <code className="text-[10px] text-slate-400">{`{{${v.key}}}`}</code>
                          <button className="btn-secondary !px-2 !py-0.5 text-xs" title="Borrar variable" onClick={() => confirm(`¿Borrar la variable «${v.label}»? Los clientes conservan su dato; si aparece de nuevo se vuelve a crear.`) && void deleteVariable(v.key)}>✕</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
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
      <DesignBar doc={doc} groups={groups} sharedGroups={sharedGroups} remote={remote} factory={tpl.doc} optId={info.id} isSuper={me?.role === "superadmin"} hist={hist} reload={reload}
        onGroups={(g) => setData((p) => ({ ...p, groups: g }))} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}


/** Diseño de la gráfica: restaurar al base (todos) y, para el superadmin, publicar para todos y gestionar los diseños base.
 *  «Diseño» = el dibujo del lienzo + los campos que se piden arriba: los dos viajan juntos al base / publicado. */
function DesignBar({ doc, groups, sharedGroups, remote, factory, optId: oid, isSuper, hist, reload, onGroups }: {
  doc: Doc; groups: FGroup[]; sharedGroups: FGroup[]; remote: OptionDetail | null; factory: Doc; optId: string; isSuper: boolean;
  hist: ReturnType<typeof useUndo<Doc>>; reload: () => Promise<void>; onGroups: (g: FGroup[] | undefined) => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = remote?.base ?? factory;
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); } catch (e) { setMsg(apiErrorMessage(e, "No se pudo completar.")); }
    setBusy(false);
  };
  /** Lleva a pantalla un diseño completo: el dibujo y los campos de arriba. */
  const apply = (d: Doc) => {
    hist.commit(stripGroups(d));
    onGroups(d.fieldGroups && !sameJson(d.fieldGroups, sharedGroups) ? d.fieldGroups : undefined);
  };
  /** Lo que se comparte: el dibujo que ves + los campos que ves arriba. */
  const full = (): Doc => ({ ...doc, fieldGroups: groups });
  const versions = remote?.versions ?? [];
  return (
    <div className="card space-y-2 !p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Diseño</span>
        <button className="btn-secondary text-xs" disabled={busy}
          onClick={() => { if (confirm("¿Restaurar al diseño base? Vuelven el dibujo y los campos de arriba. Puedes deshacer el dibujo con Ctrl+Z.")) { apply(base); setMsg("Restaurado al diseño base"); } }}>
          Restaurar a diseño base
        </button>
        {isSuper && (
          <>
            <button className="btn-secondary text-xs" disabled={busy}
              onClick={() => confirm("¿Actualizar esta gráfica para TODOS con lo que ves ahora (dibujo y campos de arriba)?") && void run(async () => { await publishOption(oid, full()); await reload(); onGroups(undefined); }, "Actualizado para todos (dibujo y campos)")}>
              Actualizar cambios para todos
            </button>
            <button className="btn-secondary text-xs" disabled={busy}
              onClick={() => confirm("¿Poner el diseño actual (dibujo y campos de arriba) como diseño base? Se guarda como la versión base más reciente (las anteriores se conservan) y pasa a ser la de todos.") && void run(async () => { await setOptionBase(oid, full()); await reload(); onGroups(undefined); }, "Diseño base guardado (dibujo y campos)")}>
              Poner como diseño base
            </button>
            <button className="btn-secondary text-xs" disabled={busy || !remote?.base}
              onClick={() => { if (remote?.base && confirm("¿Cargar el diseño base más reciente (dibujo y campos)? Puedes deshacer el dibujo con Ctrl+Z.")) { apply(remote.base); setMsg("Cargado el diseño base reciente"); } }}>
              Ir a diseño base reciente
            </button>
            <select className="input !w-auto !max-w-full !py-1 text-xs" value="" disabled={busy || versions.length === 0} aria-label="Recuperar un diseño base anterior"
              onChange={(e) => {
                const v = versions.find((x) => x.id === e.target.value);
                if (!v) return;
                void run(async () => { const d = await fetchVersion(oid, v.id); apply(d); }, "Diseño base anterior cargado: revísalo y, si te sirve, ponlo como base o actualiza para todos");
              }}>
              <option value="">{versions.length ? "Recuperar diseño base anterior…" : "Sin diseños base anteriores"}</option>
              {versions.map((v, i) => <option key={v.id} value={v.id}>{i === 0 ? "Vigente · " : ""}{new Date(v.at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}{v.by ? ` · ${v.by}` : ""}</option>)}
            </select>
          </>
        )}
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>
      <p className="text-[11px] text-slate-400">Tus cambios (dibujo y campos de arriba) se guardan solo en tu cuenta{isSuper ? "; «Actualizar cambios para todos» y «Poner como diseño base» los comparten con todos" : ""}.</p>
    </div>
  );
}

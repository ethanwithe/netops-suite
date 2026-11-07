import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import ClientPicker from "../components/ClientPicker";
import WorkspaceBar from "../components/WorkspaceBar";
import Editor from "../diagram/Editor";
import { DATOS_KEYS, findTemplate, resolveDoc, TEMPLATES } from "../diagram/templates";
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

/** Ventana Gráfica: un diagrama por tipo de servicio; los datos se piden al inicio y todo se puede editar como en PowerPoint. */
export default function GraficaPage({ tplId }: { tplId: string }) {
  const tpl = findTemplate(tplId);
  const { me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = usePersistentState<Saved>(`grafica.${tpl.id}`, EMPTY);
  const fields = data.fields;
  const doc = data.doc ?? tpl.doc;
  const hist = useUndo<Doc>(doc, useCallback((d: Doc) => setData((p) => ({ ...p, doc: d })), [setData]));
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<"" | "pptx" | "pdf">("");
  const [error, setError] = useState<string | null>(null);

  const setField = (k: string, v: string) => setData((p) => ({ ...p, fields: { ...p.fields, [k]: v } }));
  const setMany = (patch: Fields, onlyEmpty = false) =>
    setData((p) => {
      const next = { ...p.fields };
      for (const [k, v] of Object.entries(patch)) if (v && (!onlyEmpty || !next[k]?.trim())) next[k] = v;
      return { ...p, fields: next };
    });

  // «Realizado por»: automático según el nombre del perfil de la cuenta.
  const myName = (me?.full_name || me?.username || "").toUpperCase();
  useEffect(() => { if (myName && fields.realizado === undefined) setField("realizado", myName); }, [myName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fields.fecha === undefined) setField("fecha", today()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromClient = useCallback((c: ClientRecord, onlyEmpty: boolean) => {
    const patch: Fields = { sot: c.sot, cliente: c.nombre, cid: c.cid, proyecto: c.proy, empresa: c.contrata, fecha: dmy(c.fecha) };
    const norm = (s: string) => s.trim().toUpperCase();
    const datos = Object.fromEntries(Object.entries(c.datos ?? {}).map(([k, v]) => [norm(k), v]));
    for (const [key, name] of Object.entries(DATOS_KEYS)) if (datos[name]) patch[key] = datos[name];
    setMany(patch, onlyEmpty);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickClient(c: ClientRecord) {
    fromClient(c, false);
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
        <select className="input w-auto" value={tpl.id} onChange={(e) => navigate(`/grafica/${e.target.value}`)} aria-label="Tipo de diagrama">
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
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
        <button className="btn-secondary" onClick={() => { if (confirm("¿Volver al diseño original? Puedes deshacerlo con Ctrl+Z.")) hist.commit(tpl.doc); }}>Restaurar diseño base</button>
        <span className="text-xs text-slate-500">{baseName}.pptx</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

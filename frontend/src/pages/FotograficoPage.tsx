import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import ImageAnnotator from "../components/ImageAnnotator";
import LogoPicker from "../components/LogoPicker";
import Spinner from "../components/Spinner";
import type { PhotoItem } from "../types";
import { usePersistentState } from "../store/persistentState";
import {
  FOTO_TIPOS,
  generatePdf,
  importReport,
  isCustom,
  isGpon,
  buildSections,
  upgradeSections,
  blockNames,
  renameBlock,
  removeBlock,
  moveBlock,
  patchCell,
  patchSection,
  addCell,
  addSection,
  moveCell,
  moveSection,
  removeCell,
  removeSection,
  setSections,
  previewFilename,
  pruneRows,
  resetReport,
  setField,
  usePhotoReport,
} from "../store/photoReportStore";
import ImportPdfButton from "../components/ImportPdfButton";
import type { ImportedProject } from "../components/ImportPdfButton";
import { savePjForm } from "../store/pjForm";
import { useNavigate } from "react-router-dom";
import type { FotoTipo } from "../store/photoReportStore";
import { addExtra, removeExtra, resolveOpcion, updateExtra, useOpciones } from "../store/photoReportStore";
import { useWorkspace } from "../store/workspaces";
import WorkspaceBar from "../components/WorkspaceBar";
import ClientPicker from "../components/ClientPicker";
import { syncClient, toISODate, useSotSync } from "../store/clients";
import OpcionesManager from "../components/OpcionesManager";


const CATEGORIAS_GPON = [
  "EQUIPOS INSTALADOS",
  "INSTALACION Y IDENTIFICACION DE EQUIPOS",
  "RECORRIDO",
  "ETIQUETADO",
  "PANORAMICA DE UBICACION",
  "MULTIMETRO",
  "QR",
];

const CATEGORIAS_FIBRA = [
  "EQUIPOS INSTALADOS ACCESO",
  "ETIQUETADO",
  "RECORRIDO EN ACCESO",
  "VISTA GENERAL UBICACION DE EQUIPOS",
  "EQUIPOS LADO CLIENTE",
  "ETIQUETADO CLIENTE",
  "VISTA INSTALACION EN GABINETE",
  "RECORRIDO CLIENTE",
  "VISTA INSTALACION DE EQUIPOS",
  "MULTIMETRO",
  "QR",
];

const categoriasBase = (tipo: FotoTipo) => (isGpon(tipo) ? CATEGORIAS_GPON : CATEGORIAS_FIBRA);

/** Agrupa por categoría respetando el orden en que llegan los ítems. */
function groupByCategory(items: PhotoItem[]) {
  const map = new Map<string, PhotoItem[]>();

  for (const it of items) {
    const list = map.get(it.categoria);
    if (list) list.push(it);
    else map.set(it.categoria, [it]);
  }

  return Array.from(map, ([categoria, list]) => ({ categoria, items: list }));
}

// ============================================================
// PÁGINA
// ============================================================

export default function FotograficoPage({
  tipo,
  nombre,
  onConfigure,
}: {
  tipo: FotoTipo;
  /** Nombre de una ventana propia (las fijas usan FOTO_TIPOS). */
  nombre?: string;
  /** Solo ventanas propias: abre su configuración (nombre, valores por defecto). */
  onConfigure?: () => void;
}) {
  // La pestaña activa se recuerda al ir a otra página y volver.
  const [tab, setTab] = usePersistentState<"run" | "items">(`fotografico.tab.${tipo}`, "run");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    return api
      .get<PhotoItem[]>("/photos/items", { params: { tipo } })
      .then((r) => {
        setItems(r.data);
        setLoadError(null);
        pruneRows(tipo, r.data.map((i) => i.id));
      })
      .catch((e) =>
        setLoadError(apiErrorMessage(e, "No se pudieron cargar las descripciones."))
      )
      .finally(() => setLoading(false));
  }, [tipo]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    reload();
  }, [reload]);

  /** Guarda el orden de una categoría: se ve al instante y se confirma en el servidor. */
  const reorderCategory = useCallback(
    async (categoria: string, ids: string[]) => {
      setItems((prev) => {
        const byId = new Map(prev.map((i) => [i.id, i]));
        const reordered = ids.flatMap((id, idx) => {
          const it = byId.get(id);
          return it ? [{ ...it, orden: (idx + 1) * 10 }] : [];
        });

        const out: PhotoItem[] = [];
        let inserted = false;
        for (const it of prev) {
          if (it.categoria !== categoria) out.push(it);
          else if (!inserted) {
            out.push(...reordered);
            inserted = true;
          }
        }
        return out;
      });

      try {
        await api.post("/photos/items/reorder", { ids });
      } catch (e) {
        alert(apiErrorMessage(e, "No se pudo guardar el nuevo orden."));
        reload(); // vuelve a lo que realmente hay en el servidor
      }
    },
    [reload]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">
          Reporte Fotográfico — {nombre ?? FOTO_TIPOS[tipo]}
        </h2>
        {onConfigure && (
          <button type="button" className="btn-secondary mt-1 text-xs" onClick={onConfigure}>
            Configurar esta ventana (nombre y valores por defecto)
          </button>
        )}

        <p className="text-slate-500 text-sm">
          Arma el PDF del reporte fotográfico: marca los ítems, sube o toma la
          foto de cada uno y elige a qué opción pertenece.
        </p>
        <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Cómo se usa (tutorial)
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Llena los datos: <b>PROY, CLIENTE, SOT, FECHA, CID y CONTRATA</b>,
              y elige los logos. El PDF se llamará <i>RF_SOT-&lt;sot&gt;_&lt;cliente&gt;.pdf</i>.
            </li>
            <li>
              En <b>Opciones del título</b> define las secciones del reporte
              (por ejemplo «INSTALACION EN CLIENTE»). Puedes <b>agregar</b>,
              <b> renombrar</b> y <b>borrar</b>; sirven para todas las ventanas.
              El título del PDF es «REPORTE FOTOGRAFICO» + la opción elegida.
            </li>
            <li>
              Marca los ítems que van, y arrástralos (asa «Mover») para cambiar el orden.
              Si quieres, edita su descripción.
            </li>
            <li>
              En cada ítem elige su <b>opción</b> y sube la foto, o usa
              <b> Tomar foto</b>: la cámara muestra en vivo el sello (fecha,
              dirección y coordenadas) y con «Mover sello» lo cambias de esquina
              para no tapar la serie del equipo.
            </li>
            <li>
              Usa <b>Editar</b> para dibujar líneas, flechas, texto, recortar
              o mejorar la imagen.
            </li>
            <li>
              Pulsa <b>Generar reporte</b>. Se crea una sección (con su propio
              título y numeración) por cada opción usada. El PDF se puede
              volver a abrir con «Abrir PDF» para seguir editándolo.
            </li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            Tu avance se guarda solo en este navegador; «Nuevo reporte» lo borra.
          </p>
        </details>
      </div>

      <div className="flex gap-2">
        <button
          className={tab === "run" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("run")}
        >
          Generar reporte
        </button>

        <button
          className={tab === "items" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("items")}
        >
          Descripciones (editar)
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="card flex items-center justify-between gap-3 border-red-200 bg-red-50 text-sm text-red-700"
        >
          <span>{loadError}</span>
          <button className="btn-secondary text-xs" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Cargando…
        </p>
      ) : tab === "run" ? (
        <RunTab tipo={tipo} nombre={nombre ?? FOTO_TIPOS[tipo] ?? tipo} items={items} onReorder={reorderCategory} />
      ) : (
        <ItemsTab tipo={tipo} items={items} onChange={reload} />
      )}
    </div>
  );
}

// ============================================================
// PESTAÑA: GENERAR REPORTE
// (el estado vive en store/photoReportStore, no aquí: así no se
//  pierde al cambiar de pestaña o de página)
// ============================================================

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function RunTab({
  tipo,
  nombre,
  items,
  onReorder,
}: {
  tipo: FotoTipo;
  nombre: string;
  items: PhotoItem[];
  onReorder: (categoria: string, ids: string[]) => void;
}) {
  const s = usePhotoReport(tipo);

  const manager = useOpciones();
  const [editing, setEditing] = useState<{ id: string; imageUrl: string; extra?: boolean; sid?: string } | null>(null);
  const [zip, setZip] = useState<{ busy: boolean; url?: string; filename?: string; total?: number; missing?: number; error?: string }>({ busy: false });

  // Los datos de la SOT se guardan solos en "Datos de cliente" (año y mes según la fecha).
  useSotSync({ sot: s.sot, nombre: s.cliente, fecha: s.fecha, cid: s.cid, proy: s.proy, contrata: s.contrata });
  const isoToLocal = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
  // Todo lo de esta ventana (fotos, textos, opciones) se guarda solo por SOT y se puede traer de vuelta.
  const wsState = useMemo(() => ({
    titulo: s.titulo, proy: s.proy, cliente: s.cliente, sot: s.sot, fecha: s.fecha, cid: s.cid, contrata: s.contrata,
    logoIzq: s.logoIzq, logoDer: s.logoDer, rows: s.rows, extras: s.extras, sections: s.sections, version: s.version,
  }), [s.titulo, s.proy, s.cliente, s.sot, s.fecha, s.cid, s.contrata, s.logoIzq, s.logoDer, s.rows, s.extras, s.sections, s.version]);
  const ws = useWorkspace({
    key: `foto:${tipo}`, label: `Fotos · ${nombre}`, sot: s.sot, nombre: s.cliente, fecha: toISODate(s.fecha),
    state: wsState,
    apply: (saved) => importReport(tipo, saved),
    // Lo que necesita esta ventana de un cliente que ya existe: sus datos base (solo en campos vacíos).
    fill: (c) => {
      if (!s.cliente && c.nombre) setField(tipo, "cliente", c.nombre);
      if (!s.cid && c.cid) setField(tipo, "cid", c.cid);
      if (!s.proy && c.proy) setField(tipo, "proy", c.proy);
      if (!s.contrata && c.contrata) setField(tipo, "contrata", c.contrata);
    },
  });
  function pickClient(c: { sot: string; nombre: string; fecha: string; cid: string; proy: string; contrata: string }) {
    setField(tipo, "sot", c.sot);
    setField(tipo, "cliente", c.nombre);
    setField(tipo, "cid", c.cid);
    setField(tipo, "proy", c.proy);
    setField(tipo, "contrata", c.contrata);
    if (c.fecha) setField(tipo, "fecha", isoToLocal(c.fecha));
  }

  /** Carpeta de evidencia: fotos finales + originales sin editar, con subcarpeta por opción si hay varias. */
  async function makeZip() {
    const rowsIn = (s.sections ?? []).flatMap((sec) => {
      const op = resolveOpcion(sec.lado, manager.opciones);
      return sec.cells.flatMap((c) => (c.incluir && c.imagePath
        ? [{ nombre: c.descripcion || "foto", path: c.imagePath, original_path: c.originalPath || "", lado_label: op.label }]
        : []));
    });
    const extrasIn = s.extras.map((e) => ({
      nombre: e.nombre || "foto extra", path: e.path, original_path: e.originalPath || "",
      lado_label: resolveOpcion(e.lado, manager.opciones).label,
    }));
    const all = [...rowsIn, ...extrasIn];
    if (!all.length) { setZip({ busy: false, error: "No hay fotos para guardar todavía." }); return; }
    setZip({ busy: true });
    try {
      const { data } = await api.post("/photos/evidence-zip", { sot: s.sot, cliente: s.cliente, items: all });
      setZip({ busy: false, url: data.url, filename: data.filename, total: data.total, missing: data.missing });
      if (s.sot.trim()) {
        void syncClient({ sot: s.sot, nombre: s.cliente, fecha: toISODate(s.fecha), reporte: { tipo: tipo, nombre: `Evidencia · ${nombre}`, filename: data.filename, url: data.url } }).catch(() => {});
      }
    } catch (e) {
      setZip({ busy: false, error: apiErrorMessage(e, "No se pudo crear la carpeta.") });
    }
  }
  const groups = useMemo(() => groupByCategory(items), [items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [onlyUsed, setOnlyUsed] = useState(false);

  // Primera vez (o reporte guardado en el formato anterior): se arman las secciones con las descripciones actuales.
  useEffect(() => {
    if (s.sections === null) setSections(tipo, buildSections(tipo, ordered, s.rows, manager.opciones));
    // Primer formato de secciones (sin bloques) -> con bloques, sin perder fotos ni textos.
    else if (s.sections.some((x) => x.cells.some((c) => c.bloque === undefined))) setSections(tipo, upgradeSections(tipo, s.sections, ordered, manager.opciones));
  }, [s.sections, tipo, ordered, s.rows, manager.opciones]);

  const sections = s.sections ?? [];
  const usedLados = new Set(sections.map((x) => resolveOpcion(x.lado, manager.opciones).id));
  const freeOpciones = manager.opciones.filter((o) => !usedLados.has(o.id));

  /** Título: elegir otro de la lista, o «Otro título…» para escribir uno propio. */
  function pickTitle(sid: string, value: string) {
    if (value !== "__new__") { patchSection(tipo, sid, { lado: value }); return; }
    const t = prompt("Escribe el título (por ejemplo: INSTALACION EN POP):");
    if (!t || !t.trim()) return;
    const id = manager.add(t);
    if (id) patchSection(tipo, sid, { lado: id });
  }

  function renameTitle(lado: string, current: string) {
    const t = prompt("Nuevo nombre para este título:", current);
    if (t && t.trim()) manager.rename(lado, t.trim());
  }

  function onAddSection(value: string) {
    if (!value) return;
    let id = value;
    if (value === "__new__") {
      const t = prompt("Título de la nueva sección (por ejemplo: INSTALACION EN POP):");
      if (!t || !t.trim()) return;
      id = manager.add(t);
      if (!id) return;
    }
    addSection(tipo, id, []);
  }

  const navigate = useNavigate();

  function openPdf(p: ImportedProject) {
    if (p.kind === "pj") {
      // Es un informe de Poder Judicial: se abre en su propia pantalla.
      savePjForm(p.state);
      navigate("/fotografico/poder-judicial");
      return;
    }
    importReport((p.tipo as FotoTipo) ?? "fibra", p.state);
    const route: Record<string, string> = {
      gpon_ont: "gpon-ont",
      gpon_modulo: "gpon-modulo",
      fibra: "fibra",
    };
    navigate(isCustom(p.tipo ?? "fibra") ? `/fotografico/v/${p.tipo}` : `/fotografico/${route[p.tipo ?? "fibra"] ?? "fibra"}`);
  }

  function generate() {
    const marked = sections.flatMap((x) => x.cells.filter((c) => c.incluir));
    if (marked.length === 0) {
      alert("Marca al menos una celda (se marca sola al poner una foto).");
      return;
    }
    const sinImagen = marked.filter((c) => !c.imagePath);
    if (sinImagen.length > 0 && !confirm(`${sinImagen.length} celda(s) sin foto todavía. ¿Generar de todas formas?`)) return;
    void generatePdf(tipo, manager.opciones, nombre);
  }

  function newReport() {
    if (
      confirm(
        "¿Empezar un reporte nuevo?\n\nSe borrarán los datos, los ítems marcados, las descripciones editadas y las fotos. Los logos elegidos se conservan (en una ventana propia vuelven los valores por defecto)."
      )
    ) {
      resetReport(tipo);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            Tu avance se guarda automáticamente en este navegador.
          </p>
          <div className="w-full"><WorkspaceBar ws={ws} /></div>

          <ClientPicker onPick={pickClient} />

          <ImportPdfButton onLoaded={openPdf} />

          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={newReport}
            disabled={s.generating}
          >
            Nuevo reporte
          </button>
        </div>


        <TextField label="PROY" value={s.proy} onChange={(v) => setField(tipo, "proy", v)} />
        <TextField
          label="CLIENTE"
          value={s.cliente}
          onChange={(v) => setField(tipo, "cliente", v)}
        />
        <TextField label="SOT" value={s.sot} onChange={(v) => setField(tipo, "sot", v)} />
        <TextField label="FECHA" value={s.fecha} onChange={(v) => setField(tipo, "fecha", v)} />
        <TextField label="CID" value={s.cid} onChange={(v) => setField(tipo, "cid", v)} />
        <TextField
          label="CONTRATA"
          value={s.contrata}
          onChange={(v) => setField(tipo, "contrata", v)}
        />

        <TextField label="VERSIÓN (para el nombre del archivo)" value={s.version} onChange={(v) => setField(tipo, "version", v)} />

        <p className="sm:col-span-2 text-xs text-slate-500">
          El PDF se guardará como:{" "}
          <span className="break-all font-mono text-slate-700">
            {previewFilename(s.sot, s.cid, s.version)}
          </span>
        </p>

        <div className="sm:col-span-2">
          <LogoPicker
            posicion="izq"
            label="Logo izquierda (empresa)"
            value={s.logoIzq}
            onChange={(v) => setField(tipo, "logoIzq", v)}
          />
        </div>

        <div className="sm:col-span-2">
          <LogoPicker
            posicion="der"
            label="Logo derecha (Claro)"
            value={s.logoDer}
            onChange={(v) => setField(tipo, "logoDer", v)}
          />
        </div>
      </div>

      <OpcionesManager manager={manager} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
          Ver solo celdas con foto o marcadas
        </label>
      </div>

      {s.sections === null && <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Preparando secciones…</p>}

      {sections.map((sec, si) => {
        const op = resolveOpcion(sec.lado, manager.opciones);
        const bloques = blockNames(sec.cells);
        const allOn = sec.cells.length > 0 && sec.cells.every((c) => c.incluir);
        return (
          <div key={sec.id} className="card space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input min-w-[220px] flex-1 font-semibold"
                aria-label="Título de la sección"
                value={op.id}
                onChange={(e) => pickTitle(sec.id, e.target.value)}
              >
                {manager.opciones.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.id !== op.id && usedLados.has(o.id)}>{o.label}</option>
                ))}
                <option value="__new__">Otro título…</option>
              </select>
              <button className="btn-secondary text-xs" onClick={() => renameTitle(op.id, op.label)} title="Cambiar el texto de este título">Editar título</button>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={allOn} onChange={(e) => sec.cells.forEach((c) => patchCell(tipo, sec.id, c.id, { incluir: e.target.checked }))} />
                Marcar todas
              </label>
              <button className="btn-secondary text-xs" disabled={si === 0} onClick={() => moveSection(tipo, sec.id, -1)} aria-label="Subir sección">↑</button>
              <button className="btn-secondary text-xs" disabled={si === sections.length - 1} onClick={() => moveSection(tipo, sec.id, 1)} aria-label="Bajar sección">↓</button>
              <button
                className="btn-secondary text-xs"
                onClick={() => { if (confirm(`¿Quitar la sección «${op.label}» con sus ${sec.cells.length} celdas?`)) removeSection(tipo, sec.id); }}
              >Quitar sección</button>
            </div>

            {bloques.map((bl, bi) => {
              const cells = sec.cells.filter((c) => (c.bloque ?? "") === bl);
              const shown = cells.filter((c) => !onlyUsed || c.incluir || c.imagePath);
              if (onlyUsed && shown.length === 0) return null;
              return (
                <div key={bl || "__sin__"} className="space-y-2 rounded-xl border border-slate-200/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="input min-w-[200px] flex-1 text-sm font-semibold uppercase tracking-wide"
                      aria-label="Nombre del bloque"
                      placeholder="Nombre del bloque"
                      defaultValue={bl}
                      key={`${sec.id}:${bl}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== bl) renameBlock(tipo, sec.id, bl, v); }}
                    />
                    <button className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={bi === 0} onClick={() => moveBlock(tipo, sec.id, bl, -1)} aria-label="Subir bloque">↑</button>
                    <button className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={bi === bloques.length - 1} onClick={() => moveBlock(tipo, sec.id, bl, 1)} aria-label="Bajar bloque">↓</button>
                    <button className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50" onClick={() => { if (confirm(`¿Quitar el bloque «${bl || "sin nombre"}» con sus ${cells.length} celdas?`)) removeBlock(tipo, sec.id, bl); }}>Quitar bloque</button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {shown.map((c) => {
                      const idx = sec.cells.findIndex((x) => x.id === c.id);
                      return (
                        <div key={c.id} className={`space-y-2 rounded-lg border p-3 ${c.incluir ? "border-brand-300 bg-brand-50/40" : "border-slate-200"}`}>
                          <textarea
                            className="input"
                            rows={2}
                            placeholder="Texto sobre la foto"
                            value={c.descripcion}
                            onChange={(e) => patchCell(tipo, sec.id, c.id, { descripcion: e.target.value })}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <ImageUpload
                              compact
                              cliente={s.cliente}
                              initialUrl={c.imageUrl}
                              onUploaded={(p, u) => patchCell(tipo, sec.id, c.id, { imagePath: p, imageUrl: u, originalPath: "", originalUrl: "", incluir: p ? true : c.incluir })}
                            />
                            {c.imagePath && (
                              <button className="btn-secondary text-xs" onClick={() => setEditing({ id: c.id, sid: sec.id, imageUrl: c.imageUrl })}>
                                Editar foto
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <label className="flex items-center gap-1.5 text-slate-600">
                              <input type="checkbox" checked={c.incluir} onChange={(e) => patchCell(tipo, sec.id, c.id, { incluir: e.target.checked })} />
                              Va en el PDF
                            </label>
                            <span className="flex items-center gap-1">
                              <button className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={idx === 0} onClick={() => moveCell(tipo, sec.id, c.id, -1)} aria-label="Subir celda">↑</button>
                              <button className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={idx === sec.cells.length - 1} onClick={() => moveCell(tipo, sec.id, c.id, 1)} aria-label="Bajar celda">↓</button>
                              <button className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50" onClick={() => removeCell(tipo, sec.id, c.id)}>Quitar celda</button>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn-secondary text-xs" onClick={() => addCell(tipo, sec.id, "", bl)}>+ Agregar celda</button>
                </div>
              );
            })}

            {sec.cells.length === 0 && <p className="text-xs text-slate-400">Esta sección está vacía: agrega un bloque y sus celdas.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-secondary text-xs"
                onClick={() => { const n = prompt("Nombre del bloque nuevo (por ejemplo: ETIQUETADO):"); if (n && n.trim()) addCell(tipo, sec.id, "", n.trim()); }}
              >+ Agregar bloque</button>
              <select
                className="input w-auto text-xs"
                aria-label="Agregar bloque de las descripciones de siempre"
                value=""
                onChange={(e) => {
                  const cat = e.target.value;
                  if (!cat) return;
                  ordered.filter((it) => it.categoria === cat).forEach((it) => addCell(tipo, sec.id, it.nombre, cat));
                }}
              >
                <option value="">+ Bloque con descripciones…</option>
                {groups.map((g) => <option key={g.categoria} value={g.categoria}>{g.categoria}</option>)}
              </select>
            </div>
          </div>
        );
      })}

      {s.sections !== null && (
        <div className="card flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Agregar sección (título):</span>
          <select className="input w-auto" aria-label="Agregar sección" value="" onChange={(e) => onAddSection(e.target.value)}>
            <option value="">Elegir…</option>
            {freeOpciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            <option value="__new__">Otro título nuevo…</option>
          </select>
          <span className="text-xs text-slate-500">Queda vacía: agrégale bloques (con las descripciones de siempre o nuevos) y celdas.</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={generate}
          disabled={s.generating}
          aria-busy={s.generating}
        >
          {s.generating ? (
            <>
              <Spinner /> Generando PDF...
            </>
          ) : (
            "Generar PDF"
          )}
        </button>
      </div>

      {s.generating && (
        <div
          role="status"
          aria-live="polite"
          className="card flex items-center gap-4 border-brand-200 bg-brand-50"
        >
          <Spinner className="h-8 w-8 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-brand-700">
              Generando el PDF…
            </p>
            <p className="text-xs text-slate-500">
              Puede tardar unos segundos según la cantidad de fotos.
            </p>
          </div>
        </div>
      )}

      {s.error && (
        <div
          role="alert"
          className="card border-red-200 bg-red-50 text-sm text-red-700"
        >
          {s.error}
        </div>
      )}

      {s.result && (
        <div className="card space-y-2 border-green-200 bg-green-50">
          <p className="text-sm text-green-700">
            PDF generado correctamente ({s.result.pages}{" "}
            {s.result.pages === 1 ? "página" : "páginas"}).
          </p>

          <p className="break-all font-mono text-xs text-slate-600">
            {s.result.filename}
          </p>

          {s.result.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
              {s.result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <a
            className="btn-primary"
            href={s.result.url}
            download={s.result.filename}
          >
            Descargar PDF
          </a>
        </div>
      )}

      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Carpeta de evidencia fotográfica</h3>
          <p className="text-xs text-slate-500">
            Descarga todas las fotos en una carpeta (ZIP) «Evidencia fotográfica SOT … cliente». Cada foto editada va con su original sin editar.
            Si usas varias opciones (site, cliente…), cada una tiene su subcarpeta; si es una sola, van directo en la carpeta principal.
          </p>
        </div>

        {s.extras.length > 0 && (
          <ul className="space-y-2">
            {s.extras.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2">
                <img src={e.url} alt="" className="h-14 w-20 rounded border object-cover" />
                <input className="input min-w-[140px] flex-1" placeholder="Nombre de la foto" value={e.nombre} onChange={(ev) => updateExtra(tipo, e.id, { nombre: ev.target.value })} />
                <select className="input w-full sm:w-56" value={resolveOpcion(e.lado, manager.opciones).id} onChange={(ev) => updateExtra(tipo, e.id, { lado: ev.target.value })}>
                  {manager.opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button className="btn-secondary text-xs" onClick={() => setEditing({ id: e.id, imageUrl: e.url, extra: true })}>Editar</button>
                <button className="btn-secondary text-xs" onClick={() => removeExtra(tipo, e.id)}>Quitar</button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <ImageUpload
            key={s.extras.length}
            compact
            cliente={s.cliente}
            label="Agregar foto a la carpeta..."
            onUploaded={(p, u) => p && addExtra(tipo, { id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, nombre: "", path: p, url: u, lado: manager.opciones[manager.opciones.length - 1].id })}
          />
          <button className="btn-primary" onClick={makeZip} disabled={zip.busy}>
            {zip.busy ? "Preparando carpeta..." : "Descargar carpeta de evidencia"}
          </button>
        </div>
        {zip.error && <p className="text-sm text-red-600">{zip.error}</p>}
        {zip.url && (
          <p className="text-sm text-green-700">
            Carpeta lista ({zip.total} fotos{zip.missing ? `, ${zip.missing} no se encontraron en el servidor` : ""}):{" "}
            <a className="font-medium underline break-all" href={zip.url} download={zip.filename}>{zip.filename}</a>
          </p>
        )}
      </div>

      {editing && (
        <ImageAnnotator
          imageUrl={editing.imageUrl}
          onClose={() => setEditing(null)}
          onSaved={(p, u) => {
            if (editing.extra) {
              const e = s.extras.find((x) => x.id === editing.id);
              updateExtra(tipo, editing.id, { path: p, url: u, originalPath: e?.originalPath || e?.path, originalUrl: e?.originalUrl || e?.url });
            } else {
              const cell = sections.find((x) => x.id === editing.sid)?.cells.find((x) => x.id === editing.id);
              if (editing.sid) patchCell(tipo, editing.sid, editing.id, { imagePath: p, imageUrl: u, originalPath: cell?.originalPath || cell?.imagePath, originalUrl: cell?.originalUrl || cell?.imageUrl });
            }
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// PESTAÑA: DESCRIPCIONES (editar)
// ============================================================

function ItemsTab({
  tipo,
  items,
  onChange,
}: {
  tipo: FotoTipo;
  items: PhotoItem[];
  onChange: () => void;
}) {
  // Borrador del formulario: no se pierde al cambiar de pestaña o de página.
  // (Solo en memoria; "orden" vacío = automático, al final de su categoría.)
  const [draft, setDraft] = usePersistentState(
    `fotografico.itemsDraft.${tipo}`,
    { selectedId: "", categoria: "", nombre: "", orden: "" },
    { persist: false }
  );
  const { categoria, nombre, orden } = draft;
  const setCategoria = (v: string) => setDraft((d) => ({ ...d, categoria: v }));
  const setNombre = (v: string) => setDraft((d) => ({ ...d, nombre: v }));
  const setOrden = (v: string) => setDraft((d) => ({ ...d, orden: v }));

  // Si el ítem elegido se borró (otro usuario / otra pestaña), no hay selección.
  const selected = items.find((i) => i.id === draft.selectedId) ?? null;
  const [busy, setBusy] = useState(false);

  const categorias = useMemo(
    () => Array.from(new Set([...categoriasBase(tipo), ...items.map((i) => i.categoria)])),
    [items, tipo]
  );

  function select(it: PhotoItem) {
    setDraft({
      selectedId: it.id,
      categoria: it.categoria,
      nombre: it.nombre,
      orden: String(it.orden),
    });
  }

  function clear() {
    setDraft({ selectedId: "", categoria: "", nombre: "", orden: "" });
  }

  async function save() {
    if (!nombre.trim()) {
      alert("Escribe la descripción.");
      return;
    }

    if (!categoria.trim()) {
      alert("Escribe la categoría.");
      return;
    }

    const payload: { tipo: FotoTipo; categoria: string; nombre: string; orden?: number } = {
      tipo,
      categoria: categoria.trim(),
      nombre: nombre.trim(),
    };

    if (orden.trim() !== "" && Number.isFinite(Number(orden))) {
      payload.orden = Number(orden);
    }

    setBusy(true);
    try {
      if (selected) {
        await api.put(`/photos/items/${selected.id}`, payload);
      } else {
        await api.post("/photos/items", payload);
      }

      clear();
      onChange();
    } catch (e) {
      alert(apiErrorMessage(e, "No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  }

  async function del(it: PhotoItem) {
    if (!confirm(`¿Eliminar '${it.nombre}'?`)) return;

    setBusy(true);
    try {
      await api.delete(`/photos/items/${it.id}`);
      clear();
      onChange();
    } catch (e) {
      alert(apiErrorMessage(e, "No se pudo eliminar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 lg:gap-6">
      <div className="space-y-3">
        <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => select(it)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                selected?.id === it.id ? "bg-brand-50" : ""
              }`}
            >
              <div className="font-medium text-slate-700">{it.nombre}</div>

              <div className="text-xs text-slate-400">
                [{it.categoria}] orden {it.orden}
              </div>
            </button>
          ))}
        </div>

        <button className="btn-secondary w-full" onClick={clear}>
          + Nueva descripción
        </button>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label">Categoría</label>

          <input
            className="input"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            list="categorias-list"
          />

          <datalist id="categorias-list">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label">Descripción</label>

          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Orden (opcional)</label>

          <input
            className="input"
            type="number"
            placeholder="Automático (al final de la categoría)"
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={busy}>
            Guardar
          </button>

          {selected && (
            <button
              className="btn-danger"
              onClick={() => del(selected)}
              disabled={busy}
            >
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

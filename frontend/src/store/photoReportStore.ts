/**
 * photoReportStore.ts
 *
 * Estado del reporte fotográfico FUERA de los componentes de React.
 *
 * Por qué: antes el estado vivía dentro de <RunTab>, que React destruye al
 * cambiar de pestaña ("Descripciones") o de página, y se perdía todo. Aquí
 * vive a nivel de módulo (sobrevive a esos cambios) y además se guarda en
 * localStorage, así también sobrevive a recargar la página o cerrar el
 * navegador.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePersistentState } from "./persistentState";
import { api, apiErrorMessage } from "../api/client";
import { NO_LOGO, logoPayload } from "../logo";
import type { LogoSel } from "../logo";
import type { PhotoItem } from "../types";

export { apiErrorMessage };
export { NO_LOGO };
export type { LogoSel };

// ============================================================
// TIPOS
// ============================================================

/** Id de una opción de título (ver `Opcion`). */
export type Lado = string;

/** Opción que se agrega al título: el texto completo, p. ej. «INSTALACION EN CLIENTE». */
export interface Opcion {
  id: string;
  label: string;
}

export const DEFAULT_OPCIONES: Opcion[] = [
  { id: "site", label: "INSTALACION EN SITE" },
  { id: "pdi", label: "INSTALACION EN PDI" },
  { id: "pop", label: "INSTALACION EN POP" },
  { id: "cliente", label: "INSTALACION EN CLIENTE" },
];

/** Lista guardada → lista válida (nunca vacía). */
export function cleanOpciones(v: unknown): Opcion[] {
  const out: Opcion[] = [];
  if (Array.isArray(v)) {
    for (const o of v) {
      const x = (o ?? {}) as Record<string, unknown>;
      const id = typeof x.id === "string" ? x.id : "";
      const label = typeof x.label === "string" ? x.label : "";
      if (id && !out.some((q) => q.id === id)) out.push({ id, label });
    }
  }
  return out.length ? out : DEFAULT_OPCIONES;
}

/** Opciones de título compartidas por todas las ventanas del reporte fotográfico. */
export function useOpciones() {
  const [raw, setRaw] = usePersistentState<Opcion[]>("netops.fotografico.opciones", DEFAULT_OPCIONES);
  const opciones = useMemo(() => cleanOpciones(raw), [raw]);
  const add = useCallback(
    (label: string) => {
      const text = label.trim();
      if (!text) return;
      setRaw((prev) => {
        const list = cleanOpciones(prev);
        if (list.some((o) => o.label.toLowerCase() === text.toLowerCase())) return list;
        return [...list, { id: `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: text }];
      });
    },
    [setRaw]
  );
  const remove = useCallback(
    (id: string) => setRaw((prev) => {
      const list = cleanOpciones(prev);
      return list.length > 1 ? list.filter((o) => o.id !== id) : list; // siempre queda al menos una
    }),
    [setRaw]
  );
  const rename = useCallback(
    (id: string, label: string) => setRaw((prev) => cleanOpciones(prev).map((o) => (o.id === id ? { ...o, label } : o))),
    [setRaw]
  );
  const reset = useCallback(() => setRaw(DEFAULT_OPCIONES), [setRaw]);
  return { opciones, add, remove, rename, reset };
}

/** Si la opción de una fila fue borrada, la fila pasa a la primera que quede. */
export function resolveOpcion(lado: Lado, opciones: Opcion[]): Opcion {
  return opciones.find((o) => o.id === lado) ?? opciones.find((o) => o.id === "cliente") ?? opciones[0];
}

export interface RowState {
  incluir: boolean;
  /** Solo si el usuario editó el texto; si no, se usa el nombre del ítem. */
  descripcion?: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
}

export const DEFAULT_ROW: RowState = {
  incluir: false,
  imagePath: "",
  imageUrl: "",
  lado: "cliente",
};

export interface ReportFields {
  titulo: string;
  proy: string;
  cliente: string;
  sot: string;
  fecha: string;
  cid: string;
  contrata: string;
  logoIzq: LogoSel;
  logoDer: LogoSel;
  /** Estado por ítem, indexado por el id del ítem. */
  rows: Record<string, RowState>;
}

export interface GenResult {
  url: string;
  filename: string;
  pages: number;
  warnings: string[];
}

export interface PhotoReportState extends ReportFields {
  generating: boolean;
  result: GenResult | null;
  error: string | null;
}

// ============================================================
// CARGA / GUARDADO (localStorage)
// ============================================================

/** Tipos fijos o el id de una ventana creada por el usuario. */
export type FotoTipo = string;

/** Valores por defecto de una ventana propia (se aplican a cada reporte nuevo). */
export interface WindowConfig {
  proy?: string;
  cliente?: string;
  sot?: string;
  cid?: string;
  contrata?: string;
  logoIzq?: { id: string | null };
  logoDer?: { id: string | null };
}

const BUILTIN: FotoTipo[] = ["fibra", "gpon_ont", "gpon_modulo"];
export const isCustom = (t: FotoTipo) => !BUILTIN.includes(t);

const windowDefaults = new Map<FotoTipo, WindowConfig>();

/** Registra (sin tocar la pantalla) los valores por defecto de una ventana propia. */
export function registerWindowDefaults(tipo: FotoTipo, cfg: WindowConfig | null): void {
  if (cfg) windowDefaults.set(tipo, cfg);
  else windowDefaults.delete(tipo);
}

/** Borra lo guardado de una ventana eliminada. */
export function forgetWindow(tipo: FotoTipo): void {
  windowDefaults.delete(tipo);
  stores.delete(tipo);
  try {
    localStorage.removeItem(keyOf(tipo));
  } catch {
    /* sin localStorage */
  }
}

export const FOTO_TIPOS: Record<string, string> = {
  gpon_ont: "GPON con ONT",
  gpon_modulo: "GPON con módulo",
  fibra: "Fibra convencional",
};

export const isGpon = (t: FotoTipo) => t.startsWith("gpon");

// Cada tipo de reporte guarda su avance por separado. Fibra conserva la clave
// original para no perder lo que ya estaba en curso.
const keyOf = (t: FotoTipo) =>
  t === "fibra" ? "netops.fotografico.v1" : `netops.fotografico.${t}.v1`;

// Los logos sí se comparten entre todos los tipos.
const LOGOS_KEY = "netops.fotografico.logos.v1";

const DEFAULT_TITULO = "REPORTE FOTOGRAFICO";

function todayPE(): string {
  return new Date().toLocaleDateString("es-PE");
}

function freshFields(tipo?: FotoTipo): ReportFields {
  const d = (tipo && windowDefaults.get(tipo)) || {};
  const logo = (v?: { id: string | null }): LogoSel => (v?.id ? { id: v.id, path: "", url: "" } : NO_LOGO);
  return {
    titulo: DEFAULT_TITULO,
    proy: d.proy ?? "",
    cliente: d.cliente ?? "",
    sot: d.sot ?? "",
    fecha: todayPE(),
    cid: d.cid ?? "",
    contrata: d.contrata ?? "",
    logoIzq: logo(d.logoIzq),
    logoDer: logo(d.logoDer),
    rows: {},
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function loadLogo(v: unknown): LogoSel {
  if (!v || typeof v !== "object") return NO_LOGO;
  const x = v as Record<string, unknown>;
  return {
    id: typeof x.id === "string" && x.id ? x.id : null,
    path: str(x.path, ""),
    url: str(x.url, ""),
  };
}

function loadRows(v: unknown): Record<string, RowState> {
  const out: Record<string, RowState> = {};
  if (!v || typeof v !== "object") return out;

  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const x = raw as Record<string, unknown>;
    out[id] = {
      incluir: x.incluir === true,
      descripcion: typeof x.descripcion === "string" ? x.descripcion : undefined,
      imagePath: str(x.imagePath, ""),
      imageUrl: str(x.imageUrl, ""),
      lado: str(x.lado, "cliente") || "cliente",
    };
  }
  return out;
}

function sharedLogos(): Partial<ReportFields> {
  try {
    const raw = localStorage.getItem(LOGOS_KEY);
    if (!raw) return {};
    const x = JSON.parse(raw) as Record<string, unknown>;
    return { logoIzq: loadLogo(x.logoIzq), logoDer: loadLogo(x.logoDer) };
  } catch {
    return {};
  }
}

function loadFields(tipo: FotoTipo): ReportFields {
  const base = freshFields(tipo);
  try {
    const raw = localStorage.getItem(keyOf(tipo));
    if (!raw) return base;

    const x = JSON.parse(raw) as Record<string, unknown>;
    return {
      titulo: base.titulo,
      proy: str(x.proy, ""),
      cliente: str(x.cliente, ""),
      sot: str(x.sot, ""),
      // Si la fecha guardada es la del día en que se guardó (no la cambió el
      // usuario), se usa la de hoy en vez de quedarse con un día anterior.
      fecha:
        x.fecha === x.savedOn ? base.fecha : str(x.fecha, base.fecha),
      cid: str(x.cid, ""),
      contrata: str(x.contrata, ""),
      logoIzq: loadLogo(x.logoIzq),
      logoDer: loadLogo(x.logoDer),
      rows: loadRows(x.rows),
      ...(isCustom(tipo) ? {} : sharedLogos()),
    };
  } catch {
    return base; // JSON dañado o localStorage no disponible
  }
}

interface Store {
  state: PhotoReportState;
  listeners: Set<() => void>;
  saveTimer?: number;
}

const stores = new Map<FotoTipo, Store>();

function storeOf(tipo: FotoTipo): Store {
  let st = stores.get(tipo);
  if (!st) {
    const fields = loadFields(tipo);
    // Si nunca se guardó nada por tipo, los logos vienen de la clave antigua de fibra.
    if (!isCustom(tipo) && !localStorage.getItem(LOGOS_KEY) && tipo !== "fibra") {
      const old = stores.get("fibra")?.state ?? loadFields("fibra");
      fields.logoIzq = old.logoIzq;
      fields.logoDer = old.logoDer;
    }
    st = { state: { ...fields, generating: false, result: null, error: null }, listeners: new Set() };
    stores.set(tipo, st);
  }
  return st;
}

function persist(tipo: FotoTipo): void {
  const { state } = storeOf(tipo);
  try {
    const fields: ReportFields = {
      titulo: state.titulo,
      proy: state.proy,
      cliente: state.cliente,
      sot: state.sot,
      fecha: state.fecha,
      cid: state.cid,
      contrata: state.contrata,
      logoIzq: state.logoIzq,
      logoDer: state.logoDer,
      rows: state.rows,
    };
    localStorage.setItem(keyOf(tipo), JSON.stringify({ ...fields, savedOn: todayPE() }));
    if (!isCustom(tipo)) {
      localStorage.setItem(LOGOS_KEY, JSON.stringify({ logoIzq: state.logoIzq, logoDer: state.logoDer }));
    }
  } catch {
    // sin espacio / modo privado: se sigue funcionando en memoria
  }
}

function scheduleSave(tipo: FotoTipo): void {
  const st = storeOf(tipo);
  window.clearTimeout(st.saveTimer);
  st.saveTimer = window.setTimeout(() => persist(tipo), 250);
}

function setState(tipo: FotoTipo, patch: Partial<PhotoReportState>): void {
  const st = storeOf(tipo);
  st.state = { ...st.state, ...patch };
  st.listeners.forEach((l) => l());
  scheduleSave(tipo);

  // Los logos se comparten: si cambian aquí, cambian en los demás tipos.
  if (!isCustom(tipo) && ("logoIzq" in patch || "logoDer" in patch)) {
    for (const [other, o] of stores) {
      if (other === tipo || isCustom(other)) continue;
      o.state = {
        ...o.state,
        ...("logoIzq" in patch ? { logoIzq: patch.logoIzq! } : {}),
        ...("logoDer" in patch ? { logoDer: patch.logoDer! } : {}),
      };
      o.listeners.forEach((l) => l());
      scheduleSave(other);
    }
  }
}

if (typeof window !== "undefined") {
  // Guarda lo pendiente si el usuario cierra o recarga la pestaña.
  window.addEventListener("pagehide", () => stores.forEach((_, t) => persist(t)));
}

export function usePhotoReport(tipo: FotoTipo): PhotoReportState {
  const st = storeOf(tipo);
  const subscribe = useCallback(
    (l: () => void) => {
      st.listeners.add(l);
      return () => {
        st.listeners.delete(l);
      };
    },
    [st]
  );
  return useSyncExternalStore(subscribe, () => st.state, () => st.state);
}

// ============================================================
// ACCIONES
// ============================================================

export function setField<K extends keyof ReportFields>(
  tipo: FotoTipo,
  key: K,
  value: ReportFields[K]
): void {
  setState(tipo, { [key]: value } as Partial<PhotoReportState>);
}

export function getRow(rows: Record<string, RowState>, id: string): RowState {
  return rows[id] ?? DEFAULT_ROW;
}

export function updateRow(tipo: FotoTipo, id: string, patch: Partial<RowState>): void {
  const { state } = storeOf(tipo);
  setState(tipo, {
    rows: { ...state.rows, [id]: { ...getRow(state.rows, id), ...patch } },
  });
}

export function setIncluir(tipo: FotoTipo, ids: string[], value: boolean): void {
  const rows = { ...storeOf(tipo).state.rows };
  for (const id of ids) {
    rows[id] = { ...getRow(rows, id), incluir: value };
  }
  setState(tipo, { rows });
}

/** Descarta el estado de ítems que ya no existen (se borraron en "Descripciones"). */
export function pruneRows(tipo: FotoTipo, validIds: string[]): void {
  const { state } = storeOf(tipo);
  const valid = new Set(validIds);
  const kept = Object.entries(state.rows).filter(([id]) => valid.has(id));
  if (kept.length === Object.keys(state.rows).length) return;
  setState(tipo, { rows: Object.fromEntries(kept) });
}

/** Empieza un reporte nuevo. Conserva los logos elegidos. */
export function resetReport(tipo: FotoTipo): void {
  const { state } = storeOf(tipo);
  setState(tipo, {
    ...freshFields(tipo),
    // Ventanas propias: vuelven a sus logos por defecto; las demás conservan los compartidos.
    ...(isCustom(tipo) ? {} : { logoIzq: state.logoIzq, logoDer: state.logoDer }),
    result: null,
    error: null,
  });
}

/** Estado que se guarda dentro del PDF para poder reabrirlo. */
function projectOf(tipo: FotoTipo) {
  const { state } = storeOf(tipo);
  const { titulo, proy, cliente, sot, fecha, cid, contrata, logoIzq, logoDer, rows } = state;
  return {
    kind: "photo",
    tipo,
    state: { titulo, proy, cliente, sot, fecha, cid, contrata, logoIzq, logoDer, rows },
  };
}

/** Carga en pantalla un reporte leído de un PDF (ver backend /photos/import-pdf). */
export function importReport(tipo: FotoTipo, saved: unknown): void {
  const x = (saved ?? {}) as Record<string, unknown>;
  setState(tipo, {
    titulo: DEFAULT_TITULO,
    proy: str(x.proy, ""),
    cliente: str(x.cliente, ""),
    sot: str(x.sot, ""),
    fecha: str(x.fecha, todayPE()),
    cid: str(x.cid, ""),
    contrata: str(x.contrata, ""),
    logoIzq: loadLogo(x.logoIzq),
    logoDer: loadLogo(x.logoDer),
    rows: loadRows(x.rows),
    result: null,
    error: null,
  });
}

// ============================================================
// UTILIDADES
// ============================================================

// Misma regla que backend/app/services/naming.py (vista previa; el nombre
// real lo decide el servidor y se muestra al terminar de generar).
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const SOT_PREFIX = /^\s*SOT\s*[-_:.#]*\s*/i;

function cleanPart(text: string): string {
  return text
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 100)
    .replace(/[ .]+$/, "");
}

/** RF_SOT-<sot>_<cliente>.pdf */
export function previewFilename(sot: string, cliente: string): string {
  const parts = ["RF"];

  const sotClean = cleanPart(sot.replace(SOT_PREFIX, ""));
  if (sotClean) parts.push(`SOT-${sotClean}`);

  const clienteClean = cleanPart(cliente);
  if (clienteClean) parts.push(clienteClean);

  return parts.length === 1 ? "RF_<fecha y hora>.pdf" : `${parts.join("_")}.pdf`;
}

// ============================================================
// GENERAR PDF
// ============================================================

/**
 * Genera el PDF con los ítems marcados, en el mismo orden en que se ven en
 * pantalla (`orderedItems`). La petición vive aquí (no en el componente),
 * así que seguir navegando mientras se genera no la cancela.
 */
export async function generatePdf(
  orderedItems: PhotoItem[],
  tipo: FotoTipo = "fibra",
  opciones: Opcion[] = DEFAULT_OPCIONES
): Promise<void> {
  const s = storeOf(tipo).state;
  if (s.generating) return;
  const selected = orderedItems.filter((it) => getRow(s.rows, it.id).incluir);

  if (selected.length === 0) {
    setState(tipo, { error: "Marca al menos un ítem." });
    return;
  }

  const items = selected.map((it, i) => {
    const r = getRow(s.rows, it.id);
    const op = resolveOpcion(r.lado, opciones);
    return {
      numero: i + 1,
      descripcion: r.descripcion ?? it.nombre,
      image_path: r.imagePath || null,
      lado: op.id,
      lado_label: op.label,
    };
  });

  setState(tipo, { generating: true, error: null, result: null });

  try {
    const { data } = await api.post("/photos/pdf", {
      tipo,
      project: projectOf(tipo),
      titulo: s.titulo,
      proy: s.proy,
      cliente: s.cliente,
      sot: s.sot,
      fecha: s.fecha,
      cid: s.cid,
      contrata: s.contrata,
      ...logoPayload(s.logoIzq, "logo_izq"),
      ...logoPayload(s.logoDer, "logo_der"),
      lados: opciones.map((o) => o.id),
      items,
    });

    setState(tipo, {
      generating: false,
      result: {
        url: data.url,
        filename: data.filename,
        pages: data.pages ?? 0,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      },
    });
  } catch (e) {
    setState(tipo, {
      generating: false,
      error: apiErrorMessage(e, "No se pudo generar el PDF."),
    });
  }
}

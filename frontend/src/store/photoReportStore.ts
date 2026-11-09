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
import { syncClient, toISODate } from "./clients";
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
    (label: string): string => {
      const text = label.trim();
      if (!text) return "";
      const found = cleanOpciones(raw).find((o) => o.label.toLowerCase() === text.toLowerCase());
      if (found) return found.id;
      const id = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      setRaw((prev) => {
        const list = cleanOpciones(prev);
        if (list.some((o) => o.label.toLowerCase() === text.toLowerCase())) return list;
        return [...list, { id, label: text }];
      });
      return id;
    },
    [raw, setRaw]
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
  /** Foto tal como se subió/tomó, antes de editarla (para la carpeta de evidencia). */
  originalPath?: string;
  originalUrl?: string;
}

/** Celda de una sección: descripción + foto (como en Poder Judicial). */
export interface Cell {
  id: string;
  descripcion: string;
  imagePath: string;
  imageUrl: string;
  originalPath?: string;
  originalUrl?: string;
  /** Foto tal como salió de la cámara (sin sello) y las líneas del sello: permiten moverlo después. */
  rawPath?: string;
  rawUrl?: string;
  stampLines?: string[];
  /** Va en el PDF (se marca sola al poner una foto). */
  incluir: boolean;
  /** Bloque dentro de la sección («EQUIPOS INSTALADOS ACCESO», «ETIQUETADO»…). Solo organiza la pantalla. */
  bloque?: string;
}

/** Sección = un título del reporte («INSTALACION EN SITE», «INSTALACION EN CLIENTE»…) con sus celdas. */
export interface Section {
  id: string;
  /** Id de la opción cuyo texto es el título. */
  lado: Lado;
  cells: Cell[];
}

/** Foto extra para la carpeta de evidencia (no va en el PDF). */
export interface ExtraPhoto {
  id: string;
  nombre: string;
  path: string;
  url: string;
  originalPath?: string;
  originalUrl?: string;
  rawPath?: string;
  rawUrl?: string;
  stampLines?: string[];
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
  /** Estado por ítem, indexado por el id del ítem (formato anterior; se convierte a `sections`). */
  rows: Record<string, RowState>;
  /** Secciones con sus celdas. null = todavía no se armó (se arma con las descripciones al abrir). */
  sections: Section[] | null;
  /** Número de versión que lleva el nombre del archivo (ISD-RECORRIDO-<SOT>-<CID>-<versión>). */
  version: string;
  extras: ExtraPhoto[];
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
    sections: null,
    version: "01",
    extras: [],
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
      originalPath: str(x.originalPath, ""),
      originalUrl: str(x.originalUrl, ""),
    };
  }
  return out;
}

function loadSections(v: unknown): Section[] | null {
  if (!Array.isArray(v)) return null;
  const out: Section[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const x = raw as Record<string, unknown>;
    const cells: Cell[] = [];
    if (Array.isArray(x.cells)) {
      for (const cr of x.cells) {
        if (!cr || typeof cr !== "object") continue;
        const c = cr as Record<string, unknown>;
        cells.push({
          id: str(c.id, uid()),
          descripcion: str(c.descripcion, ""),
          imagePath: str(c.imagePath, ""),
          imageUrl: str(c.imageUrl, ""),
          originalPath: str(c.originalPath, ""),
          originalUrl: str(c.originalUrl, ""),
      rawPath: str(c.rawPath, ""),
      rawUrl: str(c.rawUrl, ""),
      stampLines: Array.isArray(c.stampLines) ? c.stampLines.filter((l): l is string => typeof l === "string") : undefined,

          incluir: c.incluir === true,
          bloque: typeof c.bloque === "string" ? c.bloque : undefined,   // sin bloque = reporte del formato anterior (se actualiza solo)
        });
      }
    }
    out.push({ id: str(x.id, uid()), lado: str(x.lado, "cliente") || "cliente", cells });
  }
  return out;
}

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function loadExtras(v: unknown): ExtraPhoto[] {
  if (!Array.isArray(v)) return [];
  const out: ExtraPhoto[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const x = raw as Record<string, unknown>;
    const path = str(x.path, "");
    if (!path) continue;
    out.push({
      id: str(x.id, `e${out.length}`),
      nombre: str(x.nombre, ""),
      path,
      url: str(x.url, ""),
      originalPath: str(x.originalPath, ""),
      originalUrl: str(x.originalUrl, ""),
      rawPath: str(x.rawPath, ""),
      rawUrl: str(x.rawUrl, ""),
      stampLines: Array.isArray(x.stampLines) ? x.stampLines.filter((l): l is string => typeof l === "string") : undefined,
      lado: str(x.lado, "cliente") || "cliente",
    });
  }
  return out;
}

export function addExtra(tipo: FotoTipo, extra: ExtraPhoto): void {
  setState(tipo, { extras: [...storeOf(tipo).state.extras, extra] });
}
export function updateExtra(tipo: FotoTipo, id: string, patch: Partial<ExtraPhoto>): void {
  setState(tipo, { extras: storeOf(tipo).state.extras.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}
export function removeExtra(tipo: FotoTipo, id: string): void {
  setState(tipo, { extras: storeOf(tipo).state.extras.filter((e) => e.id !== id) });
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
      sections: loadSections(x.sections),
      version: str(x.version, "01") || "01",
      extras: loadExtras(x.extras),
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
      sections: state.sections,
      version: state.version,
      extras: state.extras,
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
  const { titulo, proy, cliente, sot, fecha, cid, contrata, logoIzq, logoDer, rows, sections, version, extras } = state;
  return {
    kind: "photo",
    tipo,
    state: { titulo, proy, cliente, sot, fecha, cid, contrata, logoIzq, logoDer, rows, sections, version, extras },
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
    sections: loadSections(x.sections),
    version: str(x.version, "01") || "01",
    extras: loadExtras(x.extras),
    result: null,
    error: null,
  });
}

// ============================================================
// SECCIONES Y CELDAS (estilo Poder Judicial)
// ============================================================

export const newCell = (descripcion = "", bloque = ""): Cell => ({ id: uid(), descripcion, imagePath: "", imageUrl: "", incluir: false, bloque });

export function setSections(tipo: FotoTipo, sections: Section[] | null): void {
  setState(tipo, { sections });
}

function mapSections(tipo: FotoTipo, fn: (list: Section[]) => Section[]): void {
  const cur = storeOf(tipo).state.sections;
  if (!cur) return;
  setState(tipo, { sections: fn(cur) });
}

export function patchSection(tipo: FotoTipo, sid: string, patch: Partial<Section>): void {
  mapSections(tipo, (l) => l.map((x) => (x.id === sid ? { ...x, ...patch } : x)));
}

export function patchCell(tipo: FotoTipo, sid: string, cid: string, patch: Partial<Cell>): void {
  mapSections(tipo, (l) => l.map((x) => (x.id === sid ? { ...x, cells: x.cells.map((c) => (c.id === cid ? { ...c, ...patch } : c)) } : x)));
}

/** Agrega una celda al final del bloque indicado (o de la sección, si no hay bloque). */
export function addCell(tipo: FotoTipo, sid: string, descripcion = "", bloque = ""): void {
  mapSections(tipo, (l) => l.map((x) => {
    if (x.id !== sid) return x;
    const cells = [...x.cells];
    let at = cells.length;
    for (let i = cells.length - 1; i >= 0; i--) if ((cells[i].bloque ?? "") === bloque) { at = i + 1; break; }
    cells.splice(at, 0, newCell(descripcion, bloque));
    return { ...x, cells };
  }));
}

export function renameBlock(tipo: FotoTipo, sid: string, from: string, to: string): void {
  mapSections(tipo, (l) => l.map((x) => (x.id === sid ? { ...x, cells: x.cells.map((c) => ((c.bloque ?? "") === from ? { ...c, bloque: to } : c)) } : x)));
}

export function removeBlock(tipo: FotoTipo, sid: string, bloque: string): void {
  mapSections(tipo, (l) => l.map((x) => (x.id === sid ? { ...x, cells: x.cells.filter((c) => (c.bloque ?? "") !== bloque) } : x)));
}

/** Mueve un bloque entero (con sus celdas) una posición arriba o abajo dentro de la sección. */
export function moveBlock(tipo: FotoTipo, sid: string, bloque: string, dir: -1 | 1): void {
  mapSections(tipo, (l) => l.map((x) => {
    if (x.id !== sid) return x;
    const names = blockNames(x.cells);
    const i = names.indexOf(bloque), j = i + dir;
    if (i < 0 || j < 0 || j >= names.length) return x;
    [names[i], names[j]] = [names[j], names[i]];
    return { ...x, cells: names.flatMap((n) => x.cells.filter((c) => (c.bloque ?? "") === n)) };
  }));
}

/** Nombres de bloque en el orden en que aparecen. */
export function blockNames(cells: Cell[]): string[] {
  return Array.from(new Set(cells.map((c) => c.bloque ?? "")));
}

export function removeCell(tipo: FotoTipo, sid: string, cid: string): void {
  mapSections(tipo, (l) => l.map((x) => (x.id === sid ? { ...x, cells: x.cells.filter((c) => c.id !== cid) } : x)));
}

export function moveCell(tipo: FotoTipo, sid: string, cid: string, dir: -1 | 1): void {
  mapSections(tipo, (l) => l.map((x) => {
    if (x.id !== sid) return x;
    const i = x.cells.findIndex((c) => c.id === cid), j = i + dir;
    if (i < 0 || j < 0 || j >= x.cells.length) return x;
    const cells = [...x.cells];
    [cells[i], cells[j]] = [cells[j], cells[i]];
    return { ...x, cells };
  }));
}

/** Sección nueva. Con `items` trae esas descripciones agrupadas en sus bloques; sin ellas queda vacía para armarla a mano. */
export function addSection(tipo: FotoTipo, lado: Lado, items: { nombre: string; categoria: string }[] = []): void {
  mapSections(tipo, (l) => [...l, { id: uid(), lado, cells: items.map((it) => newCell(it.nombre, it.categoria)) }]);
}

export function removeSection(tipo: FotoTipo, sid: string): void {
  mapSections(tipo, (l) => l.filter((x) => x.id !== sid));
}

export function moveSection(tipo: FotoTipo, sid: string, dir: -1 | 1): void {
  mapSections(tipo, (l) => {
    const i = l.findIndex((x) => x.id === sid), j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const out = [...l];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });
}

/** Bloques que van en SITE (acceso) en Fibra convencional; el resto va en CLIENTE. */
const BLOQUES_SITE = new Set([
  "EQUIPOS INSTALADOS ACCESO",
  "ETIQUETADO",
  "RECORRIDO EN ACCESO",
  "VISTA GENERAL UBICACION DE EQUIPOS",
]);

type CatalogItem = { id: string; nombre: string; categoria: string };

/**
 * Reporte nuevo: GPON → una sección CLIENTE con todos sus bloques; Fibra (y ventanas propias) → SITE arriba
 * (bloques de acceso) y CLIENTE abajo (el resto). Cada celda lleva la descripción de siempre y su bloque de siempre.
 */
export function buildSections(tipo: FotoTipo, ordered: CatalogItem[], rows: Record<string, RowState>, opciones: Opcion[]): Section[] {
  const has = (id: string) => opciones.some((o) => o.id === id);
  const cliente = has("cliente") ? "cliente" : opciones[0].id;
  const site = has("site") ? "site" : cliente;
  const cell = (it: CatalogItem): Cell => newCell(it.nombre, it.categoria);

  // Reporte anterior (formato por filas): se conserva lo que ya tenía foto o estaba marcado, en su lado.
  const used = ordered.filter((it) => { const r = rows[it.id]; return r && (r.incluir || r.imagePath); });
  if (used.length) {
    const out: Section[] = [];
    for (const op of opciones) {
      const cells = used.filter((it) => resolveOpcion(rows[it.id].lado, opciones).id === op.id).map((it): Cell => {
        const r = rows[it.id];
        return { id: uid(), descripcion: r.descripcion ?? it.nombre, imagePath: r.imagePath, imageUrl: r.imageUrl, originalPath: r.originalPath, originalUrl: r.originalUrl, incluir: r.incluir, bloque: it.categoria };
      });
      if (cells.length) out.push({ id: uid(), lado: op.id, cells });
    }
    if (out.length) return out;
  }

  if (isGpon(tipo)) return [{ id: uid(), lado: cliente, cells: ordered.map(cell) }];
  const top = ordered.filter((it) => BLOQUES_SITE.has(it.categoria));
  const rest = ordered.filter((it) => !BLOQUES_SITE.has(it.categoria));
  const out: Section[] = [];
  if (top.length) out.push({ id: uid(), lado: site, cells: top.map(cell) });
  out.push({ id: uid(), lado: cliente, cells: rest.map(cell) });
  return out;
}

/**
 * Pasa un reporte guardado con el primer formato de secciones (sin bloques) al de bloques:
 * se arma la estructura de siempre y se vuelve a poner cada foto y texto en su celda.
 */
export function upgradeSections(tipo: FotoTipo, old: Section[], ordered: CatalogItem[], opciones: Opcion[]): Section[] {
  const fresh = buildSections(tipo, ordered, {}, opciones);
  const keep = (c: Cell) => c.incluir || !!c.imagePath;
  const taken = new Set<string>();
  const out = fresh.map((sec) => {
    const src = old.find((o) => resolveOpcion(o.lado, opciones).id === resolveOpcion(sec.lado, opciones).id);
    const cells = sec.cells.map((c) => {
      const m = src?.cells.find((o) => !taken.has(o.id) && o.descripcion === c.descripcion && keep(o));
      if (!m) return c;
      taken.add(m.id);
      return { ...m, bloque: c.bloque };
    });
    return { ...sec, cells };
  });
  // Lo que tenía foto pero no coincide con ninguna descripción (o su lado no existe) no se pierde.
  for (const o of old) {
    const target = out.find((x) => resolveOpcion(x.lado, opciones).id === resolveOpcion(o.lado, opciones).id)
      ?? (out.push({ id: uid(), lado: o.lado, cells: [] }), out[out.length - 1]);
    for (const c of o.cells) if (!taken.has(c.id) && keep(c)) target.cells.push({ ...c, bloque: c.bloque ?? "OTROS" });
  }
  return out;
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

/** ISD-RECORRIDO-<SOT>-<CID>-<versión>.pdf (misma regla que backend/app/services/naming.py). */
export function previewFilename(sot: string, cid: string, version = "01"): string {
  const sotClean = cleanPart(sot.replace(SOT_PREFIX, ""));
  const cidClean = cleanPart(cid);
  let v = cleanPart(version) || "01";
  if (/^\d+$/.test(v)) v = v.padStart(2, "0");
  const parts = ["ISD", "RECORRIDO"];
  if (sotClean) parts.push(sotClean);
  if (cidClean) parts.push(cidClean);
  if (!sotClean && !cidClean) parts.push("<fecha y hora>");
  parts.push(v);
  return `${parts.join("-")}.pdf`;
}

// ============================================================
// GENERAR PDF
// ============================================================

/**
 * Genera el PDF con las celdas marcadas de cada sección, en el orden en que se ven en pantalla. La petición vive aquí (no en el componente),
 * así que seguir navegando mientras se genera no la cancela.
 */
export async function generatePdf(
  tipo: FotoTipo,
  opciones: Opcion[],
  tipoNombre: string = ""
): Promise<void> {
  const s = storeOf(tipo).state;
  if (s.generating) return;
  const sections = s.sections ?? [];
  const items: { numero: number; descripcion: string; image_path: string | null; lado: string; lado_label: string }[] = [];
  for (const sec of sections) {
    const op = resolveOpcion(sec.lado, opciones);
    for (const c of sec.cells) {
      if (!c.incluir) continue;
      items.push({ numero: items.length + 1, descripcion: c.descripcion, image_path: c.imagePath || null, lado: op.id, lado_label: op.label });
    }
  }

  if (items.length === 0) {
    setState(tipo, { error: "Marca al menos una celda (se marca sola al poner una foto)." });
    return;
  }

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
      version: s.version,
      ...logoPayload(s.logoIzq, "logo_izq"),
      ...logoPayload(s.logoDer, "logo_der"),
      lados: [...new Set(sections.map((x) => resolveOpcion(x.lado, opciones).id))],
      items,
    });

    // Queda registrado en el cliente de esta SOT (Datos de cliente)
    if (s.sot.trim()) {
      void syncClient({
        sot: s.sot, nombre: s.cliente, fecha: toISODate(s.fecha), cid: s.cid, proy: s.proy, contrata: s.contrata,
        reporte: { tipo: "fotografico", nombre: tipoNombre || FOTO_TIPOS[tipo] || tipo, filename: data.filename, url: data.url },
      }).catch(() => {});
    }

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

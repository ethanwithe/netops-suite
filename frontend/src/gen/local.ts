/**
 * Generación de PDF / Word / PowerPoint / ZIP dentro del equipo (sin servidor).
 *
 * Ejecuta los MISMOS archivos Python que el servidor (paquete /api/gen/bundle) con Pyodide en un worker, así el resultado
 * es idéntico (probado en CI: .github/workflows/gen-parity.yml). Las pantallas no cambian: las mismas peticiones
 * (/photos/pdf, /checklist/report-pdf, /diagrams/pdf...) se responden aquí cuando no hay conexión o cuando se
 * elige «generar siempre en este equipo».
 */
import axios from "axios";
import type { AxiosAdapter, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { metaGet, metaSet } from "../sync/db";
import { ensureLocalClient, getOutput, localWorkspacesOf, mirrorGet, saveOutput } from "../sync/engine";
import type { LocalReporte } from "../sync/engine";

type Kind = "photo_report" | "pj_report" | "checklist_pdf" | "checklist_docx" | "evidence_zip" | "package_zip" | "diagram_pdf" | "diagram_pptx";

// ------------------------------------------------------------------ preferencia y estado
const MODE_KEY = "netops.gen.mode";
export type GenMode = "auto" | "always";
export const getGenMode = (): GenMode => { try { return localStorage.getItem(MODE_KEY) === "always" ? "always" : "auto"; } catch { return "auto"; } };
export const setGenMode = (m: GenMode) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* sin almacenamiento */ } };

export interface GenState { ready: boolean; version: string; warming: boolean; error: string }
let genState: GenState = { ready: false, version: "", warming: false, error: "" };
const subs = new Set<() => void>();
const setGen = (p: Partial<GenState>) => { genState = { ...genState, ...p }; subs.forEach((f) => f()); };
export const getGenState = () => genState;
export const subscribeGen = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

// ------------------------------------------------------------------ paquete de generadores + archivos de Pyodide
interface Bundle { version: string; etag: string; data: ArrayBuffer }

async function loadBundle(): Promise<Bundle> {
  const stored = await metaGet<Bundle | null>("gen:bundle", null);
  try {
    const r = await fetch("/api/gen/bundle", { credentials: "include", headers: stored?.etag ? { "If-None-Match": stored.etag } : {} });
    if (r.status === 304 && stored) return stored;
    if (r.ok) {
      const etag = r.headers.get("ETag") || "";
      const b: Bundle = { version: etag.replace(/"/g, ""), etag, data: await r.arrayBuffer() };
      await metaSet("gen:bundle", b);
      return b;
    }
  } catch { /* sin conexión: se usa el guardado */ }
  if (stored) return stored;
  throw new Error("Los generadores todavía no se descargaron: abre la app una vez con Internet.");
}

/** Descarga (una vez, con Internet) todo lo necesario para generar sin conexión: queda en la caché del equipo. */
export async function warmGen(): Promise<void> {
  if (genState.warming || genState.ready) return;
  setGen({ warming: true, error: "" });
  try {
    const b = await loadBundle();
    const base = "/pyodide/";
    const manifest = await (await fetch(base + "manifest.json", { cache: "force-cache" })).json();
    const lock = await (await fetch(base + "pyodide-lock.json", { cache: "force-cache" })).json();
    const files = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip",
      ...manifest.packages.map((k: string) => lock.packages[k].file_name), ...manifest.wheels.map((w: string) => `wheels/${w}`)];
    for (const f of files) await fetch(base + f, { cache: "force-cache" }).then((r) => r.arrayBuffer());
    await metaSet("gen:warm", b.version);
    setGen({ ready: true, version: b.version, warming: false });
  } catch (e) {
    setGen({ warming: false, error: (e as Error).message || "No se pudieron preparar los generadores." });
  }
}
export async function initGenState(): Promise<void> {
  const v = await metaGet<string>("gen:warm", "");
  if (v) setGen({ ready: true, version: v });
}

// ------------------------------------------------------------------ worker
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok: (v: any) => void; ko: (e: Error) => void }>(); // eslint-disable-line @typescript-eslint/no-explicit-any
let initPromise: Promise<void> | null = null;
let initVersion = "";

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.ok(ev.data); else p.ko(new Error(ev.data.error || "Error al generar"));
    };
    worker.onerror = () => { for (const [, p] of pending) p.ko(new Error("El generador local se detuvo.")); pending.clear(); worker = null; initPromise = null; };
  }
  return worker;
}
function rpc(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = ++seq;
  return new Promise((ok, ko) => { pending.set(id, { ok, ko }); getWorker().postMessage({ id, ...msg }, transfer); });
}
async function ensureWorker(): Promise<void> {
  const b = await loadBundle();
  if (!initPromise || initVersion !== b.version) {
    initVersion = b.version;
    initPromise = rpc({ op: "init", version: b.version, bundle: b.data.slice(0) }).then(() => undefined);
  }
  await initPromise.catch((e) => { initPromise = null; throw e; });
}

// ------------------------------------------------------------------ archivos de entrada
const IMG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g|gif|webp)$/i;
function scan(o: unknown, names: Set<string>, logos: Set<string>, icons: Set<string>, key = ""): void {
  if (typeof o === "string") {
    const base = o.split("?")[0].split("/").pop() || "";
    if (IMG.test(base)) names.add(base);
    if (/^logo(_izq|_der)?_id$/.test(key) && o) logos.add(o);
    if (key === "icon" && o) icons.add(o);
  } else if (Array.isArray(o)) o.forEach((x) => scan(x, names, logos, icons, key));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) scan(v, names, logos, icons, k);
}
async function bytes(url: string): Promise<Uint8Array | null> {
  try { const r = await fetch(url, { credentials: "include" }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}
async function gather(req: unknown) {
  const names = new Set<string>(), logos = new Set<string>(), icons = new Set<string>();
  scan(req, names, logos, icons);
  const files = { uploads: {} as Record<string, Uint8Array>, logos: {} as Record<string, Uint8Array>, icons: {} as Record<string, Uint8Array> };
  await Promise.all([
    ...[...names].map(async (n) => { const b = await bytes(`/api/files/uploads/${encodeURIComponent(n)}`); if (b) files.uploads[n] = b; }),
    ...[...logos].map(async (id) => { const b = await bytes(`/api/logos/${encodeURIComponent(id)}/image`); if (b) files.logos[id] = b; }),
    ...[...icons].map(async (id) => { const b = await bytes(`/api/diagrams/icons/${encodeURIComponent(id)}/image`); if (b) files.icons[id] = b; }),
  ]);
  return files;
}

async function generate(kind: Kind, req: unknown, outputsIn: Record<string, Uint8Array> = {}) {
  await ensureWorker();
  const files = await gather(req);
  const transfer = [...Object.values(files.uploads), ...Object.values(files.logos), ...Object.values(files.icons), ...Object.values(outputsIn)].map((u) => u.buffer as ArrayBuffer);
  const r = await rpc({ op: "run", kind, req, files, outputs: outputsIn }, transfer);
  return r as { meta: Record<string, any>; outputs: Record<string, Uint8Array> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const MIME: Record<string, string> = { pdf: "application/pdf", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const mimeOf = (n: string) => MIME[n.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";

async function store(outputs: Record<string, Uint8Array>) {
  for (const [n, u] of Object.entries(outputs)) await saveOutput(n, new Blob([u as BlobPart], { type: mimeOf(n) }));
}

// ------------------------------------------------------------------ rutas
type Handler = (cfg: InternalAxiosRequestConfig, body: any, m: RegExpMatchArray) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
const outUrl = (name: string) => `/api/files/outputs/${encodeURIComponent(name)}`;

async function simple(kind: Kind, body: unknown) {
  const r = await generate(kind, body);
  await store(r.outputs);
  return { ...r.meta, url: outUrl(r.meta.filename) };
}

async function diagram(kind: "diagram_pdf" | "diagram_pptx", body: { doc: unknown; filename?: string }) {
  const r = await generate(kind, body);
  const ext = kind === "diagram_pdf" ? "pdf" : "pptx";
  const safe = String(body.filename || "diagrama").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "diagrama";
  const u = Object.values(r.outputs)[0];
  return { blob: new Blob([u as BlobPart], { type: mimeOf(ext) }), headers: { "content-disposition": `attachment; filename="${safe}.${ext}"` } };
}

async function packageZip(clientId: string) {
  const m = await mirrorGet("client", clientId);
  if (!m) throw new Error("Este cliente todavía no está en este equipo: ábrelo una vez con Internet.");
  const c = m.data;
  const reportes = (c.reportes ?? []) as LocalReporte[];
  const wss = await localWorkspacesOf(clientId, "foto:");
  const outputsIn: Record<string, Uint8Array> = {};
  for (const r of reportes) {
    if (!r.filename || r.tipo === "carpeta" || r.filename.toLowerCase().endsWith(".zip")) continue;
    const loc = await getOutput(r.filename);
    const b = loc ? new Uint8Array(await loc.arrayBuffer()) : await bytes(outUrl(r.filename));
    if (b) outputsIn[r.filename] = b;
  }
  const version = reportes.filter((r) => r.tipo === "carpeta").length + 1;
  const req = { client: { sot: c.sot, nombre: c.nombre, cid: c.cid, fecha: c.fecha, proy: c.proy, contrata: c.contrata, datos: c.datos ?? {} }, reportes, workspaces: wss, version };
  const r = await generate("package_zip", req, outputsIn);
  const zipName = r.meta.filename as string;
  await saveOutput(zipName, new Blob([r.outputs[zipName] as BlobPart], { type: "application/zip" }));
  const now = new Date();
  await ensureLocalClient({ sot: c.sot, reporte: { tipo: "carpeta", nombre: `Carpeta v${version}`, filename: zipName, url: outUrl(zipName), utc: now.toISOString().slice(0, 19), generado: now.toISOString().slice(0, 16).replace("T", " ") } });
  return { version, filename: zipName, url: outUrl(zipName), counts: r.meta.counts };
}

const ROUTES: { re: RegExp; run: Handler }[] = [
  { re: /^\/photos\/pdf$/, run: async (_c, b) => simple("photo_report", b) },
  { re: /^\/photos\/pdf-pj$/, run: async (_c, b) => simple("pj_report", b) },
  { re: /^\/checklist\/report-pdf$/, run: async (_c, b) => simple("checklist_pdf", b) },
  { re: /^\/checklist\/report-docx$/, run: async (_c, b) => simple("checklist_docx", b) },
  { re: /^\/photos\/evidence-zip$/, run: async (_c, b) => simple("evidence_zip", b) },
  { re: /^\/diagrams\/pdf$/, run: async (_c, b) => diagram("diagram_pdf", b) },
  { re: /^\/diagrams\/pptx$/, run: async (_c, b) => diagram("diagram_pptx", b) },
  { re: /^\/clients\/([^/]+)\/package$/, run: async (_c, _b, m) => packageZip(decodeURIComponent(m[1])) },
];

/** Registro de un reporte generado en el cliente (lo que hace /clients/sync en el servidor) sin conexión. */
const OFFLINE_ONLY: { re: RegExp; run: Handler }[] = [
  { re: /^\/clients\/sync$/, run: async (_c, b) => {
    const rep = b.reporte ? { ...b.reporte, generado: new Date().toISOString().slice(0, 16).replace("T", " ") } : undefined;
    const id = await ensureLocalClient({ sot: String(b.sot || ""), nombre: b.nombre, fecha: b.fecha, cid: b.cid, proy: b.proy, contrata: b.contrata, datos: b.datos, reporte: rep });
    return { id, sot: b.sot, nombre: b.nombre ?? "", fecha: b.fecha ?? "", cid: b.cid ?? "", proy: b.proy ?? "", contrata: b.contrata ?? "", datos: b.datos ?? {}, reportes: rep ? [rep] : [], mine: true };
  } },
  { re: /^\/clients\/attach-file$/, run: async (cfg) => {
    const f = cfg.data as FormData;
    const file = f.get("file") as File, sot = String(f.get("sot") || ""), filename = String(f.get("filename") || file?.name || "archivo");
    const safe = filename.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
    await saveOutput(safe, file);
    await ensureLocalClient({ sot, reporte: { tipo: String(f.get("tipo") || "grafica"), nombre: String(f.get("nombre") || safe), filename: safe, url: outUrl(safe), generado: new Date().toISOString().slice(0, 16).replace("T", " ") } });
    return { filename: safe, url: outUrl(safe) };
  } },
];

function parse(cfg: InternalAxiosRequestConfig): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof cfg.data === "string") { try { return JSON.parse(cfg.data); } catch { return {}; } }
  return cfg.data ?? {};
}

function wrap(cfg: InternalAxiosRequestConfig, out: any): AxiosResponse { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (out && out.blob instanceof Blob) return { data: out.blob, status: 200, statusText: "OK (local)", headers: out.headers, config: cfg, request: null };
  return { data: out, status: 200, statusText: "OK (local)", headers: {}, config: cfg, request: null };
}

export function installLocalGen(api: AxiosInstance): void {
  const base: AxiosAdapter = axios.getAdapter(api.defaults.adapter ?? axios.defaults.adapter) as AxiosAdapter;
  api.interceptors.request.use((cfg) => {
    if ((cfg.method || "get").toLowerCase() !== "post") return cfg;
    const url = cfg.url || "";
    const gen = ROUTES.map((r) => ({ r, m: url.match(r.re) })).find((x) => x.m);
    const off = OFFLINE_ONLY.map((r) => ({ r, m: url.match(r.re) })).find((x) => x.m);
    if (!gen && !off) return cfg;
    cfg.adapter = async (c: InternalAxiosRequestConfig) => {
      const offline = navigator.onLine === false || (gen && getGenMode() === "always");
      if (!offline) {
        try { return await base(c); } catch (e) { if ((e as { response?: unknown })?.response) throw e; /* sin red: se resuelve aquí */ }
      }
      const hit = gen ?? off!;
      try { return wrap(c, await hit.r.run(c, parse(c), hit.m!)); }
      catch (e) {
        const msg = (e as Error).message || "No se pudo generar sin conexión.";
        throw Object.assign(new Error(msg), { response: { status: 500, data: { detail: msg }, headers: {}, config: c, statusText: "" }, isAxiosError: true, config: c });
      }
    };
    return cfg;
  });
}

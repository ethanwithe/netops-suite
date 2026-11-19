/**
 * Módulo central de sincronización (offline-first).
 *
 *  - Todo cambio se guarda PRIMERO en este equipo (cola persistente en IndexedDB) y luego se sube.
 *  - Estados: LOCAL · PENDING_SYNC · SYNCING · SYNCED · SYNC_ERROR · CONFLICT.
 *  - Reintentos con espera creciente, idempotencia por op_id, sin duplicados.
 *  - Nada se borra del equipo hasta que el servidor confirma (applied).
 *  - Si otro dispositivo cambió lo mismo, queda en CONFLICT y el usuario decide (nunca se pisa en silencio).
 *  - Fotos: se guardan en el equipo, se suben (comprimidas) con huella de verificación y solo entonces se liberan.
 */
import { useSyncExternalStore } from "react";
import { api } from "../api/client";
import { compressForUpload } from "../utils/imageCompress";
import { dbAll, dbDel, dbGet, dbPut, metaGet, metaSet } from "./db";

export type SyncState = "LOCAL" | "PENDING_SYNC" | "SYNCING" | "SYNCED" | "SYNC_ERROR" | "CONFLICT";
export type Entity = "client" | "workspace" | "checklist_copy";

export interface QueuedOp {
  op_id: string;
  entity: Entity;
  entity_id: string;
  action: "upsert" | "delete";
  base_version: number | null;
  data: Record<string, unknown>;
  force?: boolean;
  state: SyncState;
  tries: number;
  next_at: number;
  error?: string;
  reason?: string;
  server?: ServerItem;
  label: string;
  created_at: number;
  user_id?: string;
}

export interface ServerItem { entity: Entity; id: string; version: number; updated_at: string; deleted: boolean; data: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface QueuedPhoto {
  photo_id: string;
  name: string;
  blob: Blob;
  sha256: string;
  size: number;
  state: SyncState;
  tries: number;
  next_at: number;
  error?: string;
  created_at: number;
  user_id?: string;
}

export interface SyncStatus {
  online: boolean;
  running: boolean;
  pendingOps: number;
  pendingPhotos: number;
  errors: number;
  conflicts: QueuedOp[];
  lastSync: string;
  lastError: string;
  needsLogin: boolean;
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
const DEVICE_KEY = "netops.device.v1";
export function deviceId(): string {
  try { let d = localStorage.getItem(DEVICE_KEY); if (!d) { d = uuid(); localStorage.setItem(DEVICE_KEY, d); } return d; } catch { return "device"; }
}

// ------------------------------------------------------------------ estado observable
let status: SyncStatus = { online: typeof navigator === "undefined" ? true : navigator.onLine, running: false, pendingOps: 0, pendingPhotos: 0, errors: 0, conflicts: [], lastSync: "", lastError: "", needsLogin: false };
const subs = new Set<() => void>();
function setStatus(p: Partial<SyncStatus>) { status = { ...status, ...p }; subs.forEach((f) => f()); }
export const getSyncStatus = () => status;
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getSyncStatus, getSyncStatus);
}
async function refreshCounts() {
  try {
    const ops = (await dbAll<QueuedOp>("ops")).filter(mine);
    const photos = (await dbAll<QueuedPhoto>("photos")).filter(mine);
    setStatus({
      pendingOps: ops.filter((o) => o.state !== "CONFLICT").length,
      pendingPhotos: photos.length,
      errors: ops.filter((o) => o.state === "SYNC_ERROR").length + photos.filter((p) => p.state === "SYNC_ERROR").length,
      conflicts: ops.filter((o) => o.state === "CONFLICT"),
    });
  } catch { /* sin almacenamiento */ }
}

// Cada usuario solo sube lo suyo: si en el mismo equipo entra otra persona, lo pendiente de la anterior se conserva sin tocarse.
let me = "";
const mine = <T extends { user_id?: string }>(x: T) => !x.user_id || x.user_id === me;

// ------------------------------------------------------------------ copia local de lo del servidor
const mk = (entity: Entity, id: string) => `${entity}:${id}`;
export async function mirrorPut(it: ServerItem) { await dbPut("mirror", { k: mk(it.entity, it.id), ...it }); }
export async function mirrorGet(entity: Entity, id: string): Promise<ServerItem | undefined> { return dbGet<ServerItem>("mirror", mk(entity, id)); }
export async function mirrorList(entity: Entity): Promise<ServerItem[]> {
  return (await dbAll<ServerItem & { k: string }>("mirror")).filter((x) => x.entity === entity && !x.deleted);
}
export const wsEntityId = (clientId: string, key: string) => `${clientId}|${key}`;

/** Lo más reciente que hay en este equipo de algo: la operación pendiente (si la hay) o lo descargado. */
export async function localLatest(entity: Entity, id: string): Promise<{ data: Record<string, any>; pending: boolean; version: number } | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ops = (await dbAll<QueuedOp>("ops")).filter((o) => o.entity === entity && o.entity_id === id && o.action === "upsert").sort((a, b) => b.created_at - a.created_at);
  if (ops[0]) return { data: ops[0].data, pending: true, version: ops[0].base_version ?? 0 };
  const m = await mirrorGet(entity, id);
  return m && !m.deleted ? { data: m.data, pending: false, version: m.version } : null;
}

// ------------------------------------------------------------------ cola
function backoff(tries: number): number { return Math.min(10 * 60_000, 2_000 * 2 ** Math.min(tries, 9)); }

let kick: number | undefined;
function scheduleKick(ms = 800) { window.clearTimeout(kick); kick = window.setTimeout(() => { void syncNow(); }, ms); }

/** Guarda la operación en este equipo (si ya había una pendiente de lo mismo se reemplaza por la más nueva). */
export async function enqueueOp(o: { entity: Entity; entity_id: string; action?: "upsert" | "delete"; data?: Record<string, unknown>; label?: string; base_version?: number | null }): Promise<QueuedOp> {
  const all = (await dbAll<QueuedOp>("ops")).filter(mine);
  const same = all.filter((x) => x.entity === o.entity && x.entity_id === o.entity_id);
  const m = await mirrorGet(o.entity, o.entity_id);
  const pend = same.find((x) => x.state === "PENDING_SYNC" || x.state === "SYNC_ERROR");
  const blocked = same.find((x) => x.state === "CONFLICT");
  const op: QueuedOp = {
    op_id: uuid(), entity: o.entity, entity_id: o.entity_id, action: o.action ?? "upsert",
    base_version: o.base_version !== undefined ? o.base_version : (pend ? pend.base_version : blocked ? blocked.base_version : (m ? m.version : null)),
    data: o.data ?? {}, state: "PENDING_SYNC", tries: 0, next_at: 0, label: o.label ?? o.entity, created_at: Date.now(), user_id: me,
  };
  if (pend) await dbDel("ops", pend.op_id);                       // la más nueva reemplaza a la anterior que aún no salió
  if (blocked) { op.state = "CONFLICT"; op.server = blocked.server; op.reason = blocked.reason; await dbDel("ops", blocked.op_id); } // sigue esperando tu decisión, con lo último que editaste
  await dbPut("ops", op);
  await refreshCounts();
  if (op.state !== "CONFLICT") scheduleKick();
  return op;
}

export async function listOps(): Promise<QueuedOp[]> { return (await dbAll<QueuedOp>("ops")).filter(mine).sort((a, b) => a.created_at - b.created_at); }

/** Estado de sincronización de un registro concreto (para mostrarlo en pantalla). */
export async function recordState(entity: Entity, id: string): Promise<SyncState> {
  const op = (await dbAll<QueuedOp>("ops")).filter(mine).find((x) => x.entity === entity && x.entity_id === id);
  if (op) return op.state;
  return (await mirrorGet(entity, id)) ? "SYNCED" : "LOCAL";
}

const isNetErr = (e: unknown) => !(e as { response?: unknown })?.response;
const httpStatus = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

let running = false;
export async function syncNow(manual = false): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { setStatus({ online: false }); return; }
  running = true;
  setStatus({ running: true });
  try {
    if (manual) await resetErrors();
    await pushPhotos();
    await pushOps();
    await pullAll();
    setStatus({ online: true, lastError: "", needsLogin: false, lastSync: new Date().toISOString() });
    await metaSet("lastSync", status.lastSync);
  } catch (e) {
    if (httpStatus(e) === 401) setStatus({ needsLogin: true, lastError: "Tu sesión venció: vuelve a iniciar sesión para sincronizar." });
    else if (isNetErr(e)) setStatus({ online: false });
    else setStatus({ lastError: errText(e) });
  } finally {
    running = false;
    setStatus({ running: false });
    await refreshCounts();
  }
}

function errText(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" ? d : (e as Error)?.message || "Error de sincronización";
}

async function resetErrors() {
  for (const o of await dbAll<QueuedOp>("ops")) if (o.state === "SYNC_ERROR") await dbPut("ops", { ...o, state: "PENDING_SYNC", tries: 0, next_at: 0 });
  for (const p of await dbAll<QueuedPhoto>("photos")) if (p.state === "SYNC_ERROR") await dbPut("photos", { ...p, state: "PENDING_SYNC", tries: 0, next_at: 0 });
}

async function pushOps() {
  for (;;) {
    const now = Date.now();
    const all = (await listOps());
    const stuck = new Set(all.filter((o) => o.state === "CONFLICT" || (o.state === "SYNC_ERROR" && o.tries >= 8)).map((o) => `${o.entity}:${o.entity_id}`));
    // un cliente nuevo debe llegar antes que sus ventanas (el orden de creación se respeta)
    const due = all.filter((o) => (o.state === "PENDING_SYNC" || o.state === "SYNC_ERROR") && o.next_at <= now && !stuck.has(`${o.entity}:${o.entity_id}`)).slice(0, 40);
    if (!due.length) return;
    for (const o of due) await dbPut("ops", { ...o, state: "SYNCING" });
    await refreshCounts();
    let results: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const { data } = await api.post("/sync/push", {
        device_id: deviceId(),
        ops: due.map((o) => ({ op_id: o.op_id, entity: o.entity, entity_id: o.entity_id, action: o.action, base_version: o.base_version, data: o.data, force: !!o.force })),
      });
      results = data.results;
    } catch (e) {
      for (const o of due) await dbPut("ops", { ...o, state: "PENDING_SYNC" });   // nada se pierde: vuelve a la cola
      throw e;
    }
    for (const o of due) {
      const r = results.find((x) => x.op_id === o.op_id);
      if (!r) { await dbPut("ops", { ...o, state: "PENDING_SYNC" }); continue; }
      if (r.status === "applied") {
        await dbDel("ops", o.op_id);                                              // confirmado por el servidor: se libera
        await afterApplied(o, r.version);
      } else if (r.status === "conflict") {
        await dbPut("ops", { ...o, state: "CONFLICT", server: r.server, reason: r.reason, error: undefined });
      } else if (r.status === "rejected") {
        await dbPut("ops", { ...o, state: "SYNC_ERROR", tries: 99, error: r.error || "El servidor rechazó el cambio." });
      } else {
        const tries = o.tries + 1;
        await dbPut("ops", { ...o, state: "SYNC_ERROR", tries, next_at: Date.now() + backoff(tries), error: r.error || "Error del servidor" });
      }
    }
    await refreshCounts();
  }
}

/** Tras confirmar: lo siguiente que se edite de lo mismo parte de la versión nueva. */
async function afterApplied(o: QueuedOp, version: number) {
  if (o.action === "delete") { await dbDel("mirror", mk(o.entity, o.entity_id)); return; }
  await mirrorPut({ entity: o.entity, id: o.entity_id, version, updated_at: new Date().toISOString(), deleted: false, data: o.data as Record<string, any> }); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const x of await dbAll<QueuedOp>("ops")) if (x.entity === o.entity && x.entity_id === o.entity_id && x.state !== "CONFLICT") await dbPut("ops", { ...x, base_version: version });
}

/** Resolución de un conflicto: «mine» = se aplica lo de este equipo encima; «theirs» = se adopta lo del servidor. */
export async function resolveConflict(op_id: string, resolution: "mine" | "theirs"): Promise<void> {
  const o = await dbGet<QueuedOp>("ops", op_id);
  if (!o) return;
  if (resolution === "theirs") {
    try { await api.post("/sync/resolve", { op: opBody(o), resolution }); } catch { /* si no hay red igual se adopta localmente */ }
    if (o.server) await mirrorPut(o.server);
    await dbDel("ops", op_id);
    window.dispatchEvent(new CustomEvent("netops:sync-pulled"));
  } else {
    await dbPut("ops", { ...o, state: "PENDING_SYNC", force: true, base_version: o.server?.version ?? o.base_version, tries: 0, next_at: 0, error: undefined });
    scheduleKick(100);
  }
  await refreshCounts();
}
const opBody = (o: QueuedOp) => ({ op_id: o.op_id, entity: o.entity, entity_id: o.entity_id, action: o.action, base_version: o.base_version, data: o.data, force: !!o.force });

// ------------------------------------------------------------------ descarga
async function pullAll() {
  for (const entity of ["client", "workspace", "checklist_copy"] as Entity[]) {
    const since = await metaGet<string>(`since:${entity}`, "");
    let cursor = "";
    let startedAt = "";
    let got = 0;
    for (let page = 0; page < 500; page++) {
      const { data } = await api.get("/sync/pull", { params: { entity, since, cursor, limit: 100 } });
      if (!startedAt) startedAt = data.server_time;
      for (const it of data.items as ServerItem[]) {
        // si hay un cambio propio pendiente de lo mismo, la copia local de «servidor» solo se actualiza (la operación decide al subir)
        await mirrorPut(it); got++;
      }
      if (!data.next_cursor) break;
      cursor = data.next_cursor;
    }
    if (startedAt) await metaSet(`since:${entity}`, new Date(new Date(startedAt).getTime() - 2000).toISOString());   // 2 s de margen por relojes
    if (got) window.dispatchEvent(new CustomEvent("netops:sync-pulled", { detail: { entity, got } }));
  }
}

// ------------------------------------------------------------------ fotos
async function sha256(b: Blob): Promise<string> {
  try {
    const d = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch { return ""; }
}
const extOf = (n: string, t: string) => { const m = /\.(png|jpe?g|gif|webp)$/i.exec(n); return (m ? m[0] : t.includes("png") ? ".png" : ".jpg").toLowerCase(); };

export interface UploadedPhoto { path: string; url: string; pending: boolean }

/**
 * Sube una foto. Con conexión sube ya; sin conexión la guarda en este equipo y devuelve de todos modos
 * la ruta definitiva (se deriva del id de la foto), así el resto de la app (PDF, reportes) funciona igual;
 * la foto se sirve desde el equipo hasta que se suba (ver public/sw.js).
 */
export async function uploadPhoto(file: Blob | File, name = "foto.jpg"): Promise<UploadedPhoto> {
  const small = file instanceof File ? await compressForUpload(file) : file;
  const photo_id = uuid();
  const path = `${photo_id}${extOf(name, small.type)}`;
  const url = `/api/files/uploads/${path}`;
  const q: QueuedPhoto = { user_id: me, photo_id, name: path, blob: small, sha256: await sha256(small), size: small.size, state: "PENDING_SYNC", tries: 0, next_at: 0, created_at: Date.now() };
  await dbPut("photos", q);                       // primero en el equipo: no se pierde aunque se cierre la app
  await refreshCounts();
  if (navigator.onLine !== false) {
    try { await sendPhoto(q); return { path, url, pending: false }; } catch (e) { if (!isNetErr(e) && httpStatus(e) !== 401) { /* queda en cola con su error */ } }
  }
  scheduleKick(3000);
  return { path, url, pending: true };
}

async function sendPhoto(q: QueuedPhoto) {
  const form = new FormData();
  form.append("file", q.blob, q.name);
  form.append("photo_id", q.photo_id);
  form.append("sha256", q.sha256);
  const { data } = await api.post("/sync/photos", form, { headers: { "Content-Type": "multipart/form-data" } });
  if (q.sha256 && data.sha256 !== q.sha256) throw new Error("La foto no llegó completa.");   // verificada: solo entonces se libera
  await dbDel("photos", q.photo_id);
  await refreshCounts();
}

async function pushPhotos() {
  const now = Date.now();
  for (const q of (await dbAll<QueuedPhoto>("photos")).filter(mine).sort((a, b) => a.created_at - b.created_at)) {
    if (q.next_at > now || q.tries >= 8) continue;
    try { await sendPhoto(q); } catch (e) {
      if (isNetErr(e) || httpStatus(e) === 401) throw e;
      const tries = q.tries + 1;
      await dbPut("photos", { ...q, state: "SYNC_ERROR", tries, next_at: Date.now() + backoff(tries), error: errText(e) });
    }
  }
}

/** Foto pendiente guardada en este equipo (la usa el service worker para mostrarla sin Internet). */
export async function pendingPhoto(name: string): Promise<Blob | null> {
  const id = name.replace(/\.[^.]+$/, "");
  const q = await dbGet<QueuedPhoto>("photos", id);
  return q ? q.blob : null;
}

// ------------------------------------------------------------------ clientes creados sin conexión
export async function ensureLocalClient(c: { sot: string; nombre?: string; fecha?: string; cid?: string; proy?: string; contrata?: string; datos?: Record<string, string> }): Promise<string> {
  const sot = c.sot.replace(/^\s*SOT\s*[-_:.#]*\s*/i, "").trim();
  const known = (await mirrorList("client")).find((x) => x.data.sot === sot);
  const ops = (await dbAll<QueuedOp>("ops")).filter((o) => o.entity === "client" && o.data.sot === sot);
  const id = known?.id ?? ops[0]?.entity_id ?? uuid();
  const prev = (await localLatest("client", id))?.data ?? {};
  const datos = { ...(prev.datos ?? {}), ...(c.datos ?? {}) };
  const pick = (k: "nombre" | "fecha" | "cid" | "proy" | "contrata") => (c[k] || prev[k] || "") as string;
  await enqueueOp({ entity: "client", entity_id: id, label: `Cliente SOT ${sot}`,
    data: { sot, nombre: pick("nombre"), fecha: pick("fecha"), cid: pick("cid"), proy: pick("proy"), contrata: pick("contrata"), datos } });
  return id;
}

/** Guarda una ventana en este equipo y la deja en cola para subirla (sin Internet). */
export async function queueWorkspace(o: { sot: string; key: string; label: string; route: string; state: unknown; nombre?: string; fecha?: string; datos?: Record<string, string> }): Promise<void> {
  const clientId = await ensureLocalClient({ sot: o.sot, nombre: o.nombre, fecha: o.fecha, datos: o.datos });
  await enqueueOp({ entity: "workspace", entity_id: wsEntityId(clientId, o.key), label: `${o.label} · SOT ${o.sot}`,
    data: { client_id: clientId, key: o.key, label: o.label, route: o.route, state: o.state as Record<string, unknown> } });
}

/** Ventana guardada en este equipo (pendiente o descargada) para una SOT, para abrirla sin conexión. */
export async function localWorkspace(sot: string, key: string): Promise<{ state: unknown; label: string; route: string; at: string; pending: boolean } | null> {
  const n = sot.replace(/^\s*SOT\s*[-_:.#]*\s*/i, "").trim();
  const ids = new Set<string>();
  for (const m of await mirrorList("client")) if (m.data.sot === n) ids.add(m.id);
  for (const o of await dbAll<QueuedOp>("ops")) if (o.entity === "client" && o.data.sot === n) ids.add(o.entity_id);
  for (const id of ids) {
    const w = await localLatest("workspace", wsEntityId(id, key));
    if (w) return { state: w.data.state, label: String(w.data.label ?? ""), route: String(w.data.route ?? ""), at: "", pending: w.pending };
  }
  return null;
}

/** Clientes disponibles sin conexión (descargados + creados aquí). */
export async function localClients(): Promise<Record<string, any>[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const m of await mirrorList("client")) byId.set(m.id, { id: m.id, ...m.data, updated_at: m.updated_at });
  for (const o of await dbAll<QueuedOp>("ops")) if (o.entity === "client" && o.action === "upsert") byId.set(o.entity_id, { id: o.entity_id, ...o.data });
  return [...byId.values()];
}

// ------------------------------------------------------------------ arranque
let started = false;
let timer: number | undefined;
export function startSync(userId: string): () => void {
  if (started) return () => undefined;
  started = true;
  me = userId;
  void (async () => {
    // otra persona en el mismo equipo: lo descargado de la anterior se descarta (lo pendiente de ella se conserva)
    if ((await metaGet<string>("owner", "")) !== userId) {
      for (const m of await dbAll<{ k: string }>("mirror")) await dbDel("mirror", m.k);
      for (const e of ["client", "workspace", "checklist_copy"]) await metaSet(`since:${e}`, "");
      await metaSet("owner", userId);
    }
    void syncNow();
  })();
  void metaGet<string>("lastSync", "").then((s) => { if (s) setStatus({ lastSync: s }); });
  void refreshCounts();
  const on = () => { setStatus({ online: true }); void syncNow(); };
  const off = () => setStatus({ online: false });
  const vis = () => { if (!document.hidden) void syncNow(); };
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  document.addEventListener("visibilitychange", vis);
  timer = window.setInterval(() => { void syncNow(); }, 45_000);
  return () => {
    started = false; me = "";
    window.removeEventListener("online", on); window.removeEventListener("offline", off);
    document.removeEventListener("visibilitychange", vis);
    window.clearInterval(timer);
  };
}

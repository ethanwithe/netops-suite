/**
 * Almacenamiento local de la sincronización (IndexedDB): cola de operaciones, fotos pendientes,
 * copia local de lo descargado del servidor y datos de control. Es el mismo código en el navegador,
 * en Windows (Tauri/WebView2) y en Android (Capacitor/WebView): cada instalación tiene su propia base.
 */
const NAME = "netops-sync";
const VERSION = 2;
export type StoreName = "ops" | "photos" | "mirror" | "meta" | "outputs";
const KEYS: Record<StoreName, string> = { ops: "op_id", photos: "photo_id", mirror: "k", meta: "k", outputs: "name" };

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(NAME, VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      (Object.keys(KEYS) as StoreName[]).forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: KEYS[s] }); });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbp = null; rej(rq.error); };
  });
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const rq = fn(db.transaction(store, mode).objectStore(store));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
}

export const dbPut = <T>(store: StoreName, v: T) => tx(store, "readwrite", (s) => s.put(v)).then(() => undefined);
export const dbGet = <T>(store: StoreName, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key));
export const dbDel = (store: StoreName, key: string) => tx(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
export const dbAll = <T>(store: StoreName) => tx<T[]>(store, "readonly", (s) => s.getAll());

export const metaGet = async <T>(k: string, def: T): Promise<T> => {
  try { const r = await dbGet<{ k: string; v: T }>("meta", k); return r ? r.v : def; } catch { return def; }
};
export const metaSet = (k: string, v: unknown) => dbPut("meta", { k, v }).catch(() => undefined);

/**
 * Copia temporal local (IndexedDB) de lo que hay en pantalla en cada ventana por SOT.
 * Se escribe mientras hay cambios sin guardar y se borra cuando el servidor confirma el guardado.
 * Sin Internet (o si el navegador se cierra) nada se pierde: se sube sola al volver la conexión.
 */
export interface Draft {
  id: string; // `${sot}|${key}`
  sot: string;
  key: string;
  label: string;
  route: string;
  nombre: string;
  fecha: string;
  state: unknown;
  at: number;
  /** Debe subirse sola al servidor (guardado automático encendido o un guardado que falló). */
  queued: boolean;
}

const DB = "netops-drafts";
const STORE = "drafts";
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE, { keyPath: "id" }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => new Promise<T | null>((res) => {
    if (!db) { res(null); return; }
    try {
      const rq = fn(db.transaction(STORE, mode).objectStore(STORE));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch { res(null); }
  }));
}

export const draftId = (sot: string, key: string) => `${sot}|${key}`;
export const putDraft = (d: Draft) => run("readwrite", (s) => s.put(d)).then((r) => r !== null);
export const getDraft = (sot: string, key: string) => run<Draft | undefined>("readonly", (s) => s.get(draftId(sot, key))).then((r) => r ?? null);
export const delDraft = (sot: string, key: string) => run("readwrite", (s) => s.delete(draftId(sot, key)));
export const allDrafts = () => run<Draft[]>("readonly", (s) => s.getAll()).then((r) => r ?? []);

import { useCallback, useRef, useState } from "react";

/** Historial deshacer/rehacer sobre un valor que vive fuera (el documento del diagrama). */
export function useUndo<T>(value: T, set: (v: T) => void, limit = 100) {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const cur = useRef(value); cur.current = value;
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  /** Guarda el estado actual como punto de regreso (se llama una vez al empezar un cambio). */
  const begin = useCallback(() => {
    past.current.push(cur.current);
    if (past.current.length > limit) past.current.shift();
    future.current = [];
    refresh();
  }, [limit]);
  /** Cambia el valor sin crear un punto de regreso (arrastres en curso). */
  const live = useCallback((v: T) => { cur.current = v; set(v); }, [set]);
  const commit = useCallback((v: T) => { begin(); live(v); }, [begin, live]);
  const undo = useCallback(() => {
    const p = past.current.pop();
    if (p === undefined) return;
    future.current.push(cur.current);
    live(p); refresh();
  }, [live]);
  const redo = useCallback(() => {
    const f = future.current.pop();
    if (f === undefined) return;
    past.current.push(cur.current);
    live(f); refresh();
  }, [live]);
  const clear = useCallback(() => { past.current = []; future.current = []; refresh(); }, []);
  return { begin, live, commit, undo, redo, clear, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

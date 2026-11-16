/** Diálogo de confirmación con varias opciones (promesa). Lo dibuja <DialogHost/> en el Layout. */
import { useSyncExternalStore } from "react";

export interface Choice { id: string; label: string; kind?: "primary" | "danger" | "plain" }
export interface DialogReq { title: string; message: string; choices: Choice[]; resolve: (id: string) => void }

let cur: DialogReq | null = null;
const queue: DialogReq[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Devuelve el id elegido ("" si se cierra con Esc o fuera del cuadro). */
export function askChoice(title: string, message: string, choices: Choice[]): Promise<string> {
  return new Promise((resolve) => {
    const req: DialogReq = {
      title, message, choices,
      resolve: (id) => { cur = queue.shift() ?? null; emit(); resolve(id); },
    };
    if (cur) queue.push(req); else { cur = req; emit(); }
  });
}
export const useDialog = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => cur);

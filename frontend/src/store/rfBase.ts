/** Diseño base «para todos» del Reporte fotográfico (secciones, títulos, bloques y descripciones; nunca fotos). */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Cell, FotoTipo, Opcion, Section } from "./photoReportStore";
import { newCell, uid } from "./photoReportStore";

export interface RfBase { sections: { lado: string; cells: { descripcion: string; bloque: string }[] }[]; opciones: Opcion[] }

export async function fetchRfBase(tipo: FotoTipo): Promise<RfBase | null> {
  const { data } = await api.get<{ base: RfBase | null }>(`/designs/rf/${encodeURIComponent(tipo)}`);
  return data.base;
}
export async function saveRfBase(tipo: FotoTipo, sections: Section[], opciones: Opcion[]): Promise<RfBase> {
  const { data } = await api.put<{ base: RfBase }>(`/designs/rf/${encodeURIComponent(tipo)}`, { sections, opciones });
  return data.base;
}
export async function clearRfBase(tipo: FotoTipo): Promise<void> {
  await api.delete(`/designs/rf/${encodeURIComponent(tipo)}`);
}

/** Estado del diseño base de este tipo de reporte (`loaded` = ya se consultó al servidor, haya o no base). */
export function useRfBase(tipo: FotoTipo) {
  const [st, setSt] = useState<{ loaded: boolean; base: RfBase | null }>({ loaded: false, base: null });
  const reload = useCallback(async () => {
    try { setSt({ loaded: true, base: await fetchRfBase(tipo) }); } catch { setSt((p) => ({ loaded: true, base: p.base })); }
  }, [tipo]);
  useEffect(() => { setSt({ loaded: false, base: null }); void reload(); }, [reload]);
  return { ...st, reload, set: (base: RfBase | null) => setSt({ loaded: true, base }) };
}

/** Secciones nuevas a partir del diseño base (celdas vacías, sin fotos). */
export function sectionsFromBase(base: RfBase): Section[] {
  return base.sections.map((s) => ({ id: uid(), lado: s.lado, cells: s.cells.map((c): Cell => newCell(c.descripcion, c.bloque)) }));
}

const key = (c: { descripcion: string; bloque?: string }) => `${c.bloque ?? ""}\u0001${c.descripcion}`;

/**
 * «Restaurar diseño base»: el orden, los títulos, los bloques y las celdas vuelven a ser los del diseño base,
 * pero las fotos y los textos que ya tienes se conservan. Lo que añadiste tú y no está en el base queda al final de su sección.
 */
export function mergeWithBase(current: Section[], base: RfBase): Section[] {
  const used = new Set<string>();
  const out: Section[] = base.sections.map((bs) => {
    const cur = current.find((c) => c.lado === bs.lado);
    const cells = bs.cells.map((bc): Cell => {
      const m = cur?.cells.find((c) => !used.has(c.id) && key(c) === key(bc));
      if (m) { used.add(m.id); return m; }
      return newCell(bc.descripcion, bc.bloque);
    });
    for (const c of cur?.cells ?? []) if (!used.has(c.id)) { used.add(c.id); cells.push(c); }   // lo tuyo extra no se pierde
    return { id: cur?.id ?? uid(), lado: bs.lado, cells };
  });
  for (const c of current) if (!out.some((o) => o.lado === c.lado)) out.push(c);                  // secciones propias
  return out;
}

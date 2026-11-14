import { TEMPLATES } from "./templates";
import type { Template } from "./types";

/** Marcas de equipo con sus Gráficas. Los iconos son compartidos entre todas. */
export const GRUPOS = [
  { id: "cisco", label: "Gráficas Cisco" },
  { id: "huawei", label: "Gráficas Huawei" },
  { id: "fortinet", label: "Gráficas Fortinet" },
] as const;
export type GrupoId = (typeof GRUPOS)[number]["id"];

/** Opciones de fábrica de cada marca (todas parten del mismo diseño base). */
export const FABRICA = [
  { slug: "gpon-ont", label: "Internet GPON con ONT" },
  { slug: "gpon-modulo", label: "Internet GPON con módulo" },
  { slug: "fibra", label: "Internet con fibra convencional" },
] as const;

export const grupoOf = (id: string) => GRUPOS.find((g) => g.id === id);
export const optId = (grupo: string, slug: string) => `${grupo}-${slug}`;
export const slugOf = (id: string) => id.split("-").slice(1).join("-");
/** Clave de lo guardado en el navegador / por cliente (la primera opción conserva su nombre de siempre). */
export const storageId = (id: string) => (id === "cisco-gpon-ont" ? "ont-cisco" : id);

export interface OptionInfo { id: string; grupo: GrupoId; slug: string; label: string; custom: boolean }

export function fabricaOf(grupo: string): OptionInfo[] {
  return FABRICA.map((f) => ({ id: optId(grupo, f.slug), grupo: grupo as GrupoId, slug: f.slug, label: f.label, custom: false }));
}

/** Plantilla (campos + diseño de fábrica) de una opción: todas comparten los mismos campos y el mismo diseño inicial. */
export function templateFor(id: string, label: string): Template {
  return { ...TEMPLATES[0], id, label };
}

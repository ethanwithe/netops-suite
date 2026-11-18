/** Variables de la Gráfica (ver backend services/diagram_vars.py): las de fábrica y las que se crean solas con los datos de cliente. */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";

export interface DiagramVar { key: string; label: string; source: "base" | "dato" | "local"; field: string; dato: string; builtin: boolean }

// Copia de las de fábrica, por si el servidor no responde.
const FALLBACK: DiagramVar[] = ([
  ["cliente", "Cliente", "base", "nombre"], ["sot", "SOT", "base", "sot"], ["cid", "CID", "base", "cid"], ["proyecto", "Proyecto", "base", "proy"],
  ["empresa", "Empresa (contrata)", "base", "contrata"], ["fecha", "Fecha", "base", "fecha"],
  ["servicio", "Servicio", "dato", "SERVICIO"], ["sede", "Sede", "dato", "SEDE"], ["direccion", "Dirección", "dato", "DIRECCION"], ["contacto", "Contacto", "dato", "CONTACTO"],
  ["pop", "POP", "dato", "POP"], ["olt", "OLT", "dato", "OLT"], ["ip_wan_claro", "IP WAN Claro", "dato", "IP WAN CLARO"], ["red_wan", "Red WAN", "dato", "RED WAN"],
  ["vlan", "VLAN", "dato", "VLAN"], ["subinterface", "Subinterface", "dato", "SUB INTERFACE"], ["marca_ont", "Marca del router ONT", "dato", "MARCA ONT"],
  ["modelo_router", "Modelo del router", "dato", "MODELO ROUTER"], ["ip_wan_cpe", "IP WAN CPE", "dato", "IP WAN CPE"], ["puerto", "Puerto RJ45", "dato", "PUERTO RJ45"],
  ["red_lan", "Red LAN", "dato", "RED LAN"], ["ip_lan_gw", "IP LAN (gateway)", "dato", "IP LAN GW"], ["ip_lan_sw", "IP LAN (switch)", "dato", "IP LAN SW"],
  ["realizado", "Realizado por", "local", ""], ["direccion_corta", "Dirección (cuadro de datos)", "local", ""],
] as [string, string, DiagramVar["source"], string][]).map(([key, label, source, f]) => ({ key, label, source, field: source === "base" ? f : "", dato: source === "dato" ? f : "", builtin: true }));

let list: DiagramVar[] = FALLBACK;
let loaded = false;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export async function reloadVariables(): Promise<void> {
  try { const { data } = await api.get<DiagramVar[]>("/diagrams/variables"); list = data; loaded = true; emit(); } catch { /* se quedan las de fábrica */ }
}
export function useVariables(): DiagramVar[] {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => list);
  useEffect(() => { if (!loaded && !loading) loading = reloadVariables().finally(() => { loading = null; }); }, []);
  return v;
}
export const createVariable = (label: string) => api.post<DiagramVar>("/diagrams/variables", { label }).then(async (r) => { await reloadVariables(); return r.data; });
export const renameVariable = (key: string, label: string) => api.put(`/diagrams/variables/${encodeURIComponent(key)}`, { label }).then(reloadVariables);
export const deleteVariable = (key: string) => api.delete(`/diagrams/variables/${encodeURIComponent(key)}`).then(reloadVariables);

const up = (s: string) => s.trim().toUpperCase();
const dmy = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || ""; };

/** Lo que un cliente tiene para cada variable (cada una sabe de dónde jalar su dato). `datos` ya viene con los alias del CheckList. */
export function valuesFromClient(vars: DiagramVar[], c: { sot: string; nombre: string; cid: string; proy: string; contrata: string; fecha: string }, datos: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = { nombre: c.nombre, sot: c.sot, cid: c.cid, proy: c.proy, contrata: c.contrata, fecha: dmy(c.fecha) };
  const d = Object.fromEntries(Object.entries(datos).map(([k, v]) => [up(k), v]));
  const out: Record<string, string> = {};
  for (const v of vars) {
    const val = v.source === "base" ? base[v.field] : v.source === "dato" ? d[up(v.dato)] : "";
    if (val) out[v.key] = val;
  }
  return out;
}

/** Lo que la gráfica sabe y se guarda en los datos del cliente (solo variables que vienen de sus datos). */
export function datosFromFields(vars: DiagramVar[], fields: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const v of vars) if (v.source === "dato" && fields[v.key]?.trim()) o[v.dato] = fields[v.key].trim();
  return o;
}

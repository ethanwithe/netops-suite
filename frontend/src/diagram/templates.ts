import type { Doc, Template } from "./types";
import { fitText } from "./fit";
import ontCisco from "./ontCisco.json";

/** Tipos de diagrama. Cada uno trae su lienzo base (editable) y los datos que se piden al inicio. */
export const TEMPLATES: Template[] = [
  {
    id: "ont-cisco",
    label: "Internet con ONT y Router Cisco",
    desc: "Red proveedor Claro (OLT, splitter, FAT) → roseta → ONT → router Cisco → switch del cliente.",
    doc: ontCisco as unknown as Doc,
    groups: [
      { title: "Datos del cliente", fields: [
        { key: "cliente", label: "Cliente", hint: "MAXI MOBILITY PERU S.A.C." },
        { key: "sede", label: "Sede", hint: "MIRAFLORES" },
        { key: "direccion", label: "Dirección", hint: "JOSÉ DEL LLANO ZAPATA 191, MIRAFLORES 15073 LIMA", multiline: true },
        { key: "direccion_corta", label: "Dirección (cuadro de datos)", hint: "Si lo dejas vacío usa la dirección completa" },
        { key: "contacto", label: "Contacto", hint: "ARNOLD MEZA - 974283219" },
      ] },
      { title: "Datos del servicio (cuadro Claro)", fields: [
        { key: "servicio", label: "Servicio", hint: "Internet Corporativo 70 Mbps" },
        { key: "proyecto", label: "Proyecto", hint: "24864016" },
        { key: "sot", label: "SOT" },
        { key: "cid", label: "CID" },
        { key: "fecha", label: "Fecha", hint: "dd/mm/aaaa" },
        { key: "realizado", label: "Realizado por", hint: "Se llena con el nombre de tu perfil" },
        { key: "empresa", label: "Empresa", hint: "WITLINK S.A.C." },
      ] },
      { title: "Red proveedor (Claro)", fields: [
        { key: "pop", label: "POP", hint: "POP SAN FELIPE II (LINCE)" },
        { key: "olt", label: "OLT", hint: "oltSanFelipe04-FTTO" },
        { key: "ip_wan_claro", label: "IP WAN Claro", hint: "10.31.208.25" },
        { key: "red_wan", label: "Red WAN", hint: "10.31.208.24/29" },
        { key: "vlan", label: "VLAN", hint: "553" },
        { key: "subinterface", label: "Subinterface", hint: "Gi0/0/0.10" },
      ] },
      { title: "Red del cliente", fields: [
        { key: "marca_ont", label: "Marca del router ONT", hint: "HUAWEI" },
        { key: "modelo_router", label: "Modelo del router Cisco", hint: "C1121X-4P" },
        { key: "ip_wan_cpe", label: "IP WAN CPE", hint: "10.31.208.30" },
        { key: "puerto", label: "Puerto RJ45", hint: "GE0/0/0" },
        { key: "red_lan", label: "Red LAN", hint: "190.223.26.128/29" },
        { key: "ip_lan_gw", label: "IP LAN (gateway)", hint: "190.223.26.129" },
        { key: "ip_lan_sw", label: "IP LAN (switch)", hint: "190.223.26.X" },
      ] },
    ],
  },
];

export const findTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export type Fields = Record<string, string>;

/** Reemplaza {{clave}} por el valor del campo (vacío si falta). */
export function fill(text: string, f: Fields): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (f[k] ?? (k === "direccion_corta" ? f.direccion : "") ?? "").trim());
}

/** Documento con los campos ya puestos (lo que se dibuja y se exporta). */
export function resolveDoc(doc: Doc, f: Fields): Doc {
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (e.type === "text") return fitText({ ...e, text: fill(e.text ?? "", f) });
      if (e.type === "rect" && e.text) return { ...e, text: fill(e.text ?? "", f) };
      if (e.type === "table") return { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, text: fill(c.text, f) })) })) };
      return e;
    }),
  };
}

/** Nombres con los que los datos del diagrama se guardan en «Mis clientes» (y de donde se leen al elegir un cliente). */
export const DATOS_KEYS: Record<string, string> = {
  ip_wan_claro: "IP WAN CLARO", ip_wan_cpe: "IP WAN CPE", red_wan: "RED WAN", red_lan: "RED LAN", vlan: "VLAN",
  subinterface: "SUB INTERFACE", pop: "POP", olt: "OLT", puerto: "PUERTO RJ45", ip_lan_gw: "IP LAN GW", ip_lan_sw: "IP LAN SW",
  modelo_router: "MODELO ROUTER", marca_ont: "MARCA ONT", servicio: "SERVICIO", sede: "SEDE", direccion: "DIRECCION", contacto: "CONTACTO",
};

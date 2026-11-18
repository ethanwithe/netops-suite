"""
diagram_vars.py
Variables de la Gráfica. Las de fábrica (cliente, SOT, IPs de la red de Claro…) siempre existen; el resto se crea sola
cuando aparece un dato nuevo en «Datos de cliente» (y es la misma para todos los clientes con ese dato).
"""
import re
import time
import unicodedata

from sqlalchemy.orm import Session

from app import models

# (clave, etiqueta, origen, campo/dato)   origen: base = campo del cliente; dato = dentro de sus datos; local = solo de la gráfica
BUILTIN: list[tuple[str, str, str, str]] = [
    ("cliente", "Cliente", "base", "nombre"), ("sot", "SOT", "base", "sot"), ("cid", "CID", "base", "cid"),
    ("proyecto", "Proyecto", "base", "proy"), ("empresa", "Empresa (contrata)", "base", "contrata"), ("fecha", "Fecha", "base", "fecha"),
    ("servicio", "Servicio", "dato", "SERVICIO"), ("sede", "Sede", "dato", "SEDE"), ("direccion", "Dirección", "dato", "DIRECCION"),
    ("contacto", "Contacto", "dato", "CONTACTO"),
    ("pop", "POP", "dato", "POP"), ("olt", "OLT", "dato", "OLT"),
    ("ip_wan_claro", "IP WAN Claro", "dato", "IP WAN CLARO"), ("red_wan", "Red WAN", "dato", "RED WAN"), ("vlan", "VLAN", "dato", "VLAN"),
    ("subinterface", "Subinterface", "dato", "SUB INTERFACE"), ("marca_ont", "Marca del router ONT", "dato", "MARCA ONT"),
    ("modelo_router", "Modelo del router", "dato", "MODELO ROUTER"), ("ip_wan_cpe", "IP WAN CPE", "dato", "IP WAN CPE"),
    ("puerto", "Puerto RJ45", "dato", "PUERTO RJ45"), ("red_lan", "Red LAN", "dato", "RED LAN"),
    ("ip_lan_gw", "IP LAN (gateway)", "dato", "IP LAN GW"), ("ip_lan_sw", "IP LAN (switch)", "dato", "IP LAN SW"),
    ("realizado", "Realizado por", "local", ""), ("direccion_corta", "Dirección (cuadro de datos)", "local", ""),
]
_BUILTIN_KEYS = {b[0] for b in BUILTIN}
_BUILTIN_DATOS = {b[3].upper() for b in BUILTIN if b[2] == "dato"}
# Nombres que el CheckList guarda y que ya son lo mismo que una variable de fábrica (ver frontend store/clientLink.ts)
_ALIAS_DATOS = {"WAN", "NEXTHOP", "LAN", "MODELO"}

_last_scan = 0.0


def slug(name: str) -> str:
    t = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    t = re.sub(r"[^A-Za-z0-9]+", "_", t).strip("_").lower()[:40]
    if not t:
        t = "dato"
    return "v_" + t if t[0].isdigit() else t


def ensure_variables(db: Session, datos: dict | None) -> int:
    """Crea una variable por cada nombre de dato que todavía no tenga (sin duplicar entre clientes)."""
    new = 0
    if not datos:
        return 0
    have = {v.dato.upper(): v for v in db.query(models.DiagramVariable).all()}
    keys = {v.key for v in have.values()}
    for raw in datos.keys():
        name = str(raw).strip()
        up = name.upper()
        if not name or up in _BUILTIN_DATOS or up in _ALIAS_DATOS or up in have:
            continue
        key, n = slug(name), 2
        while key in _BUILTIN_KEYS or key in keys:
            key = f"{slug(name)}_{n}"
            n += 1
        row = models.DiagramVariable(key=key, label=name, dato=up)
        db.add(row)
        have[up] = row
        keys.add(key)
        new += 1
    if new:
        db.flush()
    return new


def backfill(db: Session, force: bool = False) -> None:
    """Revisa los datos de todos los clientes (como mucho una vez por minuto) y crea las variables que falten."""
    global _last_scan
    if not force and time.time() - _last_scan < 60:
        return
    _last_scan = time.time()
    names: dict = {}
    for (d,) in db.query(models.Client.datos).all():
        if isinstance(d, dict):
            names.update({k: 1 for k in d})
    if ensure_variables(db, names):
        db.commit()


def catalog(db: Session) -> list[dict]:
    out = [{"key": k, "label": lb, "source": src, "field": f if src == "base" else "", "dato": f if src == "dato" else "", "builtin": True}
           for k, lb, src, f in BUILTIN]
    for v in db.query(models.DiagramVariable).order_by(models.DiagramVariable.label).all():
        out.append({"key": v.key, "label": v.label, "source": "dato", "field": "", "dato": v.dato, "builtin": False})
    return out

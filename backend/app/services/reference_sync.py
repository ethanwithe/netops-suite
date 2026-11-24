"""
reference_sync.py — datos de referencia que la nube comparte con la app de escritorio: cuentas, logos, iconos,
catálogos de fotos/checklist, diseños de Gráfica y ajustes. La nube manda (solo lectura en el escritorio).

Nube: `snapshot()` arma las tablas cuyo contenido cambió respecto a lo que el escritorio ya tiene (huella por tabla).
Escritorio: `apply()` las copia a su base local. Nunca viaja una contraseña ni una clave: las cuentas copiadas
quedan sin contraseña local (se entra con la nube) y los ajustes con nombre de clave/secreto se omiten.
"""
import base64
import datetime as dt
import hashlib
import json
from typing import Any

from sqlalchemy import LargeBinary, DateTime, func, inspect

from app import models
from app.services import cache

# Tablas que se copian completas (la nube reemplaza lo local); orden = dependencias
FULL = ("services", "template_fragments", "checklist_items", "photo_items", "photo_windows", "checklist_templates", "checklist_bases",
        "diagram_variables", "diagram_designs", "diagram_base_versions", "header_logos", "diagram_icons")
OTHER = ("app_settings", "users")
TABLES = FULL + OTHER
SECRET_WORDS = ("key", "secret", "token", "telegram", "password", "apikey")
USER_SKIP = {"password_hash", "token_version"}


def _model(table: str):
    for m in models.Base.registry.mappers:
        if m.local_table.name == table:
            return m.class_
    raise KeyError(table)


def _ser(row, skip=()) -> dict:
    out: dict[str, Any] = {}
    for c in inspect(row.__class__).columns:
        if c.key in skip:
            continue
        v = getattr(row, c.key)
        if isinstance(v, (bytes, bytearray, memoryview)):
            v = base64.b64encode(bytes(v)).decode()
        elif isinstance(v, dt.datetime):
            v = v.isoformat()
        out[c.key] = v
    return out


def _rows(db, table: str, user: models.User) -> list[dict]:
    M = _model(table)
    q = db.query(M)
    if table == "app_settings":
        return [_ser(r) for r in q.all() if not any(w in r.key.lower() for w in SECRET_WORDS)]
    if table == "users":
        if user.role not in ("admin", "superadmin"):
            return []
        return [_ser(r, USER_SKIP) for r in q.all()]
    return [_ser(r) for r in q.all()]


def digest(rows: list[dict]) -> str:
    return hashlib.sha1(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def _signature(db, table: str, user: models.User) -> str:
    """Huella barata: no carga los binarios (logos, iconos), solo su tamaño."""
    M = _model(table)
    cols = list(inspect(M).columns)
    skip = USER_SKIP if table == "users" else set()
    sel = [func.length(getattr(M, c.key)) if isinstance(c.type, LargeBinary) else getattr(M, c.key) for c in cols if c.key not in skip]
    rows = [tuple(str(v) for v in r) for r in db.query(*sel).all()]
    if table == "app_settings":
        rows = [r for r in rows if not any(w in r[0].lower() for w in SECRET_WORDS)]
    if table == "users" and user.role not in ("admin", "superadmin"):
        rows = []
    rows.sort()
    return "s" + hashlib.sha1(json.dumps(rows).encode()).hexdigest()


def snapshot(db, user: models.User, have: dict) -> dict:
    """{tabla: {digest, rows}} solo de las tablas que cambiaron (se decide con la huella barata, sin armar las filas)."""
    out = {}
    for t in TABLES:
        sig = _signature(db, t, user)
        if have.get(t) != sig:
            out[t] = {"digest": sig, "rows": _rows(db, t, user)}
    return out


def _val(col, v):
    if v is None:
        return None
    if isinstance(col.type, LargeBinary):
        return base64.b64decode(v)
    if isinstance(col.type, DateTime):
        try:
            return dt.datetime.fromisoformat(v)
        except (TypeError, ValueError):
            return None
    return v


def _fill(M, data: dict):
    cols = {c.key: c for c in inspect(M).columns}
    return {k: _val(cols[k], v) for k, v in data.items() if k in cols}


def apply(db, snap: dict, self_id: str) -> dict:
    """Copia lo recibido a la base local. Devuelve {tabla: digest} de lo aplicado."""
    done = {}
    for t in TABLES:
        part = snap.get(t)
        if not part:
            continue
        M = _model(t)
        pk = inspect(M).primary_key[0].key
        rows = part["rows"]
        try:
            with db.begin_nested():
                if t == "users":
                    for d in rows:
                        if d["id"] == self_id:
                            continue          # la cuenta con la que se entró no se toca
                        row = db.get(M, d["id"])
                        if not row:
                            clash = db.query(M).filter(M.username == d["username"]).first()
                            if clash:
                                continue      # misma persona/nombre ya existe en local: no se duplica
                            row = M(id=d["id"], username=d["username"], password_hash="!")
                            db.add(row)
                        for k, v in _fill(M, d).items():
                            if k not in ("id", "password_hash"):
                                setattr(row, k, v)
                elif t == "app_settings":
                    for d in rows:
                        row = db.get(M, d["key"])
                        if not row:
                            row = M(key=d["key"])
                            db.add(row)
                        for k, v in _fill(M, d).items():
                            if k != "key":
                                setattr(row, k, v)
                else:
                    if not rows:
                        done[t] = part["digest"]
                        continue              # una tabla vacía en la nube no borra el catálogo local
                    keep = {d[pk] for d in rows}
                    for old in db.query(M).all():
                        if getattr(old, pk) not in keep:
                            db.delete(old)
                    db.flush()
                    if t == "services":       # «clave» es única: si el id cambió se reemplaza la fila local
                        claves = {d["clave"] for d in rows}
                        for old in db.query(M).filter(M.clave.in_(claves)).all():
                            if old.id not in keep:
                                db.delete(old)
                        db.flush()
                    for d in rows:
                        row = db.get(M, d[pk])
                        if not row:
                            row = M(**{pk: d[pk]})
                            db.add(row)
                        for k, v in _fill(M, d).items():
                            if k != pk:
                                setattr(row, k, v)
            db.commit()
            done[t] = part["digest"]
        except Exception:  # noqa: BLE001  (una tabla con problemas no frena a las demás)
            db.rollback()
    if done:
        for pre in ("items:", "logos:", "logo:"):
            cache.delete_prefix(pre)
    return done

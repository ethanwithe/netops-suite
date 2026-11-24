"""
Opciones de Gráfica por marca (Cisco, Huawei, Fortinet): diseño publicado para todos, diseños base con historial
y opciones nuevas creadas por los usuarios. Lo personal de cada usuario se queda en su navegador / en sus clientes.
"""
import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user
from app.database import get_db

router = APIRouter(prefix="/api/diagrams/options", tags=["diagrams"])

GRUPOS = {"cisco", "huawei", "fortinet"}      # marcas de fábrica; el superadmin puede crear más (ver /groups)
FABRICA_SLUGS = {"gpon-ont", "gpon-modulo", "fibra"}
MAX_DOC = 6_000_000
LAYOUT_KEY = "diagram_layout"


class GroupIn(BaseModel):
    label: str


class LabelIn(BaseModel):
    id: str            # id de una marca u de una opción
    label: str


def _layout(db: Session) -> dict:
    row = db.get(models.AppSetting, LAYOUT_KEY)
    v = dict(row.value) if row and isinstance(row.value, dict) else {}
    return {"groups": list(v.get("groups") or []), "labels": dict(v.get("labels") or {})}


def _save_layout(db: Session, user: models.User, lay: dict) -> None:
    row = db.get(models.AppSetting, LAYOUT_KEY)
    if not row:
        row = models.AppSetting(key=LAYOUT_KEY, value={})
        db.add(row)
    row.value = {"groups": lay["groups"], "labels": lay["labels"]}
    row.updated_at, row.updated_by = dt.datetime.utcnow(), user.username
    db.commit()


def _known_groups(db: Session) -> set[str]:
    return GRUPOS | {g["id"] for g in _layout(db)["groups"]}


def _clean_label(label: str) -> str:
    label = (label or "").strip()
    if not label:
        raise HTTPException(400, "Escribe un nombre.")
    return label[:80]


class DocIn(BaseModel):
    doc: dict


class NewIn(BaseModel):
    grupo: str
    nombre: str
    doc: dict


def _super(user: models.User):
    if user.role != "superadmin":
        raise HTTPException(403, "Solo el superadmin puede hacer esto.")


def _check(doc: dict) -> dict:
    if not isinstance(doc, dict) or not isinstance(doc.get("elements"), list):
        raise HTTPException(400, "Diseño inválido.")
    if len(str(doc)) > MAX_DOC:
        raise HTTPException(413, "El diseño es demasiado grande.")
    return doc


def _row(db: Session, opt_id: str, grupo: str | None = None) -> models.DiagramDesign:
    row = db.get(models.DiagramDesign, opt_id)
    if row:
        return row
    g = grupo or opt_id.split("-", 1)[0]
    if g not in _known_groups(db):
        raise HTTPException(404, "Opción desconocida.")
    row = models.DiagramDesign(id=opt_id, grupo=g, nombre="", custom=False)
    db.add(row)
    db.flush()
    return row


def _latest(db: Session, opt_id: str):
    return (db.query(models.DiagramBaseVersion).filter_by(opt_id=opt_id)
            .order_by(models.DiagramBaseVersion.created_at.desc()).first())


@router.get("")
def list_options(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Opciones creadas por usuarios y qué opciones tienen diseño publicado / base (sin los documentos)."""
    bases = {}
    for oid, in db.query(models.DiagramBaseVersion.opt_id).all():
        bases[oid] = bases.get(oid, 0) + 1
    rows = db.query(models.DiagramDesign).order_by(models.DiagramDesign.orden, models.DiagramDesign.updated_at).all()
    return [{"id": r.id, "grupo": r.grupo, "nombre": r.nombre, "custom": bool(r.custom),
             "published": r.published is not None, "bases": bases.get(r.id, 0)} for r in rows]


@router.get("/layout")
def get_layout(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Marcas creadas por el superadmin y nombres cambiados (de marcas y opciones de fábrica)."""
    return _layout(db)


@router.post("/groups")
def create_group(body: GroupIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _super(user)
    label = _clean_label(body.label)
    lay = _layout(db)
    gid = "m" + uuid.uuid4().hex[:8]          # sin guiones: el id de una opción es «<marca>-<tipo>»
    lay["groups"].append({"id": gid, "label": label})
    _save_layout(db, user, lay)
    return lay


@router.put("/labels")
def set_label(body: LabelIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Cambia el nombre de una marca (de fábrica o creada) o de una opción (de fábrica o creada)."""
    _super(user)
    label = _clean_label(body.label)
    lay = _layout(db)
    gid, _, slug = body.id.partition("-")
    custom_group = next((g for g in lay["groups"] if g["id"] == body.id), None)
    if custom_group:
        custom_group["label"] = label
    elif body.id in GRUPOS:
        lay["labels"][body.id] = label
    elif gid in _known_groups(db) and slug in FABRICA_SLUGS:
        lay["labels"][body.id] = label
    else:
        row = db.get(models.DiagramDesign, body.id)
        if not row or not row.custom:
            raise HTTPException(404, "Esa opción no existe.")
        row.nombre = label
    _save_layout(db, user, lay)
    return lay


@router.delete("/groups/{gid}")
def delete_group(gid: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _super(user)
    lay = _layout(db)
    if not any(g["id"] == gid for g in lay["groups"]):
        raise HTTPException(404, "Solo se pueden borrar las marcas creadas.")
    ids = [r.id for r in db.query(models.DiagramDesign).filter(models.DiagramDesign.grupo == gid)]
    for oid in ids:
        db.query(models.DiagramBaseVersion).filter_by(opt_id=oid).delete()
    db.query(models.DiagramDesign).filter(models.DiagramDesign.grupo == gid).delete()
    # las opciones de fábrica de esa marca también pudieron publicarse (sin ser «custom»): ya salieron arriba por grupo
    lay["groups"] = [g for g in lay["groups"] if g["id"] != gid]
    lay["labels"] = {k: v for k, v in lay["labels"].items() if not k.startswith(gid)}
    _save_layout(db, user, lay)
    return lay


@router.get("/{opt_id}")
def get_option(opt_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(models.DiagramDesign, opt_id)
    latest = _latest(db, opt_id)
    out = {"published": row.published if row else None, "base": latest.doc if latest else None, "versions": []}
    if user.role == "superadmin":
        vs = (db.query(models.DiagramBaseVersion).filter_by(opt_id=opt_id)
              .order_by(models.DiagramBaseVersion.created_at.desc()).limit(30).all())
        out["versions"] = [{"id": v.id, "at": v.created_at.isoformat() + "Z", "by": v.created_by or ""} for v in vs]
    return out


@router.get("/{opt_id}/versions/{vid}")
def get_version(opt_id: str, vid: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _super(user)
    v = db.get(models.DiagramBaseVersion, vid)
    if not v or v.opt_id != opt_id:
        raise HTTPException(404, "Esa versión ya no existe.")
    return {"doc": v.doc}


@router.post("")
def create_option(body: NewIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    nombre = body.nombre.strip()
    if body.grupo not in _known_groups(db):
        raise HTTPException(400, "Marca inválida.")
    if not nombre:
        raise HTTPException(400, "Escribe un nombre.")
    doc = _check(body.doc)
    oid = f"{body.grupo}-c{uuid.uuid4().hex[:8]}"
    db.add(models.DiagramDesign(id=oid, grupo=body.grupo, nombre=nombre[:80], custom=True, orden=200,
                                published=doc, created_by=user.username))
    db.add(models.DiagramBaseVersion(opt_id=oid, doc=doc, created_by=user.username))
    db.commit()
    return {"id": oid, "grupo": body.grupo, "nombre": nombre[:80], "custom": True, "published": True, "bases": 1}


@router.post("/{opt_id}/publish")
def publish(opt_id: str, body: DocIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _super(user)
    row = _row(db, opt_id)
    row.published = _check(body.doc)
    row.updated_at = dt.datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.post("/{opt_id}/base")
def set_base(opt_id: str, body: DocIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _super(user)
    row = _row(db, opt_id)
    doc = _check(body.doc)
    row.published = doc
    row.updated_at = dt.datetime.utcnow()
    db.add(models.DiagramBaseVersion(opt_id=opt_id, doc=doc, created_by=user.username))
    db.commit()
    return {"ok": True}


@router.delete("/{opt_id}")
def delete_option(opt_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(models.DiagramDesign, opt_id)
    if not row or not row.custom:
        raise HTTPException(404, "Solo se pueden borrar las opciones creadas.")
    if user.role != "superadmin" and row.created_by != user.username:
        raise HTTPException(403, "Solo quien la creó o el superadmin puede borrarla.")
    db.query(models.DiagramBaseVersion).filter_by(opt_id=opt_id).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}

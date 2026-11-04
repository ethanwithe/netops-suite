"""
clients.py
Datos de clientes por SOT, organizados por año y mes (según la fecha de los datos).
Cualquier ventana puede mandar lo que sabe de una SOT (/sync) y se junta aquí.
"""

import datetime as dt
import re

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import current_user, log_activity
from app.database import get_db
from app.services import client_access as ca
from app.services import security
from app.services.naming import clean_part

router = APIRouter(prefix="/api/clients", tags=["clients"])

_SOT_PREFIX = re.compile(r"^\s*SOT\s*[-_:.#]*\s*", re.IGNORECASE)
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DMY = re.compile(r"^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s*$")


def norm_sot(sot: str) -> str:
    return _SOT_PREFIX.sub("", str(sot or "")).strip()


def norm_fecha(fecha: str) -> str:
    """Acepta yyyy-mm-dd o dd/mm/yyyy; si no se entiende, devuelve ''."""
    f = str(fecha or "").strip()
    if _ISO.match(f):
        return f
    m = _DMY.match(f)
    if m:
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
        try:
            return dt.date(y, mo, d).isoformat()
        except ValueError:
            return ""
    return ""


def _today() -> str:
    return dt.date.today().isoformat()


def _years(db: Session, user: models.User) -> dict[int, int]:
    counts: dict[int, int] = {}
    for r in ca.visible(db, user).all():
        f = r.fecha or ""
        if f[:4].isdigit():
            counts[int(f[:4])] = counts.get(int(f[:4]), 0) + 1
    for y in db.query(models.ClientYear).all():
        counts.setdefault(y.year, 0)
    counts.setdefault(dt.date.today().year, 0)
    return counts


@router.get("/years")
def list_years(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Años disponibles con tu cantidad de clientes (el actual siempre existe)."""
    counts = _years(db, user)
    return [{"year": y, "total": counts[y]} for y in sorted(counts)]


@router.post("/years")
def create_year(payload: schemas.ClientYearIn, _: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if not (2000 <= payload.year <= 2100):
        raise HTTPException(400, "Año fuera de rango.")
    if not db.get(models.ClientYear, payload.year):
        db.add(models.ClientYear(year=payload.year))
        db.commit()
    return {"year": payload.year}


@router.get("")
def list_clients(year: int | None = None, q: str = "", user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Mis clientes: donde yo participo (el administrador ve los de todos en /api/admin/clients)."""
    return ca.list_clients_out(db, user, year=year, q=q)


@router.get("/dashboard")
def dashboard(scope: str = "me", year: int | None = None, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return ca.dashboard(db, user, scope, year or dt.date.today().year)


@router.get("/trash")
def trash(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return ca.list_clients_out(db, user, deleted=True)


@router.get("/by-sot/{sot}")
def get_by_sot(sot: str, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _find(db, user, norm_sot(sot), request)
    if not row:
        raise HTTPException(404, "No hay un cliente con esa SOT.")
    return ca.client_out(db, row, user.id)


def _new_client(db: Session, user: models.User, sot: str, fecha: str = "") -> models.Client:
    row = models.Client(sot=sot, fecha=norm_fecha(fecha) or _today(), datos={}, reportes=[], owner_id=user.id)
    db.add(row)
    db.flush()
    ca.add_participant(db, row.id, user.id)
    return row


def _mine_or_restore(db: Session, user: models.User, sot: str, fecha: str = "") -> models.Client:
    """El cliente de esa SOT donde participo; si estaba en la papelera se recupera; si no existe se crea."""
    row = ca.find_by_sot(db, user, sot, include_deleted=True)
    if row and row.deleted_at:
        row.deleted_at, row.deleted_by = None, None
    return row or _new_client(db, user, sot, fecha)


def _find(db: Session, user: models.User, sot: str, request: Request):
    """Cliente de esa SOT. Un administrador que abrió el cliente de otro usuario lo indica con X-Act-Client."""
    act = request.headers.get("x-act-client", "").strip()
    if act and security.is_admin(user):
        c = db.get(models.Client, act)
        if c and c.sot == sot:
            return c
    return ca.find_by_sot(db, user, sot)


def _own_or_404(db: Session, user: models.User, client_id: str) -> models.Client:
    row = db.get(models.Client, client_id)
    if not row or not ca.can_access(db, user, row):
        raise HTTPException(404, "El cliente ya no existe.")
    return row


def _apply(row: models.Client, data: dict, overwrite: bool):
    """Copia solo los campos con valor (en sync no se pisa lo ya guardado con vacíos)."""
    for k in ("nombre", "cid", "proy", "contrata"):
        v = str(data.get(k) or "").strip()
        if v and (overwrite or True):
            setattr(row, k, v)
    f = norm_fecha(data.get("fecha", ""))
    if f:
        row.fecha = f
    datos = dict(row.datos or {})
    for k, v in (data.get("datos") or {}).items():
        k = str(k).strip()[:40]
        v = str(v or "").strip()[:300]
        if k and v:
            datos[k] = v
    row.datos = datos
    row.updated_at = dt.datetime.utcnow()



# ---------------------------------------------------------------
# Ventanas guardadas por cliente (lo que había en pantalla, para volver a abrirlo y editarlo)
# ---------------------------------------------------------------

class WorkspaceIn(BaseModel):
    sot: str
    key: str = Field(max_length=120)
    label: str = Field(default="", max_length=120)
    route: str = Field(default="", max_length=300)
    state: dict
    nombre: str = ""
    fecha: str = ""


VERSION_EVERY = dt.timedelta(minutes=2)
VERSION_KEEP = 25


def _ws_out(w: models.UserWorkspace, sot: str, with_state: bool = True) -> dict:
    d = {"sot": sot, "key": w.key, "label": w.label, "route": w.route,
         "updated_at": w.updated_at.isoformat() if w.updated_at else ""}
    if with_state:
        d["state"] = w.state or {}
    return d


def _snapshot(db: Session, client_id: str, w: models.UserWorkspace, user: models.User, force: bool = False) -> None:
    """Guarda el estado anterior de la ventana para poder recuperarlo (como mucho una copia cada 2 minutos)."""
    if not w.state:
        return
    last = (db.query(models.WorkspaceVersion)
            .filter(models.WorkspaceVersion.client_id == client_id, models.WorkspaceVersion.key == w.key)
            .order_by(models.WorkspaceVersion.saved_at.desc()).first())
    if last and not force and dt.datetime.utcnow() - last.saved_at < VERSION_EVERY:
        return
    if last and last.state == w.state:
        return
    db.add(models.WorkspaceVersion(client_id=client_id, key=w.key, label=w.label, state=w.state,
                                   saved_at=w.updated_at or dt.datetime.utcnow(), saved_by=user.username))
    db.flush()
    old = (db.query(models.WorkspaceVersion)
           .filter(models.WorkspaceVersion.client_id == client_id, models.WorkspaceVersion.key == w.key)
           .order_by(models.WorkspaceVersion.saved_at.desc()).offset(VERSION_KEEP).all())
    for o in old:
        db.delete(o)


@router.put("/workspace")
def save_workspace(payload: WorkspaceIn, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Guarda (o reemplaza) lo de una ventana para una SOT. Crea el cliente si no existe."""
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    if len(json.dumps(payload.state)) > 3_000_000:
        raise HTTPException(413, "Los datos de la ventana son demasiado grandes.")
    row = _find(db, user, sot, request) or _mine_or_restore(db, user, sot, payload.fecha)
    if payload.nombre.strip() and not row.nombre:
        row.nombre = payload.nombre.strip()
    w = db.get(models.UserWorkspace, (row.id, payload.key))
    if not w:
        w = models.UserWorkspace(client_id=row.id, key=payload.key, state={})
        db.add(w)
    else:
        _snapshot(db, row.id, w, user)
    w.label, w.route, w.state = payload.label, payload.route, payload.state
    w.updated_at, w.updated_by = dt.datetime.utcnow(), user.username
    row.updated_at = dt.datetime.utcnow()
    db.commit()
    return _ws_out(w, sot, with_state=False)


@router.get("/workspace")
def get_workspace(sot: str, key: str, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _find(db, user, norm_sot(sot), request)
    w = db.get(models.UserWorkspace, (row.id, key)) if row else None
    if not w:
        raise HTTPException(404, "No hay datos guardados para esa SOT en esta ventana.")
    return _ws_out(w, row.sot)


@router.get("/workspaces/{sot}")
def list_workspaces(sot: str, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _find(db, user, norm_sot(sot), request)
    if not row:
        return []
    rows = db.query(models.UserWorkspace).filter(models.UserWorkspace.client_id == row.id).all()
    rows.sort(key=lambda w: w.updated_at or dt.datetime.min, reverse=True)
    return [_ws_out(w, row.sot, with_state=False) for w in rows]


@router.delete("/workspace")
def delete_workspace(sot: str, key: str, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _find(db, user, norm_sot(sot), request)
    w = db.get(models.UserWorkspace, (row.id, key)) if row else None
    if w:
        _snapshot(db, row.id, w, user, force=True)   # queda en versiones: se puede recuperar
        db.delete(w)
        db.commit()
        log_activity(db, user, "ventana_borrada", f"SOT {row.sot} · {w.label or key}", row.id)
    return {"ok": True}


@router.get("/workspace-versions")
def workspace_versions(sot: str, key: str, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _find(db, user, norm_sot(sot), request)
    if not row:
        return []
    vs = (db.query(models.WorkspaceVersion)
          .filter(models.WorkspaceVersion.client_id == row.id, models.WorkspaceVersion.key == key)
          .order_by(models.WorkspaceVersion.saved_at.desc()).all())
    return [{"id": v.id, "saved_at": v.saved_at.isoformat() + "Z", "saved_by": v.saved_by or "", "label": v.label} for v in vs]


@router.post("/workspace-versions/{version_id}/restore")
def restore_version(version_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    v = db.get(models.WorkspaceVersion, version_id)
    row = db.get(models.Client, v.client_id) if v else None
    if not v or not row or not ca.can_access(db, user, row):
        raise HTTPException(404, "Esa copia ya no existe.")
    w = db.get(models.UserWorkspace, (row.id, v.key))
    if w:
        _snapshot(db, row.id, w, user, force=True)   # lo actual también queda guardado
    else:
        w = models.UserWorkspace(client_id=row.id, key=v.key)
        db.add(w)
    w.label, w.state = v.label or w.label or "", v.state
    w.updated_at, w.updated_by = dt.datetime.utcnow(), user.username
    db.commit()
    log_activity(db, user, "version_recuperada", f"SOT {row.sot} · {v.label or v.key}", row.id)
    return _ws_out(w, row.sot)


@router.post("")
def create_client(payload: schemas.ClientIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    existing = ca.find_by_sot(db, user, sot, include_deleted=True)
    if existing and not existing.deleted_at:
        raise HTTPException(409, f"Ya existe un cliente con la SOT {sot}.")
    if existing:
        raise HTTPException(409, f"La SOT {sot} está en tu papelera: recupérala desde ahí.")
    row = _new_client(db, user, sot, payload.fecha)
    _apply(row, payload.model_dump(), True)
    db.commit()
    log_activity(db, user, "cliente_creado", f"SOT {sot}", row.id)
    return ca.client_out(db, row, user.id)


@router.put("/{client_id}")
def update_client(client_id: str, payload: schemas.ClientIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _own_or_404(db, user, client_id)
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    other = ca.find_by_sot(db, user, sot)
    if other and other.id != client_id:
        raise HTTPException(409, f"Ya existe otro cliente con la SOT {sot}.")
    row.sot = sot
    # En la edición manual sí se puede vaciar un campo y reemplazar todos los datos.
    row.nombre = payload.nombre.strip()
    row.cid = payload.cid.strip()
    row.proy = payload.proy.strip()
    row.contrata = payload.contrata.strip()
    row.fecha = norm_fecha(payload.fecha) or row.fecha or _today()
    row.datos = {str(k).strip()[:40]: str(v)[:300] for k, v in payload.datos.items() if str(k).strip()}
    row.updated_at = dt.datetime.utcnow()
    db.commit()
    log_activity(db, user, "cliente_editado", f"SOT {sot}", row.id)
    return ca.client_out(db, row, user.id)


@router.delete("/{client_id}")
def delete_client(client_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Va a la papelera (se puede recuperar); no se pierde nada."""
    row = _own_or_404(db, user, client_id)
    row.deleted_at, row.deleted_by = dt.datetime.utcnow(), user.username
    db.commit()
    log_activity(db, user, "cliente_a_papelera", f"SOT {row.sot}", row.id)
    return {"ok": True}


@router.put("/{client_id}/restore")
def restore_client(client_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = _own_or_404(db, user, client_id)
    clash = ca.find_by_sot(db, user, row.sot)
    if clash and clash.id != row.id:
        raise HTTPException(409, f"Ya hay otro cliente activo con la SOT {row.sot}.")
    row.deleted_at, row.deleted_by = None, None
    db.commit()
    log_activity(db, user, "cliente_restaurado", f"SOT {row.sot}", row.id)
    return ca.client_out(db, row, user.id)


@router.post("/sync")
def sync_client(payload: schemas.ClientSync, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Crea el cliente si no existe (en el año/mes de la fecha dada, o de hoy) o le suma lo nuevo:
    datos (IPs, interfaces...) y, si viene, un reporte generado.
    """
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    row = _find(db, user, sot, request) or _mine_or_restore(db, user, sot, payload.fecha)
    _apply(row, payload.model_dump(), False)

    if payload.reporte:
        rep = {k: str(v)[:300] for k, v in payload.reporte.items() if k in ("tipo", "nombre", "filename", "url")}
        rep["generado"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        rep["por"] = user.username
        reportes = [r for r in (row.reportes or []) if r.get("filename") != rep.get("filename")]
        reportes.append(rep)
        row.reportes = reportes[-100:]
        log_activity(db, user, "reporte_generado", f"SOT {sot} · {rep.get('nombre') or rep.get('filename', '')}", row.id)
    db.commit()
    db.refresh(row)
    return ca.client_out(db, row, user.id)

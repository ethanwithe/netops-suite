"""
admin.py
Administración: usuarios (alta, roles, permisos, vigencia, contraseña), actividad,
clientes de todos, asociación de clientes (puntos), papelera y panel.
Solo administradores. Solo el superadmin crea o modifica administradores.
"""

import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.auth import admin_user, log_activity
from app.database import get_db
from app.routers.auth import user_out
from app.services import security
from app.services import client_access as ca

router = APIRouter(prefix="/api/admin", tags=["admin"])

_USER = re.compile(r"^[a-z0-9._-]{3,40}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _admin_row(u: models.User) -> dict:
    d = user_out(u)
    d.update({
        "active": u.active, "valid_from": u.valid_from, "valid_until": u.valid_until,
        "daily_start": u.daily_start, "daily_end": u.daily_end,
        "raw_permissions": u.permissions or {}, "notes": u.notes,
        "created_at": u.created_at.isoformat() if u.created_at else "",
        "last_login": u.last_login.isoformat() + "Z" if u.last_login else "",
        "access_problem": security.access_problem(u) or "",
    })
    return d


class UserIn(BaseModel):
    username: str = ""
    password: str = Field(default="", max_length=100)
    role: str = "user"
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    cargo: str = Field(default="", max_length=80)
    active: bool = True
    valid_from: str = ""
    valid_until: str = ""
    daily_start: str = ""
    daily_end: str = ""
    permissions: dict[str, bool] = {}
    notes: str = Field(default="", max_length=1000)
    must_change_password: bool = True


def _validate(p: UserIn):
    if p.role not in security.ROLES:
        raise HTTPException(400, "Rol no válido.")
    for name, v in (("fecha desde", p.valid_from), ("fecha hasta", p.valid_until)):
        if v and not _DATE.match(v):
            raise HTTPException(400, f"La {name} debe ser aaaa-mm-dd.")
    for name, v in (("hora de inicio", p.daily_start), ("hora de fin", p.daily_end)):
        if v and not _TIME.match(v):
            raise HTTPException(400, f"La {name} debe ser HH:MM.")
    if p.valid_from and p.valid_until and p.valid_from > p.valid_until:
        raise HTTPException(400, "La fecha desde no puede ser posterior a la fecha hasta.")


def _may_manage(actor: models.User, target_role: str):
    if actor.role != "superadmin" and target_role != "user":
        raise HTTPException(403, "Solo un superadmin puede crear o modificar administradores.")


def _clean_perms(perms: dict) -> dict:
    return {k: bool(v) for k, v in perms.items() if k in security.FEATURES}


@router.get("/features")
def features(_: models.User = Depends(admin_user)):
    return [{"key": k, "label": v} for k, v in security.FEATURES.items()]


@router.get("/users")
def list_users(_: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.query(models.User).order_by(models.User.created_at).all()
    out = []
    for u in rows:
        d = _admin_row(u)
        d["clients"] = ca.count_clients(db, u.id)
        d["points"] = round(ca.points_for(db, u.id), 2)
        out.append(d)
    return out


@router.post("/users")
def create_user(p: UserIn, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    _validate(p)
    _may_manage(actor, p.role)
    username = p.username.strip().lower()
    if not _USER.match(username):
        raise HTTPException(400, "Usuario: 3 a 40 caracteres, solo letras, números, punto, guion y guion bajo.")
    if len(p.password) < 6:
        raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres.")
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(409, "Ese usuario ya existe.")
    u = models.User(
        username=username, password_hash=security.hash_password(p.password), role=p.role,
        full_name=p.full_name.strip(), email=p.email.strip(), phone=p.phone.strip(), cargo=p.cargo.strip(),
        active=p.active, valid_from=p.valid_from, valid_until=p.valid_until,
        daily_start=p.daily_start, daily_end=p.daily_end, permissions=_clean_perms(p.permissions),
        notes=p.notes, must_change_password=p.must_change_password,
    )
    db.add(u)
    db.commit()
    log_activity(db, actor, "usuario_creado", f"{username} ({p.role})")
    return _admin_row(u)


@router.put("/users/{user_id}")
def update_user(user_id: str, p: UserIn, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "El usuario no existe.")
    _validate(p)
    _may_manage(actor, u.role)
    _may_manage(actor, p.role)
    if u.id == actor.id:
        if not p.active:
            raise HTTPException(400, "No puedes desactivar tu propio usuario.")
        if p.role != u.role:
            raise HTTPException(400, "No puedes cambiar tu propio rol.")
    if u.role == "superadmin" and p.role != "superadmin":
        if db.query(models.User).filter(models.User.role == "superadmin", models.User.id != u.id, models.User.active == True).count() == 0:  # noqa: E712
            raise HTTPException(400, "Debe quedar al menos un superadmin activo.")
    new_name = p.username.strip().lower()
    if new_name and new_name != u.username:
        if not _USER.match(new_name):
            raise HTTPException(400, "Usuario: 3 a 40 caracteres, solo letras, números, punto, guion y guion bajo.")
        if db.query(models.User).filter(models.User.username == new_name, models.User.id != u.id).first():
            raise HTTPException(409, "Ese usuario ya existe.")
        u.username = new_name
    revoke = (not p.active and u.active) or p.role != u.role
    u.role, u.full_name, u.email, u.phone, u.cargo = p.role, p.full_name.strip(), p.email.strip(), p.phone.strip(), p.cargo.strip()
    u.active, u.valid_from, u.valid_until = p.active, p.valid_from, p.valid_until
    u.daily_start, u.daily_end = p.daily_start, p.daily_end
    u.permissions, u.notes = _clean_perms(p.permissions), p.notes
    if revoke:
        u.token_version = (u.token_version or 0) + 1
    db.commit()
    log_activity(db, actor, "usuario_editado", f"{u.username} ({u.role}, {'activo' if u.active else 'desactivado'})")
    return _admin_row(u)


class ResetIn(BaseModel):
    password: str = Field(min_length=6, max_length=100)
    must_change: bool = True


@router.post("/users/{user_id}/password")
def reset_password(user_id: str, p: ResetIn, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "El usuario no existe.")
    _may_manage(actor, u.role)
    u.password_hash = security.hash_password(p.password)
    u.must_change_password = p.must_change
    u.token_version = (u.token_version or 0) + 1
    db.commit()
    log_activity(db, actor, "password_restablecida", u.username)
    return {"ok": True}


@router.post("/users/{user_id}/logout")
def force_logout(user_id: str, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "El usuario no existe.")
    u.token_version = (u.token_version or 0) + 1
    db.commit()
    log_activity(db, actor, "sesion_cerrada_por_admin", u.username)
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "El usuario no existe.")
    _may_manage(actor, u.role)
    if u.id == actor.id:
        raise HTTPException(400, "No puedes eliminar tu propio usuario.")
    if ca.count_clients(db, u.id, include_deleted=True):
        raise HTTPException(409, "Tiene clientes asociados. Desactívalo en vez de eliminarlo (o reasigna sus clientes).")
    name = u.username
    db.delete(u)
    db.commit()
    log_activity(db, actor, "usuario_eliminado", name)
    return {"ok": True}


# ------------------------------ actividad ------------------------------

@router.get("/activity")
def activity(user_id: str = "", action: str = "", limit: int = 200, _: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    q = db.query(models.ActivityLog)
    if user_id:
        q = q.filter(models.ActivityLog.user_id == user_id)
    if action:
        q = q.filter(models.ActivityLog.action == action)
    rows = q.order_by(models.ActivityLog.at.desc()).limit(max(1, min(limit, 1000))).all()
    return [{"id": r.id, "user_id": r.user_id, "username": r.username, "action": r.action,
             "detail": r.detail, "client_id": r.client_id, "at": r.at.isoformat() + "Z"} for r in rows]


# ------------------------------ clientes de todos ------------------------------

@router.get("/clients")
def all_clients(user_id: str = "", month: str = "", year: int | None = None, q: str = "",
                deleted: bool = False, _: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    return ca.list_clients_out(db, None, user_id=user_id, month=month, year=year, q=q, deleted=deleted)


class AssocIn(BaseModel):
    user_ids: list[str] = Field(min_length=1)


@router.put("/clients/{client_id}/participants")
def set_participants(client_id: str, p: AssocIn, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    c = db.get(models.Client, client_id)
    if not c:
        raise HTTPException(404, "El cliente no existe.")
    ids = list(dict.fromkeys(p.user_ids))
    found = {u.id for u in db.query(models.User).filter(models.User.id.in_(ids)).all()}
    if len(found) != len(ids):
        raise HTTPException(400, "Algún usuario no existe.")
    db.query(models.ClientShare).filter(models.ClientShare.client_id == c.id).delete()
    for uid in ids:
        db.add(models.ClientShare(client_id=c.id, user_id=uid))
    if c.owner_id not in ids:
        c.owner_id = ids[0]
    c.updated_at = dt.datetime.utcnow()
    db.commit()
    log_activity(db, actor, "cliente_asociado", f"SOT {c.sot}: {len(ids)} participante(s)", c.id)
    return ca.client_out(db, c)


@router.put("/clients/{client_id}/restore")
def restore_client(client_id: str, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    c = db.get(models.Client, client_id)
    if not c:
        raise HTTPException(404, "El cliente no existe.")
    c.deleted_at, c.deleted_by = None, None
    db.commit()
    log_activity(db, actor, "cliente_restaurado", f"SOT {c.sot}", c.id)
    return ca.client_out(db, c)


@router.delete("/clients/{client_id}/purge")
def purge_client(client_id: str, actor: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    c = db.get(models.Client, client_id)
    if not c:
        raise HTTPException(404, "El cliente no existe.")
    sot = c.sot
    db.query(models.WorkspaceVersion).filter(models.WorkspaceVersion.client_id == c.id).delete()
    db.query(models.UserWorkspace).filter(models.UserWorkspace.client_id == c.id).delete()
    db.query(models.ClientShare).filter(models.ClientShare.client_id == c.id).delete()
    db.delete(c)
    db.commit()
    log_activity(db, actor, "cliente_eliminado_definitivo", f"SOT {sot}")
    return {"ok": True}

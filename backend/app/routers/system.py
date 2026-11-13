"""
system.py
Funciones solo del SUPERADMIN: estado del sistema, anuncio para todo el equipo, transferir el trabajo
de un usuario a otro, acciones masivas sobre usuarios, cerrar todas las sesiones, copia de seguridad
y exportación de la actividad. Nunca devuelve contraseñas ni claves (solo si están configuradas o no).
"""

import csv
import datetime as dt
import io
import json
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user, log_activity
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app.database import get_db
from app.services import security

router = APIRouter(tags=["sistema"])


def super_user(user: models.User = Depends(current_user)) -> models.User:
    if user.role != "superadmin":
        raise HTTPException(403, "Solo el superadmin puede hacer esto.")
    return user


def _now() -> dt.datetime:
    return dt.datetime.utcnow()


# ------------------------------ anuncio (lo ve todo el equipo) ------------------------------

@router.get("/api/announcement")
def announcement(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(models.AppSetting, "announcement")
    v = (row.value if row else None) or {}
    if not v.get("active") or not str(v.get("text", "")).strip():
        return {"active": False}
    return {"active": True, "text": v["text"], "level": v.get("level", "info"), "id": v.get("id", ""), "at": row.updated_at.isoformat() + "Z"}


class AnnouncementIn(BaseModel):
    text: str = Field(default="", max_length=600)
    level: str = "info"
    active: bool = True


@router.put("/api/admin/sistema/anuncio")
def set_announcement(p: AnnouncementIn, actor: models.User = Depends(super_user), db: Session = Depends(get_db)):
    if p.level not in ("info", "warn", "alert"):
        raise HTTPException(400, "Nivel no válido.")
    row = db.get(models.AppSetting, "announcement") or models.AppSetting(key="announcement")
    row.value = {"text": p.text.strip(), "level": p.level, "active": p.active and bool(p.text.strip()), "id": security.secrets.token_hex(4)}
    row.updated_at, row.updated_by = _now(), actor.username
    db.add(row)
    db.commit()
    log_activity(db, actor, "anuncio", ("publicado: " if row.value["active"] else "retirado: ") + p.text.strip()[:80])
    return {"ok": True, **row.value}


# ------------------------------ estado del sistema ------------------------------

def _dir_stats(path: str) -> dict:
    files = size = 0
    if path and os.path.isdir(path):
        for root, _, names in os.walk(path):
            for n in names:
                try:
                    size += os.path.getsize(os.path.join(root, n)); files += 1
                except OSError:
                    pass
    return {"files": files, "mb": round(size / 1e6, 1)}


@router.get("/api/admin/sistema/estado")
def estado(_: models.User = Depends(super_user), db: Session = Depends(get_db)):
    day = _now() - dt.timedelta(hours=24)
    users = db.query(models.User)
    roles = {r: n for r, n in db.query(models.User.role, func.count()).group_by(models.User.role).all()}
    env = lambda *k: any(bool(os.getenv(x, "").strip()) for x in k)  # noqa: E731
    disk = shutil.disk_usage(str(UPLOADS_DIR))
    return {
        "hora_servidor": security.app_now().isoformat(timespec="seconds"),
        "usuarios": {"total": users.count(), "activos": users.filter(models.User.active == True).count(), "roles": roles,  # noqa: E712
                     "conectados_24h": users.filter(models.User.last_login >= day).count()},
        "clientes": {"total": db.query(models.Client).filter(models.Client.deleted_at.is_(None)).count(),
                     "en_papelera": db.query(models.Client).filter(models.Client.deleted_at.isnot(None)).count(),
                     "ventanas_guardadas": db.query(models.UserWorkspace).count()},
        "actividad_24h": db.query(models.ActivityLog).filter(models.ActivityLog.at >= day).count(),
        "archivos": {"subidas": _dir_stats(str(UPLOADS_DIR)), "salidas": _dir_stats(str(OUTPUTS_DIR))},
        "disco": {"libre_gb": round(disk.free / 1e9, 1), "total_gb": round(disk.total / 1e9, 1)},
        "integraciones": {
            "Base de datos": env("DATABASE_URL"), "Redis": env("REDIS_URL"),
            "IA Gemini": env("GEMINI_API_KEY"), "IA Groq": env("GROQ_API_KEY"), "IA OpenRouter": env("OPENROUTER_API_KEY"),
            "IA Anthropic": env("ANTHROPIC_API_KEY"), "IA OpenAI": env("OPENAI_API_KEY"),
            "Telegram (archivos)": env("TELEGRAM_SESSION") and env("TELEGRAM_API_ID"), "Clave de sesión fija": env("AUTH_SECRET"),
        },
    }


# ------------------------------ transferir el trabajo de un usuario a otro ------------------------------

class TransferIn(BaseModel):
    from_id: str
    to_id: str
    deactivate_from: bool = False


@router.post("/api/admin/sistema/transferir")
def transferir(p: TransferIn, actor: models.User = Depends(super_user), db: Session = Depends(get_db)):
    """Pasa todos los clientes donde participa `from_id` a `to_id` (si ya estaba, no se duplica)."""
    if p.from_id == p.to_id:
        raise HTTPException(400, "Elige dos usuarios distintos.")
    a, b = db.get(models.User, p.from_id), db.get(models.User, p.to_id)
    if not a or not b:
        raise HTTPException(404, "Usuario no encontrado.")
    moved = 0
    for sh in db.query(models.ClientShare).filter(models.ClientShare.user_id == a.id).all():
        if db.get(models.ClientShare, (sh.client_id, b.id)):
            db.delete(sh)
        else:
            sh.user_id = b.id
        moved += 1
    db.query(models.Client).filter(models.Client.owner_id == a.id).update({"owner_id": b.id})
    if p.deactivate_from:
        a.active = False
        a.token_version = (a.token_version or 0) + 1
    db.commit()
    log_activity(db, actor, "trabajo_transferido", f"{a.username} → {b.username}: {moved} cliente(s)")
    return {"ok": True, "clientes": moved}


# ------------------------------ acciones masivas ------------------------------

class BulkIn(BaseModel):
    user_ids: list[str] = Field(min_length=1)
    action: str                    # activar | desactivar | cerrar_sesion | permiso
    feature: str = ""
    value: bool = True


@router.post("/api/admin/sistema/usuarios-masivo")
def masivo(p: BulkIn, actor: models.User = Depends(super_user), db: Session = Depends(get_db)):
    if p.action not in ("activar", "desactivar", "cerrar_sesion", "permiso"):
        raise HTTPException(400, "Acción no válida.")
    if p.action == "permiso" and p.feature not in security.FEATURES:
        raise HTTPException(400, "Función no válida.")
    n = 0
    for u in db.query(models.User).filter(models.User.id.in_(p.user_ids)).all():
        if u.id == actor.id and p.action in ("desactivar",):
            continue                                   # no se puede dejar sin acceso a sí mismo
        if p.action == "activar":
            u.active = True
        elif p.action == "desactivar":
            u.active = False; u.token_version = (u.token_version or 0) + 1
        elif p.action == "cerrar_sesion":
            u.token_version = (u.token_version or 0) + 1
        else:
            perms = dict(u.permissions or {}); perms[p.feature] = bool(p.value); u.permissions = perms
        n += 1
    db.commit()
    log_activity(db, actor, "usuarios_masivo", f"{p.action}{(' ' + p.feature) if p.feature else ''}: {n} usuario(s)")
    return {"ok": True, "usuarios": n}


@router.post("/api/admin/sistema/cerrar-sesiones")
def cerrar_todas(actor: models.User = Depends(super_user), db: Session = Depends(get_db)):
    """Cierra la sesión de todos (menos la tuya)."""
    n = 0
    for u in db.query(models.User).filter(models.User.id != actor.id).all():
        u.token_version = (u.token_version or 0) + 1; n += 1
    db.commit()
    log_activity(db, actor, "sesiones_cerradas_todas", f"{n} usuario(s)")
    return {"ok": True, "usuarios": n}


# ------------------------------ copia de seguridad y exportaciones ------------------------------

@router.get("/api/admin/sistema/respaldo")
def respaldo(actor: models.User = Depends(super_user), db: Session = Depends(get_db)):
    """JSON con usuarios (sin contraseñas), clientes, participantes y ventanas guardadas."""
    iso = lambda d: d.isoformat() + "Z" if d else None  # noqa: E731
    data = {
        "generado": _now().isoformat() + "Z", "por": actor.username,
        "usuarios": [{"id": u.id, "usuario": u.username, "rol": u.role, "nombre": u.full_name, "correo": u.email, "activo": u.active,
                      "permisos": u.permissions or {}, "vigencia": [u.valid_from, u.valid_until, u.daily_start, u.daily_end]}
                     for u in db.query(models.User).all()],
        "clientes": [{"id": c.id, "sot": c.sot, "nombre": c.nombre, "fecha": c.fecha, "cid": c.cid, "proy": c.proy, "contrata": c.contrata,
                      "datos": c.datos, "reportes": c.reportes, "owner": c.owner_id, "borrado": iso(c.deleted_at)}
                     for c in db.query(models.Client).all()],
        "participantes": [{"cliente": s.client_id, "usuario": s.user_id} for s in db.query(models.ClientShare).all()],
        "ventanas": [{"cliente": w.client_id, "clave": w.key, "etiqueta": w.label, "ruta": w.route, "estado": w.state, "actualizada": iso(w.updated_at)}
                     for w in db.query(models.UserWorkspace).all()],
    }
    log_activity(db, actor, "respaldo_descargado", f"{len(data['clientes'])} clientes")
    name = f"netops-respaldo-{_now().strftime('%Y%m%d-%H%M')}.json"
    return Response(json.dumps(data, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/api/admin/sistema/actividad.csv")
def actividad_csv(dias: int = 30, actor: models.User = Depends(super_user), db: Session = Depends(get_db)):
    since = _now() - dt.timedelta(days=max(1, min(dias, 365)))
    rows = db.query(models.ActivityLog).filter(models.ActivityLog.at >= since).order_by(models.ActivityLog.at.desc()).limit(50000).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["fecha_utc", "usuario", "accion", "detalle"])
    for r in rows:
        w.writerow([r.at.isoformat(sep=" ", timespec="seconds"), r.username, r.action, r.detail])
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="actividad-{dias}d.csv"'})

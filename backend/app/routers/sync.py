"""
sync.py
Sincronización offline-first: los dispositivos (web, Windows, Android) trabajan con su copia local y
envían/reciben cambios por aquí.

Reglas:
- Cada operación lleva un `op_id` (UUID del dispositivo): reenviarla no la aplica dos veces (idempotencia).
- Cada registro tiene `version`. Si el dispositivo editó sobre una versión vieja => `conflict`;
  nunca se sobrescribe en silencio. El usuario resuelve con /resolve.
- Solo se sincronizan clientes donde el usuario participa (mismos permisos que el resto de la API).
- Fechas en UTC (ISO 8601 con «Z»).

Entidades: `client`, `workspace` (id = "<client_id>|<key>") y `checklist_copy`. Las fotos van por /photos.
"""

import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user, log_activity
from app.config import UPLOADS_DIR
from app.database import get_db
from app.routers.clients import norm_fecha, norm_sot, _snapshot
from app.services import client_access as ca, diagram_vars, filestore, reference_sync, security

router = APIRouter(prefix="/api/sync", tags=["sync"])

ENTITIES = ("client", "workspace", "checklist_copy")
MAX_OPS = 200
MAX_STATE = 3_000_000
PHOTO_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_PHOTO = 15 * 1024 * 1024
UUID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def iso(d: Optional[dt.datetime]) -> str:
    return (d.isoformat() + "Z") if d else ""


def parse_iso(s: str) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "Fecha inválida (usa ISO 8601 en UTC).")
    return d.astimezone(dt.timezone.utc).replace(tzinfo=None) if d.tzinfo else d


# ------------------------------------------------------------------ serializadores
def client_data(c: models.Client) -> dict:
    return {"sot": c.sot, "nombre": c.nombre, "fecha": c.fecha, "cid": c.cid, "proy": c.proy,
            "contrata": c.contrata, "datos": c.datos or {}, "reportes": c.reportes or []}


def ws_id(client_id: str, key: str) -> str:
    return f"{client_id}|{key}"


def ws_data(w: models.UserWorkspace) -> dict:
    return {"client_id": w.client_id, "key": w.key, "label": w.label, "route": w.route, "state": w.state or {}}


def ck_data(c: models.ChecklistUserCopy) -> dict:
    return {"tpl_id": c.tpl_id, "nombre": c.nombre, "data": c.data or {}}


def _item(entity: str, eid: str, version: int, upd: Optional[dt.datetime], data: dict, deleted: bool = False) -> dict:
    return {"entity": entity, "id": eid, "version": version or 1, "updated_at": iso(upd), "deleted": deleted, "data": data}


def client_item(c: models.Client) -> dict:
    return _item("client", c.id, c.version, c.updated_at, client_data(c), bool(c.deleted_at))


def ws_item(w: models.UserWorkspace) -> dict:
    return _item("workspace", ws_id(w.client_id, w.key), w.version, w.updated_at, ws_data(w))


def ck_item(c: models.ChecklistUserCopy) -> dict:
    return _item("checklist_copy", c.id, c.version, c.updated_at, ck_data(c))


# ------------------------------------------------------------------ push
class OpIn(BaseModel):
    op_id: str = Field(min_length=8, max_length=64)
    entity: str
    entity_id: str = Field(min_length=1, max_length=200)
    action: str = "upsert"                  # upsert | delete
    base_version: Optional[int] = None      # versión que tenía el dispositivo (None = lo creó el dispositivo)
    data: dict = {}
    force: bool = False                     # el usuario ya decidió reemplazar (resolución de conflicto)


class PushIn(BaseModel):
    device_id: str = Field(default="", max_length=64)
    ops: list[OpIn] = Field(max_length=MAX_OPS)


def _res(op: OpIn, status: str, **kw: Any) -> dict:
    return {"op_id": op.op_id, "entity": op.entity, "entity_id": op.entity_id, "status": status, **kw}


def _conflict(op: OpIn, server_item: dict, reason: str = "version") -> dict:
    return _res(op, "conflict", reason=reason, server=server_item, version=server_item["version"])


def _apply_client(db: Session, user: models.User, op: OpIn) -> dict:
    row = db.get(models.Client, op.entity_id)
    d = op.data or {}
    if op.action == "delete":
        if not row or not ca.can_access(db, user, row):
            return _res(op, "applied", version=0, note="ya no existe")
        if not op.force and op.base_version is not None and op.base_version != row.version:
            return _conflict(op, client_item(row))
        row.deleted_at, row.deleted_by = dt.datetime.utcnow(), user.username
        db.flush()
        return _res(op, "applied", version=row.version)
    sot = norm_sot(str(d.get("sot", "")))
    if not sot:
        return _res(op, "rejected", error="La SOT es obligatoria.")
    if row is None:
        if not UUID_RE.match(op.entity_id):
            return _res(op, "rejected", error="Identificador inválido.")
        dup = ca.find_by_sot(db, user, sot, include_deleted=True)
        if dup:
            return _conflict(op, client_item(dup), reason="duplicate_sot")
        row = models.Client(id=op.entity_id, sot=sot, datos={}, reportes=[], owner_id=user.id, version=1)
        db.add(row)
        db.flush()
        ca.add_participant(db, row.id, user.id)
    else:
        if not ca.can_access(db, user, row):
            return _res(op, "rejected", error="No tienes acceso a este cliente.")
        if not op.force and op.base_version != row.version:
            return _conflict(op, client_item(row))
        other = ca.find_by_sot(db, user, sot)
        if other and other.id != row.id:
            return _conflict(op, client_item(other), reason="duplicate_sot")
        row.sot = sot
        row.deleted_at = row.deleted_by = None
    row.nombre = str(d.get("nombre", "")).strip()
    row.cid = str(d.get("cid", "")).strip()
    row.proy = str(d.get("proy", "")).strip()
    row.contrata = str(d.get("contrata", "")).strip()
    row.fecha = norm_fecha(str(d.get("fecha", ""))) or row.fecha or dt.date.today().isoformat()
    row.datos = {str(k).strip()[:40]: str(v)[:300] for k, v in (d.get("datos") or {}).items() if str(k).strip()}
    diagram_vars.ensure_variables(db, row.datos)
    inc = d.get("reportes")
    if isinstance(inc, list):   # el historial de reportes solo crece: se unen los de ambos lados por nombre de archivo
        have = {r.get("filename"): r for r in (row.reportes or [])}
        for r in inc:
            if isinstance(r, dict) and r.get("filename") and r["filename"] not in have:
                have[r["filename"]] = {k: str(v)[:300] for k, v in r.items() if k in ("tipo", "nombre", "filename", "url", "utc", "generado", "por")}
        row.reportes = list(have.values())[-150:]
    db.flush()
    return _res(op, "applied", version=row.version + (1 if db.is_modified(row) else 0), server_id=row.id)


def _apply_workspace(db: Session, user: models.User, op: OpIn) -> dict:
    cid, _, key = op.entity_id.partition("|")
    row = db.get(models.Client, cid)
    if not row or not ca.can_access(db, user, row):
        return _res(op, "rejected", error="No tienes acceso a este cliente.")
    w = db.get(models.UserWorkspace, (cid, key))
    if op.action == "delete":
        if w:
            if not op.force and op.base_version is not None and op.base_version != w.version:
                return _conflict(op, ws_item(w))
            db.delete(w)
        return _res(op, "applied", version=0)
    d = op.data or {}
    state = d.get("state")
    if not isinstance(state, dict) or not key:
        return _res(op, "rejected", error="Datos de ventana inválidos.")
    new_n = len(json.dumps(state))
    if new_n > MAX_STATE:
        return _res(op, "rejected", error="Los datos de la ventana son demasiado grandes.")
    if w is None:
        w = models.UserWorkspace(client_id=cid, key=key, state={}, version=1)
        db.add(w)
    else:
        if not op.force and op.base_version != w.version:
            return _conflict(op, ws_item(w))
        old_n = len(json.dumps(w.state or {}))
        if old_n > 1500 and new_n < old_n * 0.5 and not op.force:
            return _conflict(op, ws_item(w), reason="shrink")
        _snapshot(db, cid, w, user, force=op.force or new_n < old_n * 0.8)
    w.label, w.route, w.state = str(d.get("label", ""))[:120], str(d.get("route", ""))[:300], state
    w.updated_by = user.username
    db.flush()
    return _res(op, "applied", version=(w.version or 1) + (1 if db.is_modified(w) else 0))


def _apply_checklist(db: Session, user: models.User, op: OpIn) -> dict:
    c = db.get(models.ChecklistUserCopy, op.entity_id)
    if c and c.user_id != user.id:
        return _res(op, "rejected", error="No tienes acceso a esta copia.")
    if op.action == "delete":
        if c:
            if not op.force and op.base_version is not None and op.base_version != c.version:
                return _conflict(op, ck_item(c))
            db.delete(c)
        return _res(op, "applied", version=0)
    d = op.data or {}
    if not d.get("tpl_id") or not isinstance(d.get("data"), dict):
        return _res(op, "rejected", error="Datos de CheckList inválidos.")
    if c is None:
        if not UUID_RE.match(op.entity_id):
            return _res(op, "rejected", error="Identificador inválido.")
        c = models.ChecklistUserCopy(id=op.entity_id, user_id=user.id, tpl_id=str(d["tpl_id"]), nombre="", data={}, version=1)
        db.add(c)
    elif not op.force and op.base_version != c.version:
        return _conflict(op, ck_item(c))
    c.nombre, c.data = str(d.get("nombre", ""))[:200], d["data"]
    db.flush()
    return _res(op, "applied", version=(c.version or 1) + (1 if db.is_modified(c) else 0))


_APPLY = {"client": _apply_client, "workspace": _apply_workspace, "checklist_copy": _apply_checklist}


def _process(db: Session, user: models.User, device: str, op: OpIn) -> dict:
    """Una operación = una transacción: si falla, solo ella se revierte y las demás siguen."""
    prev = db.get(models.SyncOp, op.op_id)
    if prev:
        if prev.user_id != user.id:
            return _res(op, "rejected", error="Operación ajena.")
        if prev.status in ("applied", "rejected"):
            return {**(prev.result or {}), "replayed": True}   # reintento: se devuelve lo ya decidido
        # conflict/error: se vuelve a evaluar (el usuario pudo resolverlo)
    if op.entity not in ENTITIES or op.action not in ("upsert", "delete"):
        return _res(op, "rejected", error="Operación no soportada.")
    try:
        res = _APPLY[op.entity](db, user, op)
        # la versión final real se lee tras el commit
        log = prev or models.SyncOp(op_id=op.op_id, user_id=user.id)
        log.device_id, log.entity, log.entity_id, log.action = device, op.entity, op.entity_id, op.action
        log.base_version, log.status, log.result, log.error = op.base_version, res["status"], res, res.get("error")
        if not prev:
            db.add(log)
        db.commit()
        if res["status"] == "applied" and op.action == "upsert":
            res["version"] = _current_version(db, op)
            log.result = dict(res)
            db.commit()
        return res
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:  # noqa: BLE001
        db.rollback()
        res = _res(op, "error", error=f"{type(e).__name__}: {str(e)[:200]}")
        try:
            db.add(models.SyncOp(op_id=op.op_id, user_id=user.id, device_id=device, entity=op.entity, entity_id=op.entity_id,
                                 action=op.action, base_version=op.base_version, status="error", result=res, error=res["error"]))
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
        return res


def _current_version(db: Session, op: OpIn) -> int:
    if op.entity == "client":
        r = db.get(models.Client, op.entity_id)
    elif op.entity == "workspace":
        cid, _, key = op.entity_id.partition("|")
        r = db.get(models.UserWorkspace, (cid, key))
    else:
        r = db.get(models.ChecklistUserCopy, op.entity_id)
    return (r.version if r else 0) or 1


@router.post("/push")
def push(payload: PushIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Aplica en orden las operaciones del dispositivo. Responde una por una: applied | conflict | rejected | error."""
    results = [_process(db, user, payload.device_id, op) for op in payload.ops]
    return {"results": results, "server_time": iso(dt.datetime.utcnow())}


# ------------------------------------------------------------------ pull / changes
def _visible_client_ids(db: Session, user: models.User):
    q = db.query(models.ClientShare.client_id).filter(models.ClientShare.user_id == user.id)
    return q


def _after(col, idcol, since: Optional[dt.datetime], cur_id: str):
    if since is None:
        return None
    if not cur_id:
        return col > since
    # «>=» en el empate: si dos registros comparten la misma hora no se salta ninguno (repetir uno es inofensivo: es idempotente)
    return or_(col > since, and_(col == since, idcol >= cur_id))


@router.get("/pull")
def pull(entity: str, since: str = "", cursor: str = "", limit: int = 100,
         user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Cambios de una entidad posteriores a `since` (UTC), paginados con cursor «<fecha>|<id>»."""
    if entity not in ENTITIES:
        raise HTTPException(400, "Entidad desconocida.")
    limit = max(2, min(limit, 200))
    ts, cid = (cursor.split("|", 1) + [""])[:2] if cursor else (since, "")
    after = parse_iso(ts)
    now = dt.datetime.utcnow()
    if entity == "client":
        q = db.query(models.Client).filter(models.Client.id.in_(_visible_client_ids(db, user)))
        col, idc, mk = models.Client.updated_at, models.Client.id, client_item
    elif entity == "workspace":
        q = db.query(models.UserWorkspace).filter(models.UserWorkspace.client_id.in_(_visible_client_ids(db, user)))
        col, idc, mk = models.UserWorkspace.updated_at, models.UserWorkspace.client_id, ws_item
    else:
        q = db.query(models.ChecklistUserCopy).filter(models.ChecklistUserCopy.user_id == user.id)
        col, idc, mk = models.ChecklistUserCopy.updated_at, models.ChecklistUserCopy.id, ck_item
    cond = _after(col, idc, after, cid)
    if cond is not None:
        q = q.filter(cond)
    rows = q.order_by(col, idc).limit(limit + 1).all()
    more = len(rows) > limit
    rows = rows[:limit]
    items = [mk(r) for r in rows]
    nxt = ""
    if more and rows:
        last = rows[-1]
        nxt = f"{iso(last.updated_at)}|{last.id if entity != 'workspace' else last.client_id}"
    return {"items": items, "next_cursor": nxt, "server_time": iso(now)}


@router.get("/changes")
def changes(since: str = "", user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Consulta ligera: cuántos registros cambiaron desde `since` (para saber si hace falta descargar)."""
    after = parse_iso(since)
    ids = _visible_client_ids(db, user)
    qc = db.query(models.Client).filter(models.Client.id.in_(ids))
    qw = db.query(models.UserWorkspace).filter(models.UserWorkspace.client_id.in_(ids))
    qk = db.query(models.ChecklistUserCopy).filter(models.ChecklistUserCopy.user_id == user.id)
    if after:
        qc, qw, qk = (qc.filter(models.Client.updated_at > after), qw.filter(models.UserWorkspace.updated_at > after),
                      qk.filter(models.ChecklistUserCopy.updated_at > after))
    n = {"client": qc.count(), "workspace": qw.count(), "checklist_copy": qk.count()}
    return {"counts": n, "total": sum(n.values()), "server_time": iso(dt.datetime.utcnow())}


# ------------------------------------------------------------------ resolver conflictos
class ResolveIn(BaseModel):
    op: OpIn
    resolution: str                      # mine | theirs


@router.post("/resolve")
def resolve(payload: ResolveIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """
    mine   -> se aplica lo del dispositivo encima (lo anterior queda en copias anteriores en las ventanas).
    theirs -> se descarta lo del dispositivo y se devuelve lo del servidor para que lo adopte.
    """
    op = payload.op
    if payload.resolution == "mine":
        op = op.model_copy(update={"force": True, "op_id": op.op_id})
        res = _process(db, user, "", op)
        log_activity(db, user, "sync_conflicto_resuelto", f"{op.entity} {op.entity_id}: mine")
        return res
    if payload.resolution != "theirs":
        raise HTTPException(400, "Resolución inválida.")
    if op.entity == "client":
        r = db.get(models.Client, op.entity_id)
        item = client_item(r) if r and ca.can_access(db, user, r) else None
    elif op.entity == "workspace":
        cid, _, key = op.entity_id.partition("|")
        c = db.get(models.Client, cid)
        w = db.get(models.UserWorkspace, (cid, key)) if c and ca.can_access(db, user, c) else None
        item = ws_item(w) if w else None
    else:
        r = db.get(models.ChecklistUserCopy, op.entity_id)
        item = ck_item(r) if r and r.user_id == user.id else None
    prev = db.get(models.SyncOp, op.op_id)
    if prev:
        prev.status, prev.error = "rejected", "descartada por el usuario (se adoptó lo del servidor)"
        prev.result = _res(op, "rejected", error=prev.error)
        db.commit()
    return {"op_id": op.op_id, "status": "adopted", "server": item}


# ------------------------------------------------------------------ fotos
def _photo_name(client_uuid: str, ext: str) -> str:
    return f"{client_uuid}{ext}"


@router.post("/photos")
async def push_photo(
    file: UploadFile = File(...),
    photo_id: str = Form(..., description="UUID de la foto generado en el dispositivo (idempotencia)"),
    sha256: str = Form("", description="Huella calculada en el dispositivo para verificar la recepción"),
    user: models.User = Depends(current_user),
):
    """
    Sube una foto una sola vez: el nombre en el servidor sale de `photo_id`, así que reenviarla (tras perder
    la conexión) devuelve la misma referencia sin duplicar. Se verifica la huella y se responde con ella.
    """
    if not UUID_RE.match(photo_id):
        raise HTTPException(400, "photo_id inválido.")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in PHOTO_EXT:
        raise HTTPException(400, f"Extensión no permitida: {ext}")
    content = await file.read()
    if len(content) > MAX_PHOTO:
        raise HTTPException(413, "La imagen pesa demasiado (máximo 15 MB).")
    digest = hashlib.sha256(content).hexdigest()
    if sha256 and sha256.lower() != digest:
        raise HTTPException(422, "La foto llegó dañada (huella distinta): se reintenta.")
    name = _photo_name(photo_id, ext)
    dest = UPLOADS_DIR / name
    existed = dest.is_file()
    if not existed:
        dest.write_bytes(content)
    await run_in_threadpool(filestore.save_upload, name, content)  # copia durable en la base de datos
    return {"photo_id": photo_id, "path": name, "url": f"/api/files/uploads/{name}", "sha256": digest,
            "size": len(content), "duplicate": existed}


@router.get("/photos/{photo_id}")
def photo_status(photo_id: str, user: models.User = Depends(current_user)):
    """¿Ya está esta foto en el servidor? (para verificar la recepción antes de liberar la copia local)."""
    if not UUID_RE.match(photo_id):
        raise HTTPException(400, "photo_id inválido.")
    for ext in PHOTO_EXT:
        p = filestore.ensure_upload(_photo_name(photo_id, ext))
        if p and p.is_file():
            return {"photo_id": photo_id, "path": p.name, "url": f"/api/files/uploads/{p.name}",
                    "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "size": p.stat().st_size}
    raise HTTPException(404, "La foto aún no está en el servidor.")


# ------------------------------------------------------------------ archivos generados (PDF/ZIP/Word...)
SAFE_OUT = re.compile(r"^[^/\\\x00-\x1f]{1,200}$")


@router.post("/outputs")
async def push_output(file: UploadFile = File(...), name: str = Form(...), user: models.User = Depends(current_user)):
    """Sube un archivo generado en el equipo sin conexión para que quede también en el servidor. Reintentar es seguro."""
    from app.config import OUTPUTS_DIR
    if not SAFE_OUT.match(name or "") or name.startswith(".") or ".." in name:
        raise HTTPException(400, "Nombre de archivo inválido.")
    content = await file.read()
    if len(content) > 60 * 1024 * 1024:
        raise HTTPException(413, "El archivo es demasiado grande.")
    dest = OUTPUTS_DIR / name
    dest.write_bytes(content)
    await run_in_threadpool(filestore.save_output, dest, False)
    return {"name": name, "sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}


class ReferenceIn(BaseModel):
    have: dict = Field(default_factory=dict)   # {tabla: huella} de lo que el dispositivo ya tiene


class ReferencePushIn(BaseModel):
    table: str
    upserts: list[dict] = Field(default_factory=list, max_length=60)
    deletes: list[str] = Field(default_factory=list, max_length=500)


@router.post("/reference/push")
def reference_push(p: ReferencePushIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Escritorio -> nube: lo que un administrador cambió en catálogos, diseños, logos y ajustes (solo las filas que cambiaron)."""
    if not security.is_admin(user) or (p.table == "app_settings" and user.role != "superadmin"):
        raise HTTPException(403, "Solo un administrador puede cambiar esto.")
    if p.table not in reference_sync.PUSHABLE:
        raise HTTPException(400, "Tabla no permitida.")
    try:
        res = reference_sync.apply_push(db, p.table, p.upserts, p.deletes)
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise HTTPException(400, f"No se pudo aplicar: {type(e).__name__}: {str(e)[:160]}")
    log_activity(db, user, "sync_referencia", f"{p.table}: {res['upserts']} cambios, {res['deletes']} borrados")
    return res


@router.post("/reference")
def reference(p: ReferenceIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Cuentas, logos, iconos, catálogos, diseños y ajustes de la nube (solo lo que cambió). Solo lectura."""
    return {"tables": reference_sync.snapshot(db, user, p.have)}

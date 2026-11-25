"""
cloud.py — solo app de escritorio: estado de la sincronización con la nube, «sincronizar ahora» y resolución
de conflictos. La lógica está en services/cloud_sync.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user
from app.database import get_db
from app.routers.local_tools import DESKTOP
from app.services import client_access as ca
from app.services import cloud_sync as cs

router = APIRouter(prefix="/api/cloud", tags=["nube"])


def _status(db: Session, user: models.User) -> dict:
    if not DESKTOP:
        return {"enabled": False}
    cfg = cs.load_cfg()
    linked = cfg.get("user_id") == user.id and bool(cfg.get("token"))
    items = cs.conflicts(db, user) if linked else []
    return {"enabled": True, "url": cs.cloud_url(), "linked": linked, "state": cs.STATE["state"] if linked else "unlinked", "running": bool(cs.STATE.get("running")),
            "last_sync": cs.STATE.get("last_sync", ""), "error": cs.STATE.get("error", ""),
            "pending": cs.pending_count(db) if linked else 0, "conflicts": items,
            "paused": bool(cfg.get("paused")), "user": user.username, "linked_users": sorted((cfg.get("linked") or {}).keys()),
            "sent": cs.STATE.get("sent", 0), "received": cs.STATE.get("received", 0),
            "local": {"clients": ca.count_clients(db, user.id)}}


@router.get("/status")
def status(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return _status(db, user)


@router.post("/sync")
def sync_now(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if not DESKTOP:
        raise HTTPException(404, "No disponible.")
    cs.sync_once(force=True)
    return _status(db, user)


class PauseIn(BaseModel):
    paused: bool


@router.post("/pause")
def pause(p: PauseIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Enciende o apaga la sincronización automática con la nube."""
    if not DESKTOP:
        raise HTTPException(404, "No disponible.")
    cs.set_paused(p.paused)
    return _status(db, user)


@router.post("/repair")
def repair(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Vuelve a comparar todo con la nube desde cero."""
    if not DESKTOP:
        raise HTTPException(404, "No disponible.")
    cs.repair()
    return _status(db, user)


class ResolveIn(BaseModel):
    entity: str
    id: str
    resolution: str   # mine | theirs


@router.post("/resolve")
def resolve(p: ResolveIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if not DESKTOP:
        raise HTTPException(404, "No disponible.")
    try:
        cs.resolve(db, user, p.entity, p.id, p.resolution)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except (cs.Offline, cs.NeedLogin):
        raise HTTPException(503, "Sin conexión con la nube: inténtalo cuando haya Internet.")
    cs.sync_once()
    return _status(db, user)

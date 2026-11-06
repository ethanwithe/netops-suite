"""
agenda.py
Agenda personal: recordatorios, tareas y eventos. Cada usuario ve solo lo suyo.
Bit (la mascota) los crea por conversación y avisa cuando llega la hora.
"""

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user
from app.database import get_db

router = APIRouter(prefix="/api/agenda", tags=["agenda"])

KINDS = {"recordatorio", "tarea", "evento"}
MAX_ITEMS = 500


def out(i: models.AgendaItem) -> dict:
    return {"id": i.id, "kind": i.kind, "title": i.title, "notes": i.notes, "done": bool(i.done),
            "due_at": i.due_at.replace(tzinfo=dt.timezone.utc).isoformat() if i.due_at else None,
            "created_at": i.created_at.replace(tzinfo=dt.timezone.utc).isoformat() if i.created_at else None}


def parse_due(value: Optional[str]) -> Optional[dt.datetime]:
    """ISO con zona (o sin ella = UTC) -> UTC sin zona."""
    if not value:
        return None
    try:
        d = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "La fecha y hora no son válidas.")
    if d.tzinfo:
        d = d.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return d


class ItemIn(BaseModel):
    kind: str = "recordatorio"
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=2000)
    due_at: Optional[str] = None


class ItemPatch(BaseModel):
    kind: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=2000)
    due_at: Optional[str] = None
    clear_due: bool = False
    done: Optional[bool] = None


def create_item(db: Session, user_id: str, kind: str, title: str, due: Optional[dt.datetime], notes: str = "") -> models.AgendaItem:
    if db.query(models.AgendaItem).filter(models.AgendaItem.user_id == user_id).count() >= MAX_ITEMS:
        raise HTTPException(400, "Tu agenda está llena; borra lo que ya no uses.")
    it = models.AgendaItem(user_id=user_id, kind=kind if kind in KINDS else "recordatorio", title=title.strip()[:200], notes=notes[:2000], due_at=due)
    db.add(it)
    db.commit()
    return it


@router.get("")
def list_items(done: Optional[bool] = None, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(models.AgendaItem).filter(models.AgendaItem.user_id == user.id)
    if done is not None:
        q = q.filter(models.AgendaItem.done == done)
    rows = q.order_by(models.AgendaItem.due_at.is_(None), models.AgendaItem.due_at, models.AgendaItem.created_at).limit(MAX_ITEMS).all()
    return [out(i) for i in rows]


@router.post("")
def add_item(p: ItemIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if p.kind not in KINDS:
        raise HTTPException(400, "Tipo no válido.")
    return out(create_item(db, user.id, p.kind, p.title, parse_due(p.due_at), p.notes))


@router.get("/due")
def due_now(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Lo que ya venció y aún no se avisó. Se marca como avisado al entregarlo."""
    now = dt.datetime.utcnow()
    rows = (db.query(models.AgendaItem)
            .filter(models.AgendaItem.user_id == user.id, models.AgendaItem.done == False,  # noqa: E712
                    models.AgendaItem.notified == False, models.AgendaItem.due_at.isnot(None),  # noqa: E712
                    models.AgendaItem.due_at <= now)
            .order_by(models.AgendaItem.due_at).limit(20).all())
    for i in rows:
        i.notified = True
    db.commit()
    return [out(i) for i in rows]


def _mine(db: Session, user: models.User, item_id: str) -> models.AgendaItem:
    i = db.get(models.AgendaItem, item_id)
    if not i or i.user_id != user.id:
        raise HTTPException(404, "No existe.")
    return i


@router.put("/{item_id}")
def edit_item(item_id: str, p: ItemPatch, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    i = _mine(db, user, item_id)
    if p.kind is not None:
        if p.kind not in KINDS:
            raise HTTPException(400, "Tipo no válido.")
        i.kind = p.kind
    if p.title is not None:
        i.title = p.title.strip()
    if p.notes is not None:
        i.notes = p.notes
    if p.clear_due:
        i.due_at, i.notified = None, False
    elif p.due_at is not None:
        i.due_at, i.notified = parse_due(p.due_at), False
    if p.done is not None:
        i.done = p.done
    db.commit()
    return out(i)


@router.delete("/{item_id}")
def delete_item(item_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_mine(db, user, item_id))
    db.commit()
    return {"ok": True}

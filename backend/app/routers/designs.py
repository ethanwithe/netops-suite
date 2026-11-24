"""
designs.py
Diseño base «para todos» del Reporte fotográfico: el superadmin fija las secciones, títulos, bloques y descripciones
(sin fotos) y todos parten de ahí / pueden «Restaurar diseño base». Lo personal de cada usuario no se toca.
"""
import datetime as dt
import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user
from app.database import get_db

router = APIRouter(prefix="/api/designs", tags=["diseños"])

TIPO_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_BYTES = 2_000_000


class RfBaseIn(BaseModel):
    sections: list[dict] = Field(max_length=40)
    opciones: list[dict] = Field(default_factory=list, max_length=60)


def _key(tipo: str) -> str:
    if not TIPO_RE.match(tipo):
        raise HTTPException(400, "Tipo de reporte inválido.")
    return f"rf_base:{tipo}"


def _clean_sections(sections: list[dict]) -> list[dict]:
    """Solo estructura: título (lado), bloque y descripción de cada celda. Nunca fotos."""
    out = []
    for s in sections:
        cells = []
        for c in (s.get("cells") or [])[:400]:
            if isinstance(c, dict):
                cells.append({"descripcion": str(c.get("descripcion", ""))[:300], "bloque": str(c.get("bloque") or "")[:120]})
        out.append({"lado": str(s.get("lado", ""))[:80], "cells": cells})
    return out


def _clean_opciones(opciones: list[dict]) -> list[dict]:
    seen, out = set(), []
    for o in opciones:
        oid, label = str(o.get("id", "")).strip()[:40], str(o.get("label", "")).strip()[:120]
        if oid and label and oid not in seen:
            seen.add(oid)
            out.append({"id": oid, "label": label})
    return out


@router.get("/rf/{tipo}")
def get_rf_base(tipo: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(models.AppSetting, _key(tipo))
    if not row or not isinstance(row.value, dict) or not row.value.get("sections"):
        return {"base": None}
    return {"base": row.value, "updated_at": (row.updated_at.isoformat() + "Z") if row.updated_at else "", "by": row.updated_by or ""}


@router.put("/rf/{tipo}")
def put_rf_base(tipo: str, body: RfBaseIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != "superadmin":
        raise HTTPException(403, "Solo el superadmin puede fijar el diseño base.")
    value = {"sections": _clean_sections(body.sections), "opciones": _clean_opciones(body.opciones)}
    if not value["sections"]:
        raise HTTPException(400, "El diseño base necesita al menos una sección.")
    if len(json.dumps(value)) > MAX_BYTES:
        raise HTTPException(413, "El diseño es demasiado grande.")
    key = _key(tipo)
    row = db.get(models.AppSetting, key) or models.AppSetting(key=key, value={})
    row.value, row.updated_at, row.updated_by = value, dt.datetime.utcnow(), user.username
    db.add(row)
    db.commit()
    return {"base": value}


@router.delete("/rf/{tipo}")
def delete_rf_base(tipo: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != "superadmin":
        raise HTTPException(403, "Solo el superadmin puede quitar el diseño base.")
    row = db.get(models.AppSetting, _key(tipo))
    if row:
        db.delete(row)
        db.commit()
    return {"base": None}


# ------------------------------------------------------------------ nombres de la interfaz (menú, ventanas de fábrica...)
LABELS_KEY = "ui_labels"
LABEL_KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


class UiLabelIn(BaseModel):
    key: str
    label: str = ""      # vacío = volver al nombre de fábrica


def _labels(db: Session) -> dict:
    row = db.get(models.AppSetting, LABELS_KEY)
    return dict(row.value) if row and isinstance(row.value, dict) else {}


@router.get("/labels")
def get_ui_labels(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return {"labels": _labels(db)}


@router.put("/labels")
def put_ui_label(body: UiLabelIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != "superadmin":
        raise HTTPException(403, "Solo el superadmin puede cambiar los nombres.")
    if not LABEL_KEY_RE.match(body.key):
        raise HTTPException(400, "Nombre interno inválido.")
    labels = _labels(db)
    text = body.label.strip()[:80]
    if text:
        labels[body.key] = text
    else:
        labels.pop(body.key, None)
    row = db.get(models.AppSetting, LABELS_KEY) or models.AppSetting(key=LABELS_KEY, value={})
    row.value, row.updated_at, row.updated_by = labels, dt.datetime.utcnow(), user.username
    db.add(row)
    db.commit()
    return {"labels": labels}

"""
diagrams.py
Ventana Gráfica: biblioteca de iconos (compartida), exportar el diagrama a PPTX editable y a PDF.
El diagrama en sí se guarda con el cliente (ventanas guardadas por SOT), no aquí.
"""

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user, log_activity
from app.database import get_db
from app.services import filestore, security
from app.services.diagram_pptx import build_pptx

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])

OK_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_ICON = 4_000_000


def _out(i: models.DiagramIcon, me: models.User) -> dict:
    return {"id": i.id, "name": i.name, "categoria": i.categoria, "builtin": i.builtin,
            "mine": i.owner_id == me.id, "url": f"/api/diagrams/icons/{i.id}/image"}


@router.get("/icons")
def list_icons(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(models.DiagramIcon).order_by(models.DiagramIcon.categoria, models.DiagramIcon.name).all()
    return [_out(i, user) for i in rows]


@router.get("/icons/{icon_id}/image")
def icon_image(icon_id: str, _: models.User = Depends(current_user), db: Session = Depends(get_db)):
    i = db.get(models.DiagramIcon, icon_id)
    if not i:
        raise HTTPException(404, "El icono no existe.")
    return Response(content=i.data, media_type=i.content_type, headers={"Cache-Control": "private, max-age=3600"})


@router.post("/icons")
async def upload_icon(file: UploadFile = File(...), name: str = Form(""), categoria: str = Form("Mis iconos"),
                      user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    data = await file.read()
    ctype = (file.content_type or "").lower()
    if ctype not in OK_TYPES:
        raise HTTPException(400, "Sube una imagen PNG, JPG, WEBP o GIF (mejor PNG con fondo transparente).")
    if len(data) > MAX_ICON:
        raise HTTPException(413, "El icono pesa demasiado (máximo 4 MB).")
    label = (name.strip() or (file.filename or "Icono").rsplit(".", 1)[0])[:80]
    i = models.DiagramIcon(id=uuid.uuid4().hex, name=label, categoria=(categoria.strip() or "Mis iconos")[:40],
                           content_type=ctype, data=data, builtin=False, owner_id=user.id)
    db.add(i)
    db.commit()
    log_activity(db, user, "icono_subido", label)
    return _out(i, user)


class IconPatch(BaseModel):
    name: str = ""
    categoria: str = ""


def _own(db: Session, user: models.User, icon_id: str) -> models.DiagramIcon:
    i = db.get(models.DiagramIcon, icon_id)
    if not i:
        raise HTTPException(404, "El icono no existe.")
    if not (security.is_admin(user) or i.owner_id == user.id):
        raise HTTPException(403, "Solo quien lo subió o un administrador puede cambiarlo.")
    return i


@router.put("/icons/{icon_id}")
def rename_icon(icon_id: str, p: IconPatch, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    i = _own(db, user, icon_id)
    if p.name.strip():
        i.name = p.name.strip()[:80]
    if p.categoria.strip():
        i.categoria = p.categoria.strip()[:40]
    db.commit()
    return _out(i, user)


@router.delete("/icons/{icon_id}")
def delete_icon(icon_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    i = _own(db, user, icon_id)
    if i.builtin and not security.is_admin(user):
        raise HTTPException(403, "Los iconos que vienen con el sistema solo los borra un administrador.")
    db.delete(i)
    db.commit()
    return {"ok": True}


class ExportIn(BaseModel):
    doc: dict
    filename: str = "diagrama"


def _safe(n: str) -> str:
    import re
    return re.sub(r"[^A-Za-z0-9._-]+", "_", n).strip("_") or "diagrama"


@router.post("/pptx")
def export_pptx(p: ExportIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    cache: dict[str, bytes | None] = {}

    def load(icon_id: str):
        if icon_id not in cache:
            row = db.get(models.DiagramIcon, icon_id)
            cache[icon_id] = row.data if row else None
        return cache[icon_id]

    try:
        data = build_pptx(p.doc, load)
    except Exception as e:  # datos del editor mal formados
        raise HTTPException(400, f"No se pudo armar el PPTX: {e}")
    log_activity(db, user, "diagrama_exportado", f"pptx · {p.filename}")
    filestore.archive(f"{_safe(p.filename)}.pptx", data)
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f'attachment; filename="{_safe(p.filename)}.pptx"'})


@router.post("/pdf")
def export_pdf(p: ExportIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    from app.services.diagram_pdf import build_pdf
    cache: dict[str, bytes | None] = {}

    def load(icon_id: str):
        if icon_id not in cache:
            row = db.get(models.DiagramIcon, icon_id)
            cache[icon_id] = row.data if row else None
        return cache[icon_id]

    try:
        data = build_pdf(p.doc, load)
    except Exception as e:
        raise HTTPException(400, f"No se pudo armar el PDF: {e}")
    log_activity(db, user, "diagrama_exportado", f"pdf · {p.filename}")
    filestore.archive(f"{_safe(p.filename)}.pdf", data)
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_safe(p.filename)}.pdf"'})

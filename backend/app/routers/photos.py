import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.services.pdf_photo_report import build_photo_report_pdf

router = APIRouter(prefix="/api/photos", tags=["photos"])


@router.get("/items", response_model=list[schemas.PhotoItemOut])
def list_items(categoria: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.PhotoItem)
    if categoria:
        q = q.filter(models.PhotoItem.categoria == categoria)
    return q.order_by(models.PhotoItem.orden).all()


@router.post("/items", response_model=schemas.PhotoItemOut)
def create_item(payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    item = models.PhotoItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/items/{item_id}", response_model=schemas.PhotoItemOut)
def update_item(item_id: str, payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    item = db.query(models.PhotoItem).get(item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.query(models.PhotoItem).get(item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    db.delete(item)
    db.commit()
    return {"ok": True}


def _resolve_upload_path(rel_path: Optional[str]) -> Optional[str]:
    if not rel_path:
        return None
    return str(UPLOADS_DIR / os.path.basename(rel_path))


@router.post("/pdf")
def generate_photo_report_pdf(payload: schemas.PhotoReportRequest):
    items = [
        {
            "numero": i.numero,
            "descripcion": i.descripcion,
            "imagen": _resolve_upload_path(i.image_path),
            "lado": i.lado,
        }
        for i in payload.items
    ]

    meta = {
        "titulo": payload.titulo,
        "proy": payload.proy,
        "cliente": payload.cliente,
        "sot": payload.sot,
        "fecha": payload.fecha,
        "cid": payload.cid,
        "contrata": payload.contrata,
        "logo_izq": _resolve_upload_path(
            payload.logo_izq_path
        ),
        "logo_der": _resolve_upload_path(
            payload.logo_der_path
        ),
    }

    out_name = f"foto_{uuid.uuid4().hex[:10]}.pdf"
    out_path = str(OUTPUTS_DIR / out_name)

    build_photo_report_pdf(
        meta,
        items,
        out_path
    )

    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{out_name}",
    }
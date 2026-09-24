from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("", response_model=list[schemas.ServiceOut])
def list_services(db: Session = Depends(get_db)):
    return db.query(models.Service).order_by(models.Service.etiqueta).all()


@router.post("", response_model=schemas.ServiceOut)
def create_service(payload: schemas.ServiceCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Service).filter_by(clave=payload.clave).first()
    if existing:
        raise HTTPException(400, "Ya existe un servicio con esa clave.")
    svc = models.Service(clave=payload.clave, etiqueta=payload.etiqueta)
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc

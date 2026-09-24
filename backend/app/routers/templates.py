from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.services import config_builder as cb
from app.services.vendor_commands import get_config_mode
from app.services.device_link import apply_raw_lines
from app.ws_utils import run_streaming

router = APIRouter(prefix="/api/templates", tags=["templates"])


def _frag_to_dict(f: models.TemplateFragment):
    return {
        "id": f.id, "nombre": f.nombre, "marca": f.marca,
        "modelos_compatibles": f.modelos_compatibles, "servicios": f.servicios,
        "orden": f.orden, "texto": f.texto,
    }


@router.get("/fragments", response_model=list[schemas.FragmentOut])
def list_fragments(marca: Optional[str] = None, servicio: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(models.TemplateFragment)
    if marca:
        q = q.filter(models.TemplateFragment.marca == marca)
    items = q.order_by(models.TemplateFragment.orden).all()
    if servicio:
        items = [f for f in items if servicio in (f.servicios or [])]
    return items


@router.post("/fragments", response_model=schemas.FragmentOut)
def create_fragment(payload: schemas.FragmentCreate, db: Session = Depends(get_db)):
    frag = models.TemplateFragment(**payload.model_dump())
    db.add(frag)
    db.commit()
    db.refresh(frag)
    return frag


@router.put("/fragments/{frag_id}", response_model=schemas.FragmentOut)
def update_fragment(frag_id: str, payload: schemas.FragmentUpdate, db: Session = Depends(get_db)):
    frag = db.query(models.TemplateFragment).get(frag_id)
    if not frag:
        raise HTTPException(404, "Fragmento no encontrado.")
    for k, v in payload.model_dump().items():
        setattr(frag, k, v)
    db.commit()
    db.refresh(frag)
    return frag


@router.delete("/fragments/{frag_id}")
def delete_fragment(frag_id: str, db: Session = Depends(get_db)):
    frag = db.query(models.TemplateFragment).get(frag_id)
    if not frag:
        raise HTTPException(404, "Fragmento no encontrado.")
    db.delete(frag)
    db.commit()
    return {"ok": True}


@router.get("/placeholders")
def get_placeholders(fragment_ids: str, db: Session = Depends(get_db)):
    """fragment_ids: coma-separado. Devuelve las variables {..} usadas."""
    ids = [i for i in fragment_ids.split(",") if i]
    frags = db.query(models.TemplateFragment).filter(models.TemplateFragment.id.in_(ids)).all()
    vars_ = cb.find_placeholders_in_fragments([_frag_to_dict(f) for f in frags])
    return sorted(vars_)


@router.post("/build")
def build_template(payload: schemas.BuildTemplateRequest, db: Session = Depends(get_db)):
    frags = db.query(models.TemplateFragment).filter(
        models.TemplateFragment.id.in_(payload.fragment_ids)).all()
    text = cb.build_full_config(
        [_frag_to_dict(f) for f in frags], payload.variables,
        payload.extra_lan_networks, payload.acl_mgmt_ips,
    )
    return {"text": text, "has_missing": "[[FALTA:" in text}


@router.websocket("/apply")
async def apply_template_ws(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    params = await websocket.receive_json()

    payload = schemas.ApplyTemplateRequest(**params)
    frags = db.query(models.TemplateFragment).filter(
        models.TemplateFragment.id.in_(payload.fragment_ids)).all()
    text = cb.build_full_config(
        [_frag_to_dict(f) for f in frags], payload.variables,
        payload.extra_lan_networks, payload.acl_mgmt_ips,
    )
    modo = get_config_mode(payload.marca)
    lines = modo["enter"] + cb.to_command_lines(text) + modo["exit"] + modo["save"]

    def blocking(progress_cb):
        log_text = apply_raw_lines(payload.connection, lines, progress_cb=progress_cb)
        return {"config_text": text, "device_log": log_text}

    await run_streaming(websocket, blocking)
    await websocket.close()

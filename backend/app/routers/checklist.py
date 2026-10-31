import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.services import cache
from app.services.logo_store import resolve_logo
from app.services.naming import build_checklist_filename
from app.services.pdf_checklist import build_checklist_pdf

router = APIRouter(prefix="/api/checklist", tags=["checklist"])


@router.get("/items", response_model=list[schemas.ChecklistItemOut])
def list_items(servicio: Optional[str] = None, db: Session = Depends(get_db)):
    key = f"checklist:{servicio or ''}"
    cached = cache.get_json(key)
    if cached is not None:
        return cached
    q = db.query(models.ChecklistItem)
    if servicio:
        q = q.filter(models.ChecklistItem.servicio == servicio)
    rows = q.order_by(models.ChecklistItem.orden).all()
    cache.set_json(key, [schemas.ChecklistItemOut.model_validate(r).model_dump() for r in rows])
    return rows


@router.post("/items", response_model=schemas.ChecklistItemOut)
def create_item(payload: schemas.ChecklistItemCreate, db: Session = Depends(get_db)):
    item = models.ChecklistItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    cache.delete_prefix("checklist:")
    return item


@router.put("/items/{item_id}", response_model=schemas.ChecklistItemOut)
def update_item(item_id: str, payload: schemas.ChecklistItemCreate, db: Session = Depends(get_db)):
    item = db.query(models.ChecklistItem).get(item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    for k, v in payload.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    cache.delete_prefix("checklist:")
    return item


@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.query(models.ChecklistItem).get(item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    db.delete(item)
    db.commit()
    cache.delete_prefix("checklist:")
    return {"ok": True}


# ============================================================
# TIPOS DE CHECKLIST (plantillas)
# ============================================================

def _clean_template(data: dict) -> dict:
    """Deja solo lo conocido y con el formato correcto (el cliente es editable, no se confía)."""
    data = data if isinstance(data, dict) else {}
    out = {
        "servicio": "rpv" if data.get("servicio") == "rpv" else "internet",
        "vendor": str(data.get("vendor") or "otro")[:20],
        "setup": [str(c)[:200] for c in (data.get("setup") or []) if str(c).strip()][:20],
        "params": [],
        "sections": [],
    }
    for p in data.get("params") or []:
        if isinstance(p, dict) and str(p.get("key", "")).strip():
            out["params"].append({
                "key": str(p["key"]).strip().upper()[:30],
                "label": str(p.get("label") or p["key"])[:80],
                "default": str(p.get("default") or "")[:100],
            })
    for si, sec in enumerate(data.get("sections") or []):
        if not isinstance(sec, dict):
            continue
        items = []
        for ii, it in enumerate(sec.get("items") or []):
            if not isinstance(it, dict):
                continue
            items.append({
                "id": str(it.get("id") or f"i{si}_{ii}")[:40],
                "nombre": str(it.get("nombre") or "")[:200],
                "modo": "texto" if it.get("modo") == "texto" else "foto",
                "cmd": str(it.get("cmd") or "")[:500],
            })
        out["sections"].append({
            "id": str(sec.get("id") or f"sec{si}")[:40],
            "titulo": str(sec.get("titulo") or "")[:200],
            "items": items,
        })
    return out


@router.get("/templates", response_model=list[schemas.ChecklistTemplateOut])
def list_templates(db: Session = Depends(get_db)):
    return (
        db.query(models.ChecklistTemplate)
        .order_by(models.ChecklistTemplate.orden, models.ChecklistTemplate.created_at)
        .all()
    )


@router.post("/templates", response_model=schemas.ChecklistTemplateOut)
def create_template(payload: schemas.ChecklistTemplateIn, db: Session = Depends(get_db)):
    nombre = payload.nombre.strip()
    if not nombre:
        raise HTTPException(400, "Escribe un nombre.")
    data = payload.data
    if payload.copiar_de:
        src = db.get(models.ChecklistTemplate, payload.copiar_de)
        if not src:
            raise HTTPException(404, "La plantilla que quieres copiar ya no existe.")
        data = src.data
    last = db.query(func.max(models.ChecklistTemplate.orden)).scalar()
    row = models.ChecklistTemplate(
        nombre=nombre[:80], data=_clean_template(data), orden=(last or 0) + 10
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/templates/{tpl_id}", response_model=schemas.ChecklistTemplateOut)
def update_template(tpl_id: str, payload: schemas.ChecklistTemplateIn, db: Session = Depends(get_db)):
    row = db.get(models.ChecklistTemplate, tpl_id)
    if not row:
        raise HTTPException(404, "El checklist ya no existe.")
    nombre = payload.nombre.strip()
    if not nombre:
        raise HTTPException(400, "Escribe un nombre.")
    row.nombre = nombre[:80]
    row.data = _clean_template(payload.data)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/templates/{tpl_id}")
def delete_template(tpl_id: str, db: Session = Depends(get_db)):
    row = db.get(models.ChecklistTemplate, tpl_id)
    if not row:
        raise HTTPException(404, "El checklist ya no existe.")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ============================================================
# PDF
# ============================================================

def _resolve_upload_path(rel_path: str) -> str:
    """rel_path es lo que devolvió /api/files/upload (nombre de archivo)."""
    return str(UPLOADS_DIR / os.path.basename(rel_path))


@router.post("/report-pdf")
def generate_checklist_report_pdf(
    payload: schemas.ChecklistReportRequest, db: Session = Depends(get_db)
):
    warnings: list = []
    sections = []
    for sec in payload.sections:
        items = []
        for it in sec.items:
            images = []
            for p in it.images:
                path = _resolve_upload_path(p)
                if os.path.isfile(path):
                    images.append(path)
                else:
                    warnings.append(f"No se encontró una imagen de «{it.nombre}»; vuelve a subirla.")
            items.append({
                "nombre": it.nombre, "modo": it.modo, "texto": it.texto,
                "cmd": it.cmd, "images": images,
            })
        sections.append((sec.titulo, items))

    meta = {
        "titulo": payload.titulo,
        "servicio_label": payload.servicio_label,
        "sot": payload.sot, "cid": payload.cid, "fecha": payload.fecha,
        "equipo": payload.equipo,
        "logo": resolve_logo(db, payload.logo_id, payload.logo_path, "", warnings),
    }

    out_name = build_checklist_filename(payload.sot, payload.cliente)
    out_path = OUTPUTS_DIR / out_name
    tmp_path = OUTPUTS_DIR / f".{out_name}.{os.getpid()}.tmp"
    try:
        _, pages = build_checklist_pdf(meta, sections, str(tmp_path))
        os.replace(tmp_path, out_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    from urllib.parse import quote
    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{quote(out_name)}",
        "pages": pages,
        "warnings": warnings,
    }

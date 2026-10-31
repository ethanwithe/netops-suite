import os
import uuid
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import models, schemas
from app.seed_data import CATEGORIAS, TIPO_CATEGORIAS
from app.services import cache
from app.services.logo_store import resolve_logo
from app.services.naming import build_report_filename
from app.services.pdf_photo_report import build_photo_report_pdf
from app.services.pdf_poder_judicial import build_pj_report_pdf
from app.services.report_project import embed_project, load_project

router = APIRouter(prefix="/api/photos", tags=["photos"])


# ============================================================
# ÍTEMS (descripciones del reporte)
# ============================================================

def _sort_key(item: models.PhotoItem):
    """
    Categorías en el orden oficial (seed_data.CATEGORIAS); las categorías
    creadas por el usuario van al final, ordenadas por nombre. Dentro de
    cada categoría manda "orden" y, si hay empate, el nombre.
    """
    orden_oficial = TIPO_CATEGORIAS.get(getattr(item, "tipo", None) or "fibra", CATEGORIAS)
    try:
        rank = orden_oficial.index(item.categoria)
        custom = ""
    except ValueError:
        rank = len(orden_oficial)
        custom = (item.categoria or "").lower()
    return (rank, custom, item.orden or 0, (item.nombre or "").lower())


# ============================================================
# VENTANAS PERSONALIZADAS
# ============================================================

def _clean_config(cfg: dict) -> dict:
    """Solo se guardan los campos conocidos (textos y logos)."""
    out = {}
    for k in ("proy", "cliente", "sot", "cid", "contrata"):
        out[k] = str((cfg or {}).get(k, ""))[:300]
    for k in ("logoIzq", "logoDer"):
        v = (cfg or {}).get(k) or {}
        out[k] = {
            "id": v.get("id") if isinstance(v.get("id"), str) else None,
            "path": "",
            "url": "",
        }
    return out


def _is_window(db: Session, tipo: str) -> bool:
    return db.get(models.PhotoWindow, tipo) is not None


@router.get("/windows", response_model=list[schemas.PhotoWindowOut])
def list_windows(db: Session = Depends(get_db)):
    return (
        db.query(models.PhotoWindow)
        .order_by(models.PhotoWindow.orden, models.PhotoWindow.created_at)
        .all()
    )


@router.post("/windows", response_model=schemas.PhotoWindowOut)
def create_window(payload: schemas.PhotoWindowIn, db: Session = Depends(get_db)):
    nombre = payload.nombre.strip()
    if not nombre:
        raise HTTPException(400, "Escribe un nombre para la ventana.")
    last = db.query(func.max(models.PhotoWindow.orden)).scalar()
    win = models.PhotoWindow(
        nombre=nombre[:80], config=_clean_config(payload.config), orden=(last or 0) + 10
    )
    db.add(win)
    db.flush()

    base = payload.copiar_de or ""
    if base:
        for it in sorted(
            db.query(models.PhotoItem).filter(models.PhotoItem.tipo == base).all(),
            key=_sort_key,
        ):
            db.add(
                models.PhotoItem(
                    tipo=win.id, categoria=it.categoria, nombre=it.nombre, orden=it.orden
                )
            )
    db.commit()
    db.refresh(win)
    cache.delete_prefix("items:")
    return win


@router.put("/windows/{win_id}", response_model=schemas.PhotoWindowOut)
def update_window(win_id: str, payload: schemas.PhotoWindowIn, db: Session = Depends(get_db)):
    win = db.get(models.PhotoWindow, win_id)
    if not win:
        raise HTTPException(404, "La ventana ya no existe.")
    nombre = payload.nombre.strip()
    if not nombre:
        raise HTTPException(400, "Escribe un nombre para la ventana.")
    win.nombre = nombre[:80]
    win.config = _clean_config(payload.config)
    db.commit()
    db.refresh(win)
    return win


@router.delete("/windows/{win_id}")
def delete_window(win_id: str, db: Session = Depends(get_db)):
    win = db.get(models.PhotoWindow, win_id)
    if not win:
        raise HTTPException(404, "La ventana ya no existe.")
    db.query(models.PhotoItem).filter(models.PhotoItem.tipo == win_id).delete()
    db.delete(win)
    db.commit()
    cache.delete_prefix("items:")
    return {"ok": True}


@router.get("/items", response_model=list[schemas.PhotoItemOut])
def list_items(
    categoria: Optional[str] = None,
    tipo: str = "fibra",
    db: Session = Depends(get_db),
):
    if tipo not in TIPO_CATEGORIAS and not _is_window(db, tipo):
        raise HTTPException(400, "Tipo de reporte inválido.")
    key = f"items:{tipo}:{categoria or ''}"
    cached = cache.get_json(key)
    if cached is not None:
        return cached

    q = db.query(models.PhotoItem).filter(models.PhotoItem.tipo == tipo)
    if categoria:
        q = q.filter(models.PhotoItem.categoria == categoria)
    rows = q.all()
    if tipo in TIPO_CATEGORIAS:
        items = sorted(rows, key=_sort_key)
    else:
        # Ventana propia: las categorías van en el orden en que se crearon.
        import datetime as _dt
        first: dict = {}
        for r in rows:
            c = r.created_at or _dt.datetime.min
            if r.categoria not in first or c < first[r.categoria]:
                first[r.categoria] = c
        items = sorted(
            rows,
            key=lambda i: (
                first[i.categoria],
                i.categoria.lower(),
                i.orden or 0,
                (i.nombre or "").lower(),
            ),
        )
    cache.set_json(key, [schemas.PhotoItemOut.model_validate(i).model_dump() for i in items])
    return items


@router.post("/items", response_model=schemas.PhotoItemOut)
def create_item(payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    data["tipo"] = data.get("tipo") or "fibra"

    if data.get("orden") is None:
        last = (
            db.query(func.max(models.PhotoItem.orden))
            .filter(
                models.PhotoItem.categoria == data["categoria"],
                models.PhotoItem.tipo == data["tipo"],
            )
            .scalar()
        )
        data["orden"] = (last or 0) + 10

    item = models.PhotoItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    cache.delete_prefix("items:")
    return item


@router.post("/items/reorder", response_model=list[schemas.PhotoItemOut])
def reorder_items(payload: schemas.PhotoReorderRequest, db: Session = Depends(get_db)):
    """Guarda el orden de UNA categoría (ids en el orden deseado) en una sola operación."""
    ids = payload.ids

    if len(set(ids)) != len(ids):
        raise HTTPException(400, "Hay ítems repetidos en la lista.")

    items = {
        i.id: i
        for i in db.query(models.PhotoItem).filter(models.PhotoItem.id.in_(ids)).all()
    }

    if len(items) != len(ids):
        raise HTTPException(404, "Algún ítem ya no existe. Recarga la página.")

    if len({i.categoria for i in items.values()}) > 1:
        raise HTTPException(400, "Todos los ítems deben ser de la misma categoría.")

    for pos, item_id in enumerate(ids, start=1):
        items[item_id].orden = pos * 10

    db.commit()
    cache.delete_prefix("items:")
    return [items[i] for i in ids]


@router.put("/items/{item_id}", response_model=schemas.PhotoItemOut)
def update_item(item_id: str, payload: schemas.PhotoItemCreate, db: Session = Depends(get_db)):
    item = db.get(models.PhotoItem, item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    # exclude_none: si no se envía "orden", se conserva el actual
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    cache.delete_prefix("items:")
    return item


@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(models.PhotoItem, item_id)
    if not item:
        raise HTTPException(404, "Ítem no encontrado.")
    db.delete(item)
    db.commit()
    cache.delete_prefix("items:")
    return {"ok": True}


# ============================================================
# PDF
# ============================================================

def _resolve_upload_path(rel_path: Optional[str]) -> Optional[str]:
    if not rel_path:
        return None
    name = os.path.basename(rel_path)
    return str(UPLOADS_DIR / name)


@router.post("/pdf")
def generate_photo_report_pdf(
    payload: schemas.PhotoReportRequest,
    db: Session = Depends(get_db),
):
    warnings: list[str] = []

    items = []
    for i in payload.items:
        img_path = _resolve_upload_path(i.image_path)

        if img_path and not os.path.isfile(img_path):
            warnings.append(
                f"No se encontró la foto de «{i.descripcion}» en el servidor; "
                "el PDF indica «IMAGEN NO DISPONIBLE». Vuelve a subirla."
            )

        items.append(
            {
                "numero": i.numero,
                "descripcion": i.descripcion,
                "imagen": img_path,
                "lado": i.lado,
                "lado_label": i.lado_label,
            }
        )

    meta = {
        "titulo": payload.titulo,
        "lados_orden": payload.lados,
        "proy": payload.proy,
        "cliente": payload.cliente,
        "sot": payload.sot,
        "fecha": payload.fecha,
        "cid": payload.cid,
        "contrata": payload.contrata,
        "logo_izq": resolve_logo(
            db, payload.logo_izq_id, payload.logo_izq_path, "izquierdo", warnings
        ),
        "logo_der": resolve_logo(
            db, payload.logo_der_id, payload.logo_der_path, "derecho", warnings
        ),
    }

    # Nombre según los datos: RF_SOT-<sot>_<cliente>.pdf
    out_name = build_report_filename(payload.sot, payload.cliente)
    out_path = OUTPUTS_DIR / out_name

    # Se genera en un temporal y se renombra al final: nunca se sirve un
    # PDF a medio escribir y dos reportes simultáneos no se pisan.
    tmp_path = OUTPUTS_DIR / f".{uuid.uuid4().hex}.tmp"

    try:
        _, pages = build_photo_report_pdf(meta, items, str(tmp_path))
        if payload.project is not None:
            msg = embed_project(str(tmp_path), payload.project, UPLOADS_DIR)
            if msg:
                warnings.append(msg)
        os.replace(tmp_path, out_path)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo generar el PDF: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{quote(out_name)}",
        "pages": pages,
        "warnings": warnings,
    }


@router.post("/pdf-pj")
def generate_pj_report_pdf(
    payload: schemas.PJReportRequest,
    db: Session = Depends(get_db),
):
    warnings: list[str] = []
    data = payload.model_dump()
    data["logo"] = resolve_logo(db, payload.logo_id, payload.logo_path, "de portada", warnings)
    data["foto_ubicacion"] = _resolve_upload_path(payload.foto_ubicacion)
    for sec in data["sections"]:
        for cell in sec["cells"]:
            cell["images"] = [_resolve_upload_path(p) for p in cell["images"]]

    out_name = build_report_filename(payload.sot or payload.sede, payload.sede, prefix="ID")
    out_path = OUTPUTS_DIR / out_name
    tmp_path = OUTPUTS_DIR / f".{uuid.uuid4().hex}.tmp"
    try:
        _, pages, pj_warnings = build_pj_report_pdf(data, str(tmp_path))
        if payload.project is not None:
            msg = embed_project(str(tmp_path), payload.project, UPLOADS_DIR)
            if msg:
                pj_warnings.append(msg)
        os.replace(tmp_path, out_path)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo generar el PDF: {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{quote(out_name)}",
        "pages": pages,
        "warnings": warnings + pj_warnings,
    }


@router.post("/import-pdf")
async def import_report_pdf(file: UploadFile = File(...)):
    """Abre un PDF generado por la app y devuelve el estado para seguir editándolo."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "El archivo está vacío.")
    try:
        project = load_project(raw, UPLOADS_DIR)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return project


# ============================================================
# CARPETA DE EVIDENCIA (ZIP)
# ============================================================

def _safe_name(text: str, fallback: str = "foto", limit: int = 80) -> str:
    from app.services.naming import clean_part
    t = clean_part(text).replace("/", "-")
    return (t[:limit].strip(" .") or fallback)


@router.post("/evidence-zip")
def build_evidence_zip(payload: schemas.EvidenceRequest):
    """
    ZIP «Evidencia fotográfica SOT <sot> <cliente>». Si las fotos son de varias
    opciones (site, cliente...), cada una va en su subcarpeta; si es una sola,
    van directo en la carpeta principal. Cada foto editada lleva también su original.
    """
    import zipfile
    from app.services.naming import _SOT_PREFIX, clean_part

    sot = clean_part(_SOT_PREFIX.sub("", payload.sot or ""))
    cliente = clean_part(payload.cliente)
    root = "Evidencia fotográfica"
    if sot:
        root += f" SOT {sot}"
    if cliente:
        root += f" {cliente}"

    items = [i for i in payload.items if i.path or i.original_path]
    if not items:
        raise HTTPException(400, "No hay fotos para guardar.")

    labels = list(dict.fromkeys((i.lado_label or "").strip() for i in items))
    use_sub = len(labels) > 1
    # Con una sola opción, las fotos van directo en la carpeta principal.

    out_name = f"{root}.zip"
    out_path = OUTPUTS_DIR / out_name
    tmp_path = OUTPUTS_DIR / f".{out_name}.{os.getpid()}.tmp"

    missing = 0
    used: set = set()
    counters: dict = {}

    def unique(folder: str, name: str) -> str:
        base, ext = os.path.splitext(name)
        cand, n = name, 2
        while (folder, cand) in used:
            cand = f"{base} ({n}){ext}"
            n += 1
        used.add((folder, cand))
        return cand

    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as z:
            for it in items:
                sub = _safe_name(it.lado_label, "General") if use_sub else ""
                counters[sub] = counters.get(sub, 0) + 1
                n = counters[sub]
                base = f"{n:02d} {_safe_name(it.nombre)}"
                folder = f"{root}/{sub}" if sub else root

                final = _resolve_upload_path(it.path or it.original_path)
                orig = _resolve_upload_path(it.original_path) if it.original_path else ""
                edited = bool(orig and it.path and orig != final)

                if os.path.isfile(final):
                    ext = os.path.splitext(final)[1] or ".jpg"
                    label = " (editada)" if edited else ""
                    z.write(final, f"{folder}/{unique(folder, base + label + ext)}")
                else:
                    missing += 1
                if edited and os.path.isfile(orig):
                    ext = os.path.splitext(orig)[1] or ".jpg"
                    z.write(orig, f"{folder}/{unique(folder, base + ' (sin editar)' + ext)}")
        os.replace(tmp_path, out_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    return {
        "filename": out_name,
        "url": f"/api/files/outputs/{quote(out_name)}",
        "total": len(items),
        "missing": missing,
        "folders": [(_safe_name(l, "General") if use_sub else "") for l in labels],
    }

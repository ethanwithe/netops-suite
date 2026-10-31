"""
clients.py
Datos de clientes por SOT, organizados por año y mes (según la fecha de los datos).
Cualquier ventana puede mandar lo que sabe de una SOT (/sync) y se junta aquí.
"""

import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services.naming import clean_part

router = APIRouter(prefix="/api/clients", tags=["clients"])

_SOT_PREFIX = re.compile(r"^\s*SOT\s*[-_:.#]*\s*", re.IGNORECASE)
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DMY = re.compile(r"^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s*$")


def norm_sot(sot: str) -> str:
    return _SOT_PREFIX.sub("", str(sot or "")).strip()


def norm_fecha(fecha: str) -> str:
    """Acepta yyyy-mm-dd o dd/mm/yyyy; si no se entiende, devuelve ''."""
    f = str(fecha or "").strip()
    if _ISO.match(f):
        return f
    m = _DMY.match(f)
    if m:
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
        try:
            return dt.date(y, mo, d).isoformat()
        except ValueError:
            return ""
    return ""


def _today() -> str:
    return dt.date.today().isoformat()


def _years(db: Session) -> list[int]:
    ys = {r.year for r in db.query(models.ClientYear).all()}
    for (f,) in db.query(models.Client.fecha).all():
        if f and len(f) >= 4 and f[:4].isdigit():
            ys.add(int(f[:4]))
    ys.add(dt.date.today().year)
    return sorted(ys)


@router.get("/years")
def list_years(db: Session = Depends(get_db)):
    """Años disponibles con su cantidad de clientes (el actual siempre existe)."""
    counts: dict[int, int] = {}
    for (f,) in db.query(models.Client.fecha).all():
        if f and f[:4].isdigit():
            counts[int(f[:4])] = counts.get(int(f[:4]), 0) + 1
    return [{"year": y, "total": counts.get(y, 0)} for y in _years(db)]


@router.post("/years")
def create_year(payload: schemas.ClientYearIn, db: Session = Depends(get_db)):
    if not (2000 <= payload.year <= 2100):
        raise HTTPException(400, "Año fuera de rango.")
    if not db.get(models.ClientYear, payload.year):
        db.add(models.ClientYear(year=payload.year))
        db.commit()
    return {"year": payload.year}


@router.get("", response_model=list[schemas.ClientOut])
def list_clients(year: int | None = None, q: str = "", db: Session = Depends(get_db)):
    rows = db.query(models.Client).all()
    if year is not None:
        rows = [r for r in rows if (r.fecha or "").startswith(f"{year:04d}-")]
    q = q.strip().lower()
    if q:
        rows = [
            r for r in rows
            if q in f"{r.sot} {r.nombre} {r.cid} {r.proy}".lower()
        ]
    rows.sort(key=lambda r: (r.fecha or "", r.created_at or dt.datetime.min), reverse=True)
    return rows


@router.get("/by-sot/{sot}", response_model=schemas.ClientOut)
def get_by_sot(sot: str, db: Session = Depends(get_db)):
    row = db.query(models.Client).filter(models.Client.sot == norm_sot(sot)).first()
    if not row:
        raise HTTPException(404, "No hay un cliente con esa SOT.")
    return row


def _apply(row: models.Client, data: dict, overwrite: bool):
    """Copia solo los campos con valor (en sync no se pisa lo ya guardado con vacíos)."""
    for k in ("nombre", "cid", "proy", "contrata"):
        v = str(data.get(k) or "").strip()
        if v and (overwrite or True):
            setattr(row, k, v)
    f = norm_fecha(data.get("fecha", ""))
    if f:
        row.fecha = f
    datos = dict(row.datos or {})
    for k, v in (data.get("datos") or {}).items():
        k = str(k).strip()[:40]
        v = str(v or "").strip()[:300]
        if k and v:
            datos[k] = v
    row.datos = datos
    row.updated_at = dt.datetime.utcnow()


@router.post("", response_model=schemas.ClientOut)
def create_client(payload: schemas.ClientIn, db: Session = Depends(get_db)):
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    if db.query(models.Client).filter(models.Client.sot == sot).first():
        raise HTTPException(409, f"Ya existe un cliente con la SOT {sot}.")
    row = models.Client(sot=sot, fecha=norm_fecha(payload.fecha) or _today(), datos={}, reportes=[])
    _apply(row, payload.model_dump(), True)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{client_id}", response_model=schemas.ClientOut)
def update_client(client_id: str, payload: schemas.ClientIn, db: Session = Depends(get_db)):
    row = db.get(models.Client, client_id)
    if not row:
        raise HTTPException(404, "El cliente ya no existe.")
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    other = db.query(models.Client).filter(models.Client.sot == sot, models.Client.id != client_id).first()
    if other:
        raise HTTPException(409, f"Ya existe otro cliente con la SOT {sot}.")
    row.sot = sot
    # En la edición manual sí se puede vaciar un campo y reemplazar todos los datos.
    row.nombre = payload.nombre.strip()
    row.cid = payload.cid.strip()
    row.proy = payload.proy.strip()
    row.contrata = payload.contrata.strip()
    row.fecha = norm_fecha(payload.fecha) or row.fecha or _today()
    row.datos = {str(k).strip()[:40]: str(v)[:300] for k, v in payload.datos.items() if str(k).strip()}
    row.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{client_id}")
def delete_client(client_id: str, db: Session = Depends(get_db)):
    row = db.get(models.Client, client_id)
    if not row:
        raise HTTPException(404, "El cliente ya no existe.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/sync", response_model=schemas.ClientOut)
def sync_client(payload: schemas.ClientSync, db: Session = Depends(get_db)):
    """
    Crea el cliente si no existe (en el año/mes de la fecha dada, o de hoy) o le suma lo nuevo:
    datos (IPs, interfaces...) y, si viene, un reporte generado.
    """
    sot = norm_sot(payload.sot)
    if not sot:
        raise HTTPException(400, "La SOT es obligatoria.")
    row = db.query(models.Client).filter(models.Client.sot == sot).first()
    if not row:
        row = models.Client(sot=sot, fecha=norm_fecha(payload.fecha) or _today(), datos={}, reportes=[])
        db.add(row)
    _apply(row, payload.model_dump(), False)

    if payload.reporte:
        rep = {k: str(v)[:300] for k, v in payload.reporte.items() if k in ("tipo", "nombre", "filename", "url")}
        rep["generado"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        reportes = [r for r in (row.reportes or []) if r.get("filename") != rep.get("filename")]
        reportes.append(rep)
        row.reportes = reportes[-100:]
    db.commit()
    db.refresh(row)
    return row

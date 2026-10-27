"""
file_store.py
Guarda en la base de datos las fotos subidas y los PDF generados cuando el
servidor no tiene disco persistente (Vercel). En modo "disk" (Railway,
Docker) no hace nada: todo sigue funcionando con las carpetas de siempre.

La carpeta local (UPLOADS_DIR / OUTPUTS_DIR) se usa como copia temporal: si un
archivo no está (otra instancia, arranque en frío), se baja de la base de datos.
"""

import datetime as dt
import logging
from pathlib import Path
from typing import Optional

from app.config import FILE_RETENTION_DAYS, OUTPUTS_DIR, STORAGE_BACKEND, UPLOADS_DIR

logger = logging.getLogger(__name__)

UPLOAD, OUTPUT = "upload", "output"


def enabled() -> bool:
    return STORAGE_BACKEND == "db"


def _dir(kind: str) -> Path:
    return UPLOADS_DIR if kind == UPLOAD else OUTPUTS_DIR


def put(kind: str, name: str, data: bytes, content_type: Optional[str] = None) -> None:
    if not enabled():
        return
    from app import models
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.merge(models.StoredFile(
            id=f"{kind}:{name}", kind=kind, name=name,
            content_type=content_type, data=data, created_at=dt.datetime.utcnow(),
        ))
        db.commit()
    finally:
        db.close()


def put_path(kind: str, path, content_type: Optional[str] = None) -> None:
    """Guarda en la base de datos un archivo que ya está en disco."""
    if not enabled():
        return
    p = Path(path)
    put(kind, p.name, p.read_bytes(), content_type)


def ensure_local(kind: str, name: str) -> Optional[Path]:
    """Ruta local del archivo; si falta y hay base de datos, lo baja primero."""
    path = _dir(kind) / Path(name).name
    if path.is_file():
        return path
    if not enabled():
        return None

    from app import models
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.get(models.StoredFile, f"{kind}:{path.name}")
        if not row:
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(row.data))
        return path
    finally:
        db.close()


def purge_old() -> int:
    """Borra de la base de datos lo más antiguo que FILE_RETENTION_DAYS. Devuelve cuántos."""
    if not enabled() or FILE_RETENTION_DAYS <= 0:
        return 0
    from app import models
    from app.database import SessionLocal

    cutoff = dt.datetime.utcnow() - dt.timedelta(days=FILE_RETENTION_DAYS)
    db = SessionLocal()
    try:
        n = db.query(models.StoredFile).filter(models.StoredFile.created_at < cutoff).delete()
        db.commit()
        return n
    except Exception as exc:
        db.rollback()
        logger.warning("No se pudo limpiar archivos antiguos: %s", exc)
        return 0
    finally:
        db.close()

"""
Almacén durable de archivos: cada foto subida y cada PDF/ZIP generado se copia a la base de datos.
El disco sigue siendo la caché que usan los generadores de PDF; si falta un archivo (por un
reinicio o un nuevo despliegue) se restaura desde la base de datos al pedirlo.
"""
import mimetypes
import os
from pathlib import Path
from typing import Optional

from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app.database import SessionLocal
from app import models


def _store(kind: str, name: str, data: bytes) -> None:
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    db = SessionLocal()
    try:
        row = db.get(models.StoredFile, name)
        if row:
            row.data, row.kind, row.content_type = data, kind, ctype
        else:
            db.add(models.StoredFile(name=name, kind=kind, content_type=ctype, data=data))
        db.commit()
    except Exception:
        db.rollback()  # guardar la copia nunca debe tumbar la operación principal
    finally:
        db.close()


def save_upload(name: str, data: bytes) -> None:
    _store("upload", name, data)


def save_output(path) -> None:
    """Copia a la base de datos un PDF/ZIP recién generado en OUTPUTS_DIR."""
    p = Path(path)
    try:
        if p.is_file():
            _store("output", p.name, p.read_bytes())
    except OSError:
        pass


def _restore(kind: str, name: str, folder: Path) -> Optional[Path]:
    dest = folder / os.path.basename(name)
    if dest.is_file():
        return dest
    db = SessionLocal()
    try:
        row = db.get(models.StoredFile, os.path.basename(name))
        if not row or row.kind != kind:
            return None
        dest.write_bytes(bytes(row.data))
        return dest
    except Exception:
        return None
    finally:
        db.close()


def ensure_upload(name: str) -> Path:
    """Ruta en disco de una foto subida (la restaura desde la base de datos si hace falta)."""
    return _restore("upload", name, UPLOADS_DIR) or (UPLOADS_DIR / os.path.basename(name))


def ensure_output(name: str) -> Optional[Path]:
    return _restore("output", name, OUTPUTS_DIR)

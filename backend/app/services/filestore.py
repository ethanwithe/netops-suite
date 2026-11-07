"""
Almacén durable de archivos: cada foto subida y cada PDF/ZIP generado se copia a la base de datos.
El disco sigue siendo la caché que usan los generadores de PDF; si falta un archivo (por un
reinicio o un nuevo despliegue) se restaura desde la base de datos al pedirlo.
"""
import mimetypes
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional

from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app.database import SessionLocal
from app import models
from app.services import telegram_store


def _store(kind: str, name: str, data: bytes) -> None:
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    # Con Telegram configurado el contenido va allá y en la base solo queda la referencia;
    # si Telegram falla, se guarda en la base como antes (no se pierde nada).
    ref = telegram_store.upload(name, data)
    blob = b"" if ref else data
    chat, mid = ref if ref else (None, None)
    db = SessionLocal()
    try:
        row = db.get(models.StoredFile, name)
        if row:
            old = (row.tg_chat, row.tg_msg)
            row.data, row.kind, row.content_type = blob, kind, ctype
            row.tg_chat, row.tg_msg, row.size = chat, mid, len(data)
            if old[0] and old[1] and ref:
                telegram_store.delete(old[0], old[1])  # no dejar copias viejas
        else:
            db.add(models.StoredFile(name=name, kind=kind, content_type=ctype, data=blob,
                                     tg_chat=chat, tg_msg=mid, size=len(data)))
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
        content = bytes(row.data or b"")
        if not content and row.tg_chat and row.tg_msg:
            content = telegram_store.download(row.tg_chat, row.tg_msg) or b""
            if not content:
                return None
        dest.write_bytes(content)
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


def migrate_to_telegram(limit: int = 50) -> dict:
    """Pasa a Telegram los archivos que aún están en la base de datos (por tandas) y libera ese espacio."""
    moved = failed = 0
    db = SessionLocal()
    try:
        rows = (db.query(models.StoredFile).filter(models.StoredFile.tg_msg.is_(None))
                .order_by(models.StoredFile.created_at).limit(limit).all())
        for r in rows:
            ref = telegram_store.upload(r.name, bytes(r.data or b""))
            if not ref:
                failed += 1
                continue
            r.size = len(r.data or b"")
            r.tg_chat, r.tg_msg, r.data = ref[0], ref[1], b""
            db.commit()
            moved += 1
        left = db.query(models.StoredFile).filter(models.StoredFile.tg_msg.is_(None)).count()
        return {"movidos": moved, "fallidos": failed, "pendientes": left}
    finally:
        db.close()


def archive(name: str, data: bytes) -> None:
    """Guarda en segundo plano una copia de un archivo exportado (xlsx, docx, pptx, pdf, txt…)
    para no hacer esperar la descarga. Va a Telegram si está configurado, o a la base de datos."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name)).strip("_") or "archivo"
    stored = f"{time.strftime('%Y%m%d-%H%M%S')}_{safe}"[:150]
    threading.Thread(target=_store, args=("output", stored, data), daemon=True).start()

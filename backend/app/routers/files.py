import re
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from app.config import UPLOADS_DIR, OUTPUTS_DIR
from app.services import filestore

router = APIRouter(prefix="/api/files", tags=["files"])

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_UPLOAD = 15 * 1024 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$")


def _safe(name: str) -> str:
    if not SAFE_NAME.match(name or "") or ".." in name:
        raise HTTPException(404, "Archivo no encontrado.")
    return name


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Extensión no permitida: {ext}")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / name
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "La imagen pesa demasiado (máximo 15 MB).")
    dest.write_bytes(content)
    filestore.save_upload(name, content)
    return {"path": name, "url": f"/api/files/uploads/{name}"}


@router.get("/uploads/{filename}")
def get_upload(filename: str):
    filename = _safe(filename)
    path = filestore.ensure_upload(filename)
    if not path.is_file():
        raise HTTPException(404, "Archivo no encontrado.")
    return FileResponse(str(path))


@router.get("/outputs/{filename}")
def get_output(filename: str):
    filename = _safe(filename)
    path = filestore.ensure_output(filename) or (OUTPUTS_DIR / filename)
    if not path.is_file():
        raise HTTPException(404, "Archivo no encontrado.")
    media = "application/zip" if filename.lower().endswith(".zip") else "application/pdf"
    return FileResponse(str(path), media_type=media, filename=filename)

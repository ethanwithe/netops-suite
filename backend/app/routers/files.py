import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from app.config import UPLOADS_DIR, OUTPUTS_DIR
from app.services import file_store

router = APIRouter(prefix="/api/files", tags=["files"])

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Extensión no permitida: {ext}")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / name
    content = await file.read()
    dest.write_bytes(content)
    file_store.put(file_store.UPLOAD, name, content, file.content_type)
    return {"path": name, "url": f"/api/files/uploads/{name}"}


@router.get("/uploads/{filename}")
def get_upload(filename: str):
    path = file_store.ensure_local(file_store.UPLOAD, filename)
    if not path:
        raise HTTPException(404, "Archivo no encontrado.")
    return FileResponse(str(path))


@router.get("/outputs/{filename}")
def get_output(filename: str):
    path = file_store.ensure_local(file_store.OUTPUT, filename)
    if not path:
        raise HTTPException(404, "Archivo no encontrado.")
    return FileResponse(str(path), media_type="application/pdf", filename=filename)

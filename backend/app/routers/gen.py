"""Descarga del paquete de generadores para trabajar sin conexión (ver services/gen_bundle.py)."""
from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.services.gen_bundle import build_bundle

router = APIRouter(prefix="/api/gen", tags=["gen"])
_cache: dict = {}


def _get() -> tuple:
    if "b" not in _cache:
        _cache["b"] = build_bundle()
    return _cache["b"]


@router.get("/info")
def info():
    data, version = _get()
    return {"version": version, "size": len(data)}


@router.get("/bundle")
def bundle(request: Request):
    data, version = _get()
    if request.headers.get("if-none-match") == f'"{version}"':
        return Response(status_code=304)
    return Response(content=data, media_type="application/zip", headers={"ETag": f'"{version}"', "Cache-Control": "private, max-age=0, must-revalidate"})

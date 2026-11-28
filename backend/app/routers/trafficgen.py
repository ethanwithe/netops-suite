"""
trafficgen.py (router)
Solo escritorio (NETOPS_DESKTOP=1) y solo desde este equipo: lista los puertos, los configura (bidireccional), guarda
los ítems y arranca/detiene el generador de tramas (services/trafficgen.py).
"""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.routers.local_tools import DESKTOP
from app.services import trafficgen as TG

router = APIRouter(prefix="/api/trafficgen", tags=["trafficgen"])

_engine: Optional[TG.Engine] = None


def _guard(request: Request):
    if not DESKTOP:
        raise HTTPException(404, "Solo disponible en la app de escritorio.")
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "Solo desde este equipo.")


class ItemIn(BaseModel):
    id: int
    nombre: str = "ICMP"
    src_mac: str
    dst_mac: str
    src_ip: str
    dst_ip: str
    size: int = Field(1024, ge=60, le=9000)
    mbps: float = Field(100, gt=0, le=100000)
    mbps_rev: Optional[float] = Field(None, gt=0, le=100000)
    ttl: int = Field(64, ge=1, le=255)
    bidir: Optional[bool] = None
    activo: bool = True


class StartIn(BaseModel):
    puerto: str
    bidireccional: bool = True
    duracion: int = Field(30, ge=0, le=86400)
    items: List[ItemIn]


@router.get("/puertos")
def puertos(request: Request):
    _guard(request)
    return TG.list_ports()


@router.get("/estado")
def estado(request: Request):
    _guard(request)
    if _engine is None:
        return {"corriendo": False, "flujos": [], "segundos": 0, "duracion": 0, "error": ""}
    return _engine.status()


@router.post("/iniciar")
def iniciar(body: StartIn, request: Request):
    global _engine
    _guard(request)
    if _engine is not None and _engine.running:
        raise HTTPException(409, "Ya hay un generador corriendo.")
    try:
        backend = TG.open_backend(body.puerto)
    except (OSError, PermissionError) as e:
        raise HTTPException(400, f"No se pudo abrir el puerto: {e}")
    eng = TG.Engine(backend, body.bidireccional)
    eng.items = [TG.Item(**i.model_dump()) for i in body.items]
    try:
        eng.start(body.duracion)
    except ValueError as e:
        backend.close()
        raise HTTPException(400, str(e))
    _engine = eng
    return eng.status()


@router.post("/detener")
def detener(request: Request):
    _guard(request)
    if _engine is not None:
        _engine.stop()
        _engine.backend.close()
        return _engine.status()
    return {"corriendo": False, "flujos": []}

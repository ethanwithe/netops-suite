"""
tools.py
Herramientas que se descargan para usar en la PC del técnico.

  - saturador.py: saturador bidireccional por ICMP (ver el propio archivo).
    Corre en la laptop del técnico (no en la nube), por eso se descarga.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/tools", tags=["tools"])

_SATURADOR = Path(__file__).resolve().parent.parent / "static_tools" / "saturador.py"


@router.get("/saturador.py")
def download_saturador():
    if not _SATURADOR.is_file():
        raise HTTPException(404, "No se encontró el saturador en el servidor.")
    return FileResponse(
        str(_SATURADOR), media_type="text/x-python", filename="saturador.py"
    )

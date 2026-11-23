"""
local_tools.py
Solo en la app de escritorio (NETOPS_DESKTOP=1): la consola (SSH/serial) y el saturador corren dentro del
mismo programa, así que la página no necesita que el técnico abra «puente.py» ni «saturador.py».
Este endpoint le dice a la página que está en modo escritorio y con qué códigos hablar con ellos
(solo responde a peticiones que vienen de este mismo equipo).
"""
import os

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/local", tags=["local"])

DESKTOP = os.getenv("NETOPS_DESKTOP", "").lower() in ("1", "true", "yes")
CODES = {"puente": "", "saturador": ""}


@router.get("/info")
def info(request: Request):
    if not DESKTOP:
        return {"desktop": False}
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Solo desde este equipo.")
    return {"desktop": True, "puente_code": CODES["puente"], "saturador_code": CODES["saturador"]}

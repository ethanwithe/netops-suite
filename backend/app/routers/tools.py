"""
tools.py
Herramientas de automatizacion:
  - Speedtest automatico: abre un navegador Chrome headless (Playwright),
    corre el test en una pagina real, y devuelve la captura de pantalla
    del resultado ya lista para usar como evidencia.
  - Ostinato + captura de saturacion: dispara el comando que arranca el
    trafico de Ostinato, ESPERA el tiempo indicado (para que la
    saturacion suba hasta el ancho de banda contratado), y recien
    entonces ejecuta el/los comando(s) en el router (WAN y, opcionalmente,
    SUP) para capturar el estado de saturacion.
"""

import subprocess
import time
import uuid
from typing import Optional, List

from fastapi import APIRouter, WebSocket
from pydantic import BaseModel

from app.config import UPLOADS_DIR
from app.services.device_link import run_tests
from app.ws_utils import run_streaming

router = APIRouter(prefix="/api/tools", tags=["tools"])


class SpeedtestRequest(BaseModel):
    url: str = "https://fast.com"
    wait_seconds: int = 25


@router.websocket("/speedtest")
async def speedtest_ws(websocket: WebSocket):
    """
    Corre un speedtest real en un Chrome headless (en el SERVIDOR donde
    corre el backend) y devuelve la captura de pantalla del resultado.
    Requiere que ese servidor tenga salida a Internet, y que se haya
    corrido una vez `python -m playwright install chromium`.
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = SpeedtestRequest(**params)

    def blocking(progress_cb):
        from playwright.sync_api import sync_playwright

        progress_cb(f"Abriendo navegador y cargando {payload.url} ...")
        out_name = f"speedtest_{uuid.uuid4().hex[:10]}.png"
        out_path = str(UPLOADS_DIR / out_name)

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto(payload.url, timeout=30000)
            progress_cb(f"Pagina cargada. Esperando {payload.wait_seconds}s a que el test termine...")
            remaining = payload.wait_seconds
            while remaining > 0:
                step = min(5, remaining)
                time.sleep(step)
                remaining -= step
                progress_cb(f"  ... {remaining}s restantes")
            page.screenshot(path=out_path)
            browser.close()

        progress_cb("Captura de resultado guardada.")
        return {"path": out_name, "url": f"/api/files/uploads/{out_name}"}

    await run_streaming(websocket, blocking)
    await websocket.close()


class OstinatoRequest(BaseModel):
    connection: dict
    ostinato_start_cmd: str
    wait_seconds: int = 60
    wan_cmd: str
    sup_cmd: Optional[str] = None
    disable_paging_cmds: List[str] = []


@router.websocket("/ostinato-saturacion")
async def ostinato_ws(websocket: WebSocket):
    """
    1. Ejecuta `ostinato_start_cmd` en el servidor (arranca el trafico).
    2. Espera `wait_seconds` (con progreso en vivo) para que la
       saturacion suba hasta el ancho de banda del servicio.
    3. Ejecuta `wan_cmd` (y `sup_cmd` si se dio) en el router por
       SSH/Serial, devolviendo la salida de cada uno lista para pegar
       como captura en el checklist (WAN arriba, SUP debajo).
    """
    await websocket.accept()
    params = await websocket.receive_json()
    payload = OstinatoRequest(**params)

    def blocking(progress_cb):
        progress_cb(f">> Iniciando trafico Ostinato: {payload.ostinato_start_cmd}")
        try:
            subprocess.Popen(
                payload.ostinato_start_cmd, shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            progress_cb(f"No se pudo lanzar el comando de Ostinato: {e}")

        progress_cb(f"Esperando {payload.wait_seconds}s a que la saturacion suba al ancho de banda del servicio...")
        remaining = payload.wait_seconds
        while remaining > 0:
            step = min(5, remaining)
            time.sleep(step)
            remaining -= step
            progress_cb(f"  ... {remaining}s restantes")

        tests = [("wan", "Saturacion WAN", payload.wan_cmd)]
        if payload.sup_cmd:
            tests.append(("sup", "Saturacion SUP", payload.sup_cmd))

        progress_cb("Capturando en el router...")
        _, results = run_tests(
            payload.connection, payload.disable_paging_cmds, None, tests, None,
            progress_cb=progress_cb,
        )
        by_key = {k: o for k, l, c, o in results}
        return {
            "wan_output": by_key.get("wan", ""),
            "sup_output": by_key.get("sup", "") if payload.sup_cmd else None,
        }

    await run_streaming(websocket, blocking)
    await websocket.close()

import os
import uuid

from fastapi import APIRouter, WebSocket

from app.config import OUTPUTS_DIR, UPLOADS_DIR
from app import schemas
from app.services.vendor_commands import get_tests, VENDORS
from app.services.device_link import run_tests
from app.services.pdf_core import build_pdf
from app.ws_utils import run_streaming

router = APIRouter(prefix="/api/tests", tags=["tests"])


@router.websocket("/run")
async def run_tests_ws(websocket: WebSocket):
    await websocket.accept()
    params = await websocket.receive_json()
    payload = schemas.RunTestsRequest(**params)

    vendor = VENDORS[payload.vendor_key]
    tests = get_tests(payload.vendor_key, payload.device_type, uplink=payload.uplink, ping=payload.ping)
    config_test = vendor.get("config_cmd")
    disable_paging = vendor.get("disable_paging", [])
    save_cmds = vendor.get("save_cmds", [])

    def blocking(progress_cb):
        config_text, results = run_tests(
            payload.connection, disable_paging, config_test, tests, save_cmds, progress_cb=progress_cb)
        return {
            "config_text": config_text,
            "results": [{"key": k, "label": l, "cmd": c, "output": o} for k, l, c, o in results],
        }

    await run_streaming(websocket, blocking)
    await websocket.close()


def _resolve_upload_path(rel_path):
    if not rel_path:
        return None
    return str(UPLOADS_DIR / os.path.basename(rel_path))


@router.post("/pdf")
def generate_tests_pdf(payload: schemas.TestsPdfRequest):
    meta = {
        "device_id": payload.device_id, "ip": payload.ip, "vendor_label": payload.vendor_label,
        "sede": payload.sede, "fecha": payload.fecha,
        "logo_izq": _resolve_upload_path(payload.logo_izq_path),
        "logo_der": _resolve_upload_path(payload.logo_der_path),
    }
    results = [(r["key"], r["label"], r["cmd"], r["output"]) for r in payload.results]
    out_name = f"pruebas_{uuid.uuid4().hex[:10]}.pdf"
    out_path = str(OUTPUTS_DIR / out_name)
    build_pdf(meta, payload.config_text, results, out_path=out_path)
    return {"filename": out_name, "url": f"/api/files/outputs/{out_name}"}

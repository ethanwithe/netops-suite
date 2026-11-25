"""El generador local (sin servidor ni base de datos) debe dar EXACTAMENTE lo mismo que los endpoints del servidor."""
import io
import os
import re
import shutil
import uuid
import zipfile

import pytest
from PIL import Image, ImageDraw

from app.config import OUTPUTS_DIR, UPLOADS_DIR


def jpg(color):
    im = Image.new("RGB", (1200, 900), color)
    d = ImageDraw.Draw(im)
    for i in range(0, 1200, 60):
        d.line([(i, 0), (1200 - i, 900)], fill=(255, 255, 255), width=5)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=88)
    return b.getvalue()


@pytest.fixture(scope="module")
def photos(client):
    out = []
    for c in [(200, 60, 60), (60, 160, 90), (50, 90, 200)]:
        pid = str(uuid.uuid4())
        r = client.post("/api/sync/photos", files={"file": ("a.jpg", jpg(c), "image/jpeg")}, data={"photo_id": pid})
        assert r.status_code == 200, r.text
        out.append(r.json()["path"])
    return out


@pytest.fixture()
def work(tmp_path, photos):
    from app.services.gen_local import Work
    w = Work(str(tmp_path))
    for p in photos:
        shutil.copy(UPLOADS_DIR / p, os.path.join(w.uploads, p))
    return w


def norm_pdf(b: bytes) -> bytes:
    """Sin las marcas de fecha e identificador que cambian en cada generación."""
    b = re.sub(rb"/CreationDate\s*\(D(?::|\\072)[^)]*\)", b"", b)      # con «:» o escrito como \072
    b = re.sub(rb"/ModDate\s*\(D(?::|\\072)[^)]*\)", b"", b)
    b = re.sub(rb"/ID\s*\[[^\]]*\]", b"", b)
    b = re.sub(rb"\(D:\d{14}[^)]*\)", b"()", b)          # cualquier otra marca de fecha (p. ej. la del adjunto)
    return b


def served(client, url):
    r = client.get(url)
    assert r.status_code == 200
    return r.content


def test_photo_report_same(client, photos, work):
    from app.services import gen_local
    req = {"titulo": "REPORTE FOTOGRAFICO", "lados": ["cliente"], "proy": "P", "cliente": "Cliente X", "sot": "5001", "fecha": "21/11/2026", "cid": "C1", "contrata": "K",
           "version": "01", "items": [{"numero": i + 1, "descripcion": f"Foto {i + 1}", "image_path": p, "lado": "cliente", "lado_label": ""} for i, p in enumerate(photos)],
           "project": {"nota": "x", "imagen": photos[0]}}
    srv = client.post("/api/photos/pdf", json=req).json()
    loc = gen_local.photo_report(req, work)
    assert srv["filename"] == loc["filename"] and srv["pages"] == loc["pages"] and srv["warnings"] == loc["warnings"]
    a, b = norm_pdf(served(client, srv["url"])), norm_pdf(open(loc["path"], "rb").read())
    if a != b:
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), 0)
        print("DIFF-A", a[max(0, i - 200):i + 120]); print("DIFF-B", b[max(0, i - 200):i + 120])
    assert a == b


def test_checklist_pdf_and_docx_same(client, photos, work):
    from app.services import gen_local
    req = {"titulo": "CheckList de Claro", "servicio_label": "Internet", "sot": "5002", "cid": "C2", "cliente": "Cliente Y", "fecha": "21/11/2026", "equipo": "RTR1",
           "sections": [{"titulo": "1. Datos", "items": [{"nombre": "Versión", "modo": "texto", "texto": "IOS 17\nok", "cmd": "show version", "images": []},
                                                         {"nombre": "Foto", "modo": "foto", "texto": "", "cmd": "", "images": photos[:2]}]}]}
    s = client.post("/api/checklist/report-pdf", json=req).json()
    l = gen_local.checklist_pdf(req, work)
    assert s["filename"] == l["filename"] and norm_pdf(served(client, s["url"])) == norm_pdf(open(l["path"], "rb").read())
    s = client.post("/api/checklist/report-docx", json=req).json()
    l = gen_local.checklist_docx(req, work)
    za, zb = zipfile.ZipFile(io.BytesIO(served(client, s["url"]))), zipfile.ZipFile(l["path"])
    assert sorted(za.namelist()) == sorted(zb.namelist())
    assert all(za.read(n) == zb.read(n) for n in za.namelist() if not n.startswith("docProps/"))


def test_evidence_zip_same(client, photos, work):
    from app.services import gen_local
    req = {"sot": "5003", "cliente": "Cliente Z", "items": [
        {"nombre": "Rack", "path": photos[0], "original_path": photos[1], "lado_label": "SITE"},
        {"nombre": "ONT", "path": photos[2], "original_path": "", "lado_label": "CLIENTE"}]}
    s = client.post("/api/photos/evidence-zip", json=req).json()
    l = gen_local.evidence_zip(req, work)
    assert s["filename"] == l["filename"] and s["total"] == l["total"] and s["folders"] == l["folders"]
    assert served(client, s["url"]) == open(l["path"], "rb").read()       # ZIP idéntico byte a byte

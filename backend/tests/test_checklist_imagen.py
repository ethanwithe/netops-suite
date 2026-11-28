"""CheckList generado: la configuración (show run) queda como texto; el resto de las salidas va como imagen (no editable)."""
import zipfile

from pypdf import PdfReader

from app.services.docx_checklist import build_checklist_docx
from app.services.pdf_checklist import build_checklist_pdf

META = {"titulo": "CheckList", "servicio_label": "Internet", "sot": "1", "cid": "2", "fecha": "2026-11-28", "equipo": "R1", "logo": None}
SECS = [("A: VALIDACION", [
    {"nombre": "Interfaces", "modo": "foto", "texto": "GigabitEthernet0/0 10.0.0.1 up up\n" * 40, "cmd": "show ip int br", "images": []},
    {"nombre": "Config", "modo": "texto", "texto": "interface Gi0/0\n ip address 10.0.0.1 255.255.255.0", "cmd": "show run", "images": []},
])]


def test_pdf_salida_como_imagen(tmp_path):
    out = tmp_path / "c.pdf"
    build_checklist_pdf(META, SECS, str(out))
    text = "".join(p.extract_text() or "" for p in PdfReader(str(out)).pages)
    assert "GigabitEthernet0/0" not in text, "la salida de un comando común debe ir como imagen"
    assert "ip address 10.0.0.1" in text, "la configuración sí queda como texto"


def test_word_salida_como_imagen(tmp_path):
    out = tmp_path / "c.docx"
    build_checklist_docx(META, SECS, str(out))
    z = zipfile.ZipFile(out)
    xml = z.read("word/document.xml").decode("utf-8")
    assert "GigabitEthernet0/0" not in xml
    assert "ip address 10.0.0.1" in xml
    assert any(n.startswith("word/media/") for n in z.namelist())

"""
gen_bundle.py
Paquete (ZIP) con el código de los generadores que la app descarga una vez y ejecuta en el equipo con Pyodide
(Python dentro del navegador o de la app Android) o con el Python embebido en Windows.
Es el MISMO código que usa el servidor: no hay una segunda versión que mantener ni que pueda salir distinta.
"""
import hashlib
import io
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
FILES = [
    "__init__.py",
    "services/__init__.py", "services/naming.py", "services/logo_image.py", "services/term_colors.py",
    "services/pdf_photo_report.py", "services/pdf_checklist.py", "services/docx_checklist.py", "services/pdf_poder_judicial.py",
    "services/diagram_fit.py", "services/diagram_pdf.py", "services/diagram_pptx.py",
    "services/report_project.py", "services/zip_plans.py", "services/gen_local.py",
]
ASSET_DIRS = ["assets/fonts"]


def members() -> list:
    out = [(f"app/{f}", (APP / f).read_bytes()) for f in FILES]
    for d in ASSET_DIRS:
        for p in sorted((APP / d).glob("*")):
            if p.is_file():
                out.append((f"app/{d}/{p.name}", p.read_bytes()))
    return out


def build_bundle() -> tuple:
    """(bytes del zip, versión). La versión cambia solo si cambia algún archivo."""
    items = members()
    h = hashlib.sha256()
    for name, data in items:
        h.update(name.encode()); h.update(hashlib.sha256(data).digest())
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in items:
            zi = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    return buf.getvalue(), h.hexdigest()[:16]

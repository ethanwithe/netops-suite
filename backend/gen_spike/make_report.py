"""Genera un reporte fotográfico con el generador REAL (app/services/pdf_photo_report.py).
Se ejecuta igual en Python normal y en Pyodide (Python dentro del navegador/app) para comparar que salen idénticos."""
import io
import os
import sys

from PIL import Image, ImageDraw


def photo(path, color, label):
    im = Image.new("RGB", (1600, 1200), color)
    d = ImageDraw.Draw(im)
    for i in range(0, 1600, 80):
        d.line([(i, 0), (1600 - i, 1200)], fill=(255, 255, 255), width=6)
    d.rectangle([200, 300, 1400, 900], outline=(0, 0, 0), width=12)
    im.save(path, "JPEG", quality=88)


def main(root, out):
    sys.path.insert(0, root)
    from app.services.pdf_photo_report import build_photo_report_pdf  # noqa: E402

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    tmp = os.path.join(os.path.dirname(out) or ".", "img")
    os.makedirs(tmp, exist_ok=True)
    items = []
    for i, c in enumerate([(200, 60, 60), (60, 160, 90), (50, 90, 200), (220, 180, 40), (120, 60, 160)], 1):
        p = os.path.join(tmp, f"{i}.jpg")
        photo(p, c, str(i))
        items.append({"numero": i, "descripcion": f"Equipo {i} instalado en rack — verificación de etiquetado y energía", "imagen": p, "lado": "cliente" if i < 4 else "site", "lado_label": ""})
    meta = {"titulo": "REPORTE FOTOGRAFICO", "lados_orden": ["cliente", "site"], "proy": "Proyecto de prueba", "cliente": "Cliente S.A.C.",
            "sot": "123456", "fecha": "20/11/2026", "cid": "CID-001", "contrata": "Contrata X", "logo_izq": None, "logo_der": None}
    build_photo_report_pdf(meta, items, out)
    print("OK", out, os.path.getsize(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

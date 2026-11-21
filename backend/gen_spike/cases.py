"""Casos de prueba de TODOS los generadores reales (los mismos archivos de app/services).
Se ejecutan igual en Python normal y en Pyodide; scripts/gen_parity/compare.py compara los resultados."""
import io
import os
import sys

from PIL import Image, ImageDraw


def photo(path, color, texture=True):
    im = Image.new("RGB", (1600, 1200), color)
    d = ImageDraw.Draw(im)
    if texture:
        for i in range(0, 1600, 80):
            d.line([(i, 0), (1600 - i, 1200)], fill=(255, 255, 255), width=6)
    d.rectangle([208, 304, 1408, 896], outline=(0, 0, 0), width=16)
    im.save(path, "JPEG", quality=88)


def icon_png():
    im = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([8, 8, 88, 88], fill=(30, 120, 220, 255), outline=(255, 255, 255, 255), width=4)
    d.rectangle([36, 36, 60, 60], fill=(255, 255, 255, 255))
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def main(root, out):
    sys.path.insert(0, root)
    os.makedirs(out, exist_ok=True)
    img = os.path.join(out, "img")
    os.makedirs(img, exist_ok=True)
    photos = []
    for i, c in enumerate([(200, 60, 60), (60, 160, 90), (50, 90, 200)], 1):
        p = os.path.join(img, f"{i}.jpg")
        if not os.path.exists(p):
            photo(p, c)
        photos.append(p)

    # ---- CheckList PDF y Word
    meta = {"titulo": "CheckList de Claro", "servicio_label": "Internet Dedicado", "sot": "123456", "cid": "CID-9", "fecha": "21/11/2026",
            "equipo": "RTR-CORE-01", "logo": None}
    sections = [
        ("1. Datos del servicio", [
            {"nombre": "Versión del equipo", "modo": "texto", "texto": "Cisco IOS XE 17.3.4\nUptime 12 weeks, 3 days\n" + "interface Gi0/0/1 description UPLINK " * 4, "cmd": "show version", "images": []},
            {"nombre": "Foto del rack", "modo": "foto", "texto": "", "cmd": "show inventory", "images": photos[:2]},
        ]),
        ("2. Pruebas", [
            {"nombre": "Ping a gateway", "modo": "texto", "texto": "!!!!!\nSuccess rate is 100 percent (5/5)", "cmd": "ping 10.0.0.1", "images": []},
            {"nombre": "Captura", "modo": "foto", "texto": "", "cmd": "", "images": photos[2:]},
        ]),
    ]
    from app.services.pdf_checklist import build_checklist_pdf
    build_checklist_pdf(meta, sections, os.path.join(out, "checklist.pdf"))
    from app.services.docx_checklist import build_checklist_docx
    build_checklist_docx(meta, sections, os.path.join(out, "checklist.docx"))

    # ---- Poder Judicial
    pj = {"portada_lineas": ["INFORME DE DISEÑO", "SEDE DE PRUEBA"], "subtitulo_lineas": ["Servicio de datos"], "version": "1.0", "periodo": "Noviembre 2026",
          "cambios": [{"version": "1.0", "fecha": "21/11/2026", "modificacion": "Versión inicial"}], "sede": "Sede de Prueba", "sot": "654321",
          "ubicacion_titulo": "Ubicación del Data Center", "direccion": "Av. Principal 123, Lima", "coordenadas": "-12.0464, -77.0428", "foto_ubicacion": photos[0],
          "sections": [{"title": "Rack principal", "cells": [{"caption": "Vista frontal", "images": photos[:2]}, {"caption": "Vista posterior", "images": photos[2:]}]}],
          "conclusiones_intro": "Se concluye lo siguiente:", "conclusiones": ["El servicio quedó operativo.", "Se verificó el etiquetado."], "logo": None}
    from app.services.pdf_poder_judicial import build_pj_report_pdf
    build_pj_report_pdf(pj, os.path.join(out, "pj.pdf"))

    # ---- Gráfica (PDF y PPTX)
    icon = icon_png()
    doc = {"w": 1920, "h": 1080, "elements": [
        {"type": "rect", "id": "a", "x": 100, "y": 100, "w": 420, "h": 160, "shape": "round", "fill": "#1E78DC", "stroke": "#0E2B5E", "strokeW": 4, "text": "Router CPE\n{IP_GESTION}", "size": 22, "color": "#FFFFFF", "bold": True, "align": "c"},
        {"type": "rect", "id": "b", "x": 800, "y": 100, "w": 300, "h": 160, "shape": "ellipse", "fill": "#E8F1FB", "stroke": "#1E78DC", "strokeW": 3, "dash": "dash", "text": "Nube ISP", "size": 20, "color": "#0E2B5E"},
        {"type": "line", "x1": 520, "y1": 180, "x2": 800, "y2": 180, "stroke": "#333333", "strokeW": 4, "tail": "triangle", "head": "none", "dash": ""},
        {"type": "line", "x1": 450, "y1": 260, "x2": 900, "y2": 520, "stroke": "#CC3300", "strokeW": 3, "tail": "triangle", "head": "oval", "dash": "dash"},
        {"type": "text", "id": "t", "x": 100, "y": 600, "w": 700, "h": 120, "text": "Diagrama de conexión\nCliente de prueba — SOT 123456", "size": 24, "bold": True, "color": "#0E2B5E", "align": "l"},
        {"type": "text", "id": "t2", "x": 900, "y": 600, "w": 700, "h": 90, "text": "Texto con fondo", "size": 20, "fill": "#FFF3C4", "color": "#333333", "align": "c"},
        {"type": "image", "id": "i", "x": 1300, "y": 100, "w": 160, "h": 160, "icon": "demo"},
        {"type": "table", "id": "tb", "x": 100, "y": 780, "cols": [300, 300, 300], "rows": [
            {"h": 60, "cells": [{"text": "Campo", "fill": "#0E2B5E", "color": "#FFFFFF", "size": 16, "bold": True}, {"text": "Valor", "fill": "#0E2B5E", "color": "#FFFFFF", "size": 16, "bold": True}, {"text": "Estado", "fill": "#0E2B5E", "color": "#FFFFFF", "size": 16, "bold": True}]},
            {"h": 60, "cells": [{"text": "IP gestión", "fill": "#E8F1FB", "size": 16}, {"text": "10.10.10.2/30", "fill": "#E8F1FB", "size": 16}, {"text": "OK", "fill": "#DFF5E1", "size": 16}]}]},
    ]}
    load = lambda k: icon  # noqa: E731
    from app.services.diagram_pdf import build_pdf
    open(os.path.join(out, "diagram.pdf"), "wb").write(build_pdf(doc, load))
    from app.services.diagram_pptx import build_pptx
    open(os.path.join(out, "diagram.pptx"), "wb").write(build_pptx(doc, load))

    # ---- Generadores locales completos (gen_local): mismos endpoints sin servidor
    import datetime as dt
    import shutil
    from app.services import gen_local
    w = gen_local.Work(os.path.join(out, "work"), icons={"demo": icon})
    for ph in photos:
        shutil.copy(ph, os.path.join(w.uploads, os.path.basename(ph)))
    names = [os.path.basename(x) for x in photos]
    now = dt.datetime(2026, 11, 21, 10, 0, 0)
    req_foto = {"titulo": "REPORTE FOTOGRAFICO", "lados": ["cliente"], "proy": "P", "cliente": "Cliente X", "sot": "5001", "fecha": "21/11/2026", "cid": "C1", "contrata": "K", "version": "01",
                "items": [{"numero": i + 1, "descripcion": f"Foto {i + 1}", "image_path": n, "lado": "cliente", "lado_label": ""} for i, n in enumerate(names)],
                "project": {"nota": "x", "imagen": names[0]}}
    r1 = gen_local.photo_report(req_foto, w, now=now)
    req_ck = {"titulo": "CheckList de Claro", "servicio_label": "Internet", "sot": "5002", "cid": "C2", "cliente": "Cliente Y", "fecha": "21/11/2026", "equipo": "RTR1",
              "sections": [{"titulo": "1. Datos", "items": [{"nombre": "Versión", "modo": "texto", "texto": "IOS 17", "cmd": "show version", "images": []}, {"nombre": "Foto", "modo": "foto", "texto": "", "cmd": "", "images": names[:2]}]}]}
    r2 = gen_local.checklist_pdf(req_ck, w, now=now)
    r3 = gen_local.checklist_docx(req_ck, w, now=now)
    req_ev = {"sot": "5003", "cliente": "Cliente Z", "items": [{"nombre": "Rack", "path": names[0], "original_path": names[1], "lado_label": "SITE"}, {"nombre": "ONT", "path": names[2], "original_path": "", "lado_label": "CLIENTE"}]}
    r4 = gen_local.evidence_zip(req_ev, w)
    client = {"sot": "7001", "nombre": "Cliente", "cid": "C", "fecha": "2026-11-21", "proy": "", "contrata": "", "datos": {"IP": "1.1.1.1"}}
    reps = [{"tipo": "foto", "nombre": "RF", "filename": r1["filename"]}, {"tipo": "checklist", "nombre": "CK", "filename": r2["filename"]}]
    wss = [{"key": "foto:x", "label": "Fotos · Site", "state": {"extras": [{"path": names[0], "nombre": "Rack", "lado": "site"}]}}]
    r5 = gen_local.package_zip(client, reps, wss, 1, w)
    pj_req = {k: v for k, v in pj.items() if k != "logo"}
    pj_req["foto_ubicacion"] = names[0]
    for sec in pj_req["sections"]:
        for cell in sec["cells"]:
            cell["images"] = [os.path.basename(x) for x in cell["images"]]
    r6 = gen_local.pj_report(pj_req, w, now=now)
    for r in (r1, r2, r3, r4, r5, r6):
        shutil.copy(r["path"], os.path.join(out, "local_" + r["filename"].replace(" ", "_")))
    print("OK", sorted(f for f in os.listdir(out) if "." in f))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

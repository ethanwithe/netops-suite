"""
gen_local.py
Generadores que corren DENTRO del equipo (Windows, Android, navegador con Pyodide) sin servidor ni base de datos.
Son los mismos generadores del servidor (pdf_photo_report, pdf_checklist, docx_checklist, pdf_poder_judicial,
diagram_pdf, diagram_pptx, zip_plans); aquí solo se reemplaza lo que en el servidor sale de la base de datos
(logos, iconos, rutas de fotos) por archivos en una carpeta de trabajo. Cada función recibe el mismo JSON que
envía la pantalla al endpoint equivalente y devuelve {"filename", "bytes"/"path", "pages", "warnings"}.
Prueba: backend/tests/test_gen_local.py y .github/workflows/gen-parity.yml (idéntico al servidor y entre entornos).
"""
import os
from typing import Callable, Optional

from app.services.naming import build_checklist_filename, build_recorrido_filename, build_report_filename

Resolve = Callable[[Optional[str]], Optional[str]]


class Work:
    """Carpeta de trabajo: fotos subidas (uploads), logos guardados (por id), iconos de la gráfica (por id) y salidas."""

    def __init__(self, root: str, logos: Optional[dict] = None, icons: Optional[dict] = None):
        self.root = root
        self.uploads = os.path.join(root, "uploads")
        self.outputs = os.path.join(root, "outputs")
        os.makedirs(self.uploads, exist_ok=True)
        os.makedirs(self.outputs, exist_ok=True)
        self.logos = logos or {}
        self.icons = icons or {}

    def upload(self, rel: Optional[str]) -> Optional[str]:
        return os.path.join(self.uploads, os.path.basename(rel)) if rel else None

    def output(self, name: str) -> str:
        return os.path.join(self.outputs, os.path.basename(name))

    def logo(self, logo_id, logo_path, label: str, warnings: list):
        if logo_id:
            if logo_id in self.logos:
                return bytes(self.logos[logo_id])
            warnings.append(f"El logo {label} elegido ya no existe en la base de datos; se omitió.")
        if logo_path:
            path = self.upload(logo_path)
            if path and os.path.isfile(path):
                return path
            warnings.append(f"No se encontró el archivo del logo {label}; se omitió.")
        return None


def _publish(w: Work, name: str, build) -> tuple:
    tmp = os.path.join(w.outputs, f".{name}.tmp")
    try:
        res = build(tmp)
        os.replace(tmp, w.output(name))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return res


def photo_report(req: dict, w: Work, now=None) -> dict:
    from app.services.pdf_photo_report import build_photo_report_pdf
    from app.services.report_project import embed_project
    warnings: list = []
    items = []
    for i in req.get("items") or []:
        img = w.upload(i.get("image_path"))
        if img and not os.path.isfile(img):
            warnings.append(f"No se encontró la foto de «{i.get('descripcion')}» en el servidor; el PDF indica «IMAGEN NO DISPONIBLE». Vuelve a subirla.")
        items.append({"numero": i.get("numero"), "descripcion": i.get("descripcion"), "imagen": img, "lado": i.get("lado"), "lado_label": i.get("lado_label")})
    meta = {
        "titulo": req.get("titulo"), "lados_orden": req.get("lados"), "proy": req.get("proy"), "cliente": req.get("cliente"),
        "sot": req.get("sot"), "fecha": req.get("fecha"), "cid": req.get("cid"), "contrata": req.get("contrata"),
        "logo_izq": w.logo(req.get("logo_izq_id"), req.get("logo_izq_path"), "izquierdo", warnings),
        "logo_der": w.logo(req.get("logo_der_id"), req.get("logo_der_path"), "derecho", warnings),
    }
    name = build_recorrido_filename(req.get("sot"), req.get("cid"), req.get("version") or "01", now=now)
    box = {}

    def build(path):
        _, pages = build_photo_report_pdf(meta, items, path)
        box["pages"] = pages
        if req.get("project") is not None:
            msg = embed_project(path, req["project"], w.uploads, resolve=w.upload)
            if msg:
                warnings.append(msg)

    _publish(w, name, build)
    return {"filename": name, "path": w.output(name), "pages": box["pages"], "warnings": warnings}


def pj_report(req: dict, w: Work, now=None) -> dict:
    from app.services.pdf_poder_judicial import build_pj_report_pdf
    from app.services.report_project import embed_project
    warnings: list = []
    data = dict(req)
    data["logo"] = w.logo(req.get("logo_id"), req.get("logo_path"), "de portada", warnings)
    data["foto_ubicacion"] = w.upload(req.get("foto_ubicacion"))
    data["sections"] = [{**sec, "cells": [{**c, "images": [w.upload(p) for p in c.get("images") or []]} for c in sec.get("cells") or []]} for sec in req.get("sections") or []]
    name = build_report_filename(req.get("sot") or req.get("sede"), req.get("sede"), prefix="ID", now=now)
    box = {}

    def build(path):
        _, pages, pj_warn = build_pj_report_pdf(data, path)
        box["pages"], box["warn"] = pages, pj_warn
        if req.get("project") is not None:
            msg = embed_project(path, req["project"], w.uploads, resolve=w.upload)
            if msg:
                pj_warn.append(msg)

    _publish(w, name, build)
    return {"filename": name, "path": w.output(name), "pages": box["pages"], "warnings": warnings + box["warn"]}


def _checklist_inputs(req: dict, w: Work):
    warnings: list = []
    sections = []
    for sec in req.get("sections") or []:
        items = []
        for it in sec.get("items") or []:
            images = []
            for p in it.get("images") or []:
                path = w.upload(p)
                if path and os.path.isfile(path):
                    images.append(path)
                else:
                    warnings.append(f"No se encontró una imagen de «{it.get('nombre')}»; vuelve a subirla.")
            items.append({"nombre": it.get("nombre"), "modo": it.get("modo"), "texto": it.get("texto"), "cmd": it.get("cmd"), "images": images})
        sections.append((sec.get("titulo"), items))
    meta = {"titulo": req.get("titulo"), "servicio_label": req.get("servicio_label"), "sot": req.get("sot"), "cid": req.get("cid"),
            "fecha": req.get("fecha"), "equipo": req.get("equipo"), "logo": w.logo(req.get("logo_id"), req.get("logo_path"), "", warnings)}
    return meta, sections, warnings


def checklist_pdf(req: dict, w: Work, now=None) -> dict:
    from app.services.pdf_checklist import build_checklist_pdf
    meta, sections, warnings = _checklist_inputs(req, w)
    name = build_checklist_filename(req.get("sot"), req.get("cliente"), now=now)
    res = _publish(w, name, lambda path: build_checklist_pdf(meta, sections, path))
    return {"filename": name, "path": w.output(name), "pages": res[1] if isinstance(res, tuple) and len(res) > 1 else None, "warnings": warnings}


def checklist_docx(req: dict, w: Work, now=None) -> dict:
    from app.services.docx_checklist import build_checklist_docx
    meta, sections, warnings = _checklist_inputs(req, w)
    name = build_checklist_filename(req.get("sot"), req.get("cliente"), now=now)[:-4] + ".docx"
    _publish(w, name, lambda path: build_checklist_docx(meta, sections, path))
    return {"filename": name, "path": w.output(name), "pages": None, "warnings": warnings}


def diagram_pdf(req: dict, w: Work) -> bytes:
    from app.services.diagram_pdf import build_pdf
    return build_pdf(req["doc"], lambda icon_id: w.icons.get(icon_id))


def diagram_pptx(req: dict, w: Work) -> bytes:
    from app.services.diagram_pptx import build_pptx
    return build_pptx(req["doc"], lambda icon_id: w.icons.get(icon_id))


def evidence_zip(req: dict, w: Work) -> dict:
    from app.services.zip_plans import plan_evidence, write_zip
    root, entries, total, missing, folders = plan_evidence(req, w.upload)
    if not total:
        raise ValueError("No hay fotos para guardar.")
    name = f"{root}.zip"
    _publish(w, name, lambda path: write_zip(path, entries))
    return {"filename": name, "path": w.output(name), "total": total, "missing": missing, "folders": folders}


def package_zip(client: dict, reportes: list, workspaces: list, version: int, w: Work) -> dict:
    """Carpeta del cliente. `reportes` y `workspaces` son lo que la app tiene guardado de ese cliente."""
    from app.services.zip_plans import plan_package, write_zip
    root, name, entries, counts = plan_package(client, reportes, workspaces, version, lambda n: w.output(n), w.upload)
    if not any(counts.values()):
        raise ValueError("Todavía no hay nada para guardar: genera el PDF de fotos, el CheckList o la gráfica, o agrega fotos a la carpeta.")
    _publish(w, name, lambda path: write_zip(path, entries))
    return {"version": version, "filename": name, "path": w.output(name), "counts": counts}

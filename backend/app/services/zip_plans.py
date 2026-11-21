"""
zip_plans.py
Qué entra en cada ZIP (evidencia fotográfica y carpeta del cliente) y cómo se escribe.
Son funciones puras (sin base de datos ni FastAPI): las usa el servidor y también el generador local
(Windows / Android / navegador), así el ZIP sale igual en todos lados.
Escritura determinista: fecha fija y sin recomprimir (las fotos y PDF ya vienen comprimidos), por lo que el mismo
contenido da exactamente los mismos bytes en cualquier equipo.
"""
import os
import zipfile
from typing import Callable, Optional

from app.services.naming import _SOT_PREFIX, clean_part

FIXED_DATE = (2020, 1, 1, 0, 0, 0)
LADOS = {"cliente": "Cliente", "site": "Site", "pop": "POP", "pdi": "PDI"}


def safe_name(text: str, fallback: str = "foto", limit: int = 80) -> str:
    t = clean_part(text).replace("/", "-")
    return (t[:limit].strip(" .") or fallback)


def write_zip(out_path: str, entries: list) -> None:
    """entries: [(nombre dentro del zip, ruta de archivo | bytes)]"""
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as z:
        for arc, src in entries:
            info = zipfile.ZipInfo(arc, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            if isinstance(src, (bytes, bytearray)):
                data = bytes(src)
            else:
                with open(src, "rb") as fh:
                    data = fh.read()
            z.writestr(info, data)


class _Unique:
    def __init__(self) -> None:
        self.used: set = set()

    def __call__(self, folder: str, name: str) -> str:
        base, ext = os.path.splitext(name)
        cand, n = name, 2
        while (folder, cand) in self.used:
            cand = f"{base} ({n}){ext}"
            n += 1
        self.used.add((folder, cand))
        return cand


def plan_evidence(req: dict, resolve_upload: Callable[[Optional[str]], Optional[str]]):
    """-> (carpeta raíz, entradas, total, faltantes, subcarpetas). req = lo que envía la pantalla de fotos."""
    sot = clean_part(_SOT_PREFIX.sub("", req.get("sot") or ""))
    cliente = clean_part(req.get("cliente"))
    root = "Evidencia fotográfica"
    if sot:
        root += f" SOT {sot}"
    if cliente:
        root += f" {cliente}"
    items = [i for i in req.get("items") or [] if i.get("path") or i.get("original_path")]
    labels = list(dict.fromkeys((i.get("lado_label") or "").strip() for i in items))
    use_sub = len(labels) > 1
    unique, counters, entries, missing = _Unique(), {}, [], 0
    for it in items:
        sub = safe_name(it.get("lado_label") or "", "General") if use_sub else ""
        counters[sub] = counters.get(sub, 0) + 1
        base = f"{counters[sub]:02d} {safe_name(it.get('nombre') or '')}"
        folder = f"{root}/{sub}" if sub else root
        final = resolve_upload(it.get("path") or it.get("original_path"))
        orig = resolve_upload(it.get("original_path")) if it.get("original_path") else ""
        edited = bool(orig and it.get("path") and orig != final)
        if final and os.path.isfile(final):
            ext = os.path.splitext(final)[1] or ".jpg"
            entries.append((f"{folder}/{unique(folder, base + (' (editada)' if edited else '') + ext)}", final))
        else:
            missing += 1
        if edited and orig and os.path.isfile(orig):
            ext = os.path.splitext(orig)[1] or ".jpg"
            entries.append((f"{folder}/{unique(folder, base + ' (sin editar)' + ext)}", orig))
    folders = [(safe_name(l, "General") if use_sub else "") for l in labels]
    return root, entries, len(items), missing, folders


def plan_package(client: dict, reportes: list, workspaces: list, version: int,
                 resolve_output: Callable[[str], Optional[str]], resolve_upload: Callable[[Optional[str]], Optional[str]]):
    """
    Carpeta del cliente: PDF de fotos, CheckList, gráficas y las fotos de la carpeta de cada ventana.
    -> (raíz, nombre del zip, entradas, conteos)
    """
    root = f"SOT {clean_part(client.get('sot'))}" + (f" {clean_part(client.get('nombre'))}" if client.get("nombre") else "")
    out_name = f"{root} v{version}.zip"
    unique, entries = _Unique(), []
    counts = {"pdf": 0, "checklist": 0, "graficas": 0, "fotos": 0}

    latest: dict = {}
    for r in reportes or []:
        if r.get("tipo") == "carpeta" or not r.get("filename"):
            continue
        latest[(r.get("tipo") or "", r.get("nombre") or "")] = r
    for r in latest.values():
        p = resolve_output(os.path.basename(r["filename"]))
        if not p or not os.path.isfile(p):
            continue
        tipo, nm = r.get("tipo") or "", r["filename"]
        if tipo == "checklist":
            folder, k = "CheckList", "checklist"
        elif tipo == "grafica":
            folder, k = "Gráficas", "graficas"
        elif nm.lower().endswith(".zip"):
            continue
        else:
            folder, k = "Reporte fotográfico", "pdf"
        entries.append((f"{root}/{folder}/{unique(folder, nm)}", p))
        counts[k] += 1

    multi = len(workspaces) > 1
    for w in workspaces:
        st = w.get("state") if isinstance(w.get("state"), dict) else {}
        ventana = safe_name((w.get("label") or w.get("key") or "").replace("Fotos ·", "").strip(), "Fotos")
        n = 0
        for e in st.get("extras") or []:
            if not isinstance(e, dict) or e.get("trashed") or not e.get("path"):
                continue
            p = resolve_upload(e["path"])
            if not p or not os.path.isfile(p):
                continue
            lado = LADOS.get(str(e.get("lado") or ""), str(e.get("lado") or "General").replace("_", " ").title())
            folder = f"Fotos/{ventana}/{lado}" if multi else f"Fotos/{lado}"
            n += 1
            nm = f"{n:02d} {safe_name(e.get('nombre') or 'foto')}{os.path.splitext(p)[1] or '.jpg'}"
            entries.append((f"{root}/{folder}/{unique(folder, nm)}", p))
            counts["fotos"] += 1

    info = [f"SOT: {client.get('sot', '')}", f"Cliente: {client.get('nombre', '')}", f"CID: {client.get('cid', '')}",
            f"Fecha: {client.get('fecha', '')}", f"Proyecto: {client.get('proy', '')}", f"Contrata: {client.get('contrata', '')}", ""]
    info += [f"{k}: {v}" for k, v in sorted((client.get("datos") or {}).items())]
    entries.append((f"{root}/Datos del cliente.txt", "\n".join(info).encode("utf-8")))
    return root, out_name, entries, counts

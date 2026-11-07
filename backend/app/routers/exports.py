"""
exports.py
Descarga de clientes en Excel, Word, PowerPoint, TXT o PDF: de todos, de un usuario, de un mes...
Cada usuario solo exporta lo suyo; el administrador puede exportar lo de cualquiera.
"""

import datetime as dt
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user, log_activity
from app.database import get_db
from app.services import client_access as ca
from app.services import filestore, security

router = APIRouter(prefix="/api/export", tags=["export"])

MEDIA = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain; charset=utf-8",
    "pdf": "application/pdf",
}
COLS = ["SOT", "Cliente", "Fecha", "CID", "Proyecto", "Contrata", "Participantes", "Punto c/u"]


def _row(c: dict) -> list[str]:
    return [c["sot"], c["nombre"], c["fecha"], c["cid"], c["proy"], c["contrata"],
            ", ".join(p["name"] for p in c["participants"]), f'{c["point"]:g}']


def _summary(state: dict) -> list[tuple[str, str]]:
    out = []
    for k, v in (state or {}).items():
        if k in ("rows", "extras") and isinstance(v, (list, dict)):
            n = len([1 for r in (v.values() if isinstance(v, dict) else v) if isinstance(r, dict) and (r.get("imagePath") or r.get("path"))])
            out.append((k, f"{n} foto(s)"))
        elif isinstance(v, (str, int, float)) and str(v).strip() and not str(v).startswith("data:"):
            out.append((k, str(v)[:200]))
        elif isinstance(v, bool):
            out.append((k, "sí" if v else "no"))
        elif isinstance(v, list):
            out.append((k, f"{len(v)} elemento(s)"))
    return out


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "export"


def _xlsx(title: str, rows: list[list[str]], extra_sheets: dict[str, list[list[str]]]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "Clientes"
    ws.append(COLS)
    for r in rows:
        ws.append(r)
    sheets = {"Clientes": ws}
    for name, data in extra_sheets.items():
        w = wb.create_sheet(name[:31])
        for r in data:
            w.append(r)
        sheets[name[:31]] = w
    for w in sheets.values():
        for cell in w[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="1F4E79")
            cell.alignment = Alignment(vertical="center")
        for col in w.columns:
            width = max((len(str(c.value or "")) for c in col), default=8)
            w.column_dimensions[col[0].column_letter].width = min(50, max(10, width + 2))
        w.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _docx(title: str, subtitle: str, rows: list[list[str]], details: list[tuple[str, list[tuple[str, str]]]]) -> bytes:
    from docx import Document
    d = Document()
    d.add_heading(title, 0)
    d.add_paragraph(subtitle)
    if rows:
        t = d.add_table(rows=1, cols=len(COLS))
        t.style = "Light Grid Accent 1"
        for i, c in enumerate(COLS):
            t.rows[0].cells[i].text = c
        for r in rows:
            cells = t.add_row().cells
            for i, v in enumerate(r):
                cells[i].text = v
    for heading, kv in details:
        d.add_heading(heading, 2)
        for k, v in kv:
            d.add_paragraph(f"{k}: {v}", style="List Bullet")
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _pptx(title: str, subtitle: str, rows: list[list[str]], details: list[tuple[str, list[tuple[str, str]]]]) -> bytes:
    from pptx import Presentation
    from pptx.util import Pt
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = title
    s.placeholders[1].text = subtitle
    per = 8
    for i in range(0, len(rows), per):
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        slide.shapes.title.text = f"Clientes ({i + 1}–{min(i + per, len(rows))} de {len(rows)})"
        chunk = rows[i:i + per]
        use = [0, 1, 2, 3, 6]
        tbl = slide.shapes.add_table(len(chunk) + 1, len(use), 457200, 1400000, 8229600, 300000 * (len(chunk) + 1)).table
        for j, ci in enumerate(use):
            tbl.cell(0, j).text = COLS[ci]
        for r, row in enumerate(chunk, start=1):
            for j, ci in enumerate(use):
                tbl.cell(r, j).text = row[ci]
        for r in range(len(chunk) + 1):
            for j in range(len(use)):
                for p in tbl.cell(r, j).text_frame.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(11)
    for heading, kv in details:
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = heading[:80]
        tf = slide.placeholders[1].text_frame
        tf.clear()
        for n, (k, v) in enumerate(kv[:14]):
            p = tf.paragraphs[0] if n == 0 else tf.add_paragraph()
            p.text = f"{k}: {v}"
            p.font.size = Pt(16)
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _txt(title: str, subtitle: str, rows: list[list[str]], details: list[tuple[str, list[tuple[str, str]]]]) -> bytes:
    out = [title, "=" * len(title), subtitle, ""]
    for r in rows:
        out.append(" | ".join(f"{c}: {v}" for c, v in zip(COLS, r) if v))
    for heading, kv in details:
        out += ["", heading, "-" * len(heading)] + [f"{k}: {v}" for k, v in kv]
    return ("\n".join(out) + "\n").encode("utf-8")


def _pdf(title: str, subtitle: str, rows: list[list[str]], details: list[tuple[str, list[tuple[str, str]]]]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    st = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    story = [Paragraph(esc(title), st["Title"]), Paragraph(esc(subtitle), st["Normal"]), Spacer(1, 10)]
    if rows:
        cell = st["BodyText"]
        cell.fontSize = 8
        data = [[Paragraph(f"<b>{c}</b>", cell) for c in COLS]] + [[Paragraph(esc(v), cell) for v in r] for r in rows]
        t = Table(data, repeatRows=1, colWidths=[60, 120, 60, 70, 110, 90, 200, 50])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d6e4f0")),
                               ("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(t)
    for heading, kv in details:
        story += [Spacer(1, 12), Paragraph(esc(heading), st["Heading2"])]
        story += [Paragraph(esc(f"{k}: {v}"), st["Normal"]) for k, v in kv]
    doc.build(story)
    return buf.getvalue()


def _build(fmt: str, title: str, subtitle: str, rows, details, extra_sheets=None) -> bytes:
    if fmt == "xlsx":
        return _xlsx(title, rows, extra_sheets or {})
    if fmt == "docx":
        return _docx(title, subtitle, rows, details)
    if fmt == "pptx":
        return _pptx(title, subtitle, rows, details)
    if fmt == "txt":
        return _txt(title, subtitle, rows, details)
    if fmt == "pdf":
        return _pdf(title, subtitle, rows, details)
    raise HTTPException(400, "Formato no válido. Usa xlsx, docx, pptx, txt o pdf.")


def _respond(fmt: str, data: bytes, name: str) -> Response:
    filestore.archive(f"{name}.{fmt}", data)
    return Response(content=data, media_type=MEDIA[fmt],
                    headers={"Content-Disposition": f'attachment; filename="{_safe(name)}.{fmt}"'})


@router.get("/clients")
def export_clients(format: str = "xlsx", scope: str = "mine", user_id: str = "", month: str = "",
                   year: int | None = None, q: str = "", user: models.User = Depends(current_user),
                   db: Session = Depends(get_db)):
    """scope=mine: mis clientes · scope=all (solo admin): todos, o los de user_id."""
    fmt = format.lower()
    if fmt not in MEDIA:
        raise HTTPException(400, "Formato no válido. Usa xlsx, docx, pptx, txt o pdf.")
    admin = security.is_admin(user)
    if scope == "all" and not admin:
        raise HTTPException(403, "Solo el administrador puede exportar los clientes de todos.")
    if scope == "all":
        clients = ca.list_clients_out(db, None, user_id=user_id, month=month, year=year, q=q)
    else:
        clients = ca.list_clients_out(db, user, month=month, year=year, q=q)
    rows = [_row(c) for c in clients]

    who = "todos los usuarios"
    if scope != "all":
        who = user.full_name or user.username
    elif user_id:
        u = db.get(models.User, user_id)
        who = (u.full_name or u.username) if u else "usuario"
    period = month or (str(year) if year else "todo el tiempo")
    title = "Clientes"
    subtitle = f"{who} · {period} · {len(rows)} cliente(s) · generado {dt.datetime.now():%Y-%m-%d %H:%M}"

    # Resumen por usuario (puntos)
    pts: dict[str, dict] = {}
    for c in clients:
        for p in c["participants"]:
            d = pts.setdefault(p["id"], {"name": p["name"], "n": 0, "pts": 0.0})
            d["n"] += 1
            d["pts"] += c["point"]
    extra = {"Resumen por usuario": [["Usuario", "Clientes", "Puntos"]] +
             [[d["name"], d["n"], round(d["pts"], 2)] for d in sorted(pts.values(), key=lambda d: -d["pts"])]}
    details = []
    if fmt in ("txt", "docx", "pptx", "pdf") and pts:
        details.append(("Resumen por usuario", [(d["name"], f'{d["n"]} cliente(s), {round(d["pts"], 2)} punto(s)') for d in sorted(pts.values(), key=lambda d: -d["pts"])]))
    data = _build(fmt, title, subtitle, rows, details, extra)
    log_activity(db, user, "exportacion", f"{fmt} · {who} · {period} · {len(rows)} cliente(s)")
    return _respond(fmt, data, f"clientes_{_safe(who)}_{period}")


@router.get("/client/{client_id}")
def export_client(client_id: str, format: str = "pdf", user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Un cliente con sus datos, reportes generados y lo guardado en cada pestaña."""
    fmt = format.lower()
    c = db.get(models.Client, client_id)
    if not c or not ca.can_access(db, user, c):
        raise HTTPException(404, "El cliente ya no existe.")
    out = ca.client_out(db, c, user.id)
    details: list[tuple[str, list[tuple[str, str]]]] = []
    base = [("SOT", out["sot"]), ("Cliente", out["nombre"]), ("Fecha", out["fecha"]), ("CID", out["cid"]),
            ("Proyecto", out["proy"]), ("Contrata", out["contrata"]),
            ("Participantes", ", ".join(p["name"] for p in out["participants"])), ("Punto c/u", f'{out["point"]:g}')]
    details.append((f"Cliente SOT {out['sot']}", [(k, v) for k, v in base if v]))
    if out["datos"]:
        details.append(("Datos", [(k, str(v)) for k, v in out["datos"].items()]))
    if out["reportes"]:
        details.append(("Reportes generados", [(r.get("generado", ""), f'{r.get("nombre") or r.get("tipo", "")} — {r.get("filename", "")}') for r in out["reportes"]]))
    for w in db.query(models.UserWorkspace).filter(models.UserWorkspace.client_id == c.id).all():
        kv = _summary(w.state)
        if kv:
            details.append((f"Pestaña: {w.label or w.key}", kv))
    subtitle = f"Generado {dt.datetime.now():%Y-%m-%d %H:%M}"
    data = _build(fmt, f"Cliente {out['sot']} — {out['nombre']}", subtitle, [_row(out)], details[1:] if fmt != "xlsx" else [],
                  {"Detalle": [["Sección", "Campo", "Valor"]] + [[h, k, v] for h, kv in details for k, v in kv]})
    log_activity(db, user, "exportacion", f"{fmt} · cliente SOT {out['sot']}", c.id)
    return _respond(fmt, data, f"cliente_{out['sot']}")

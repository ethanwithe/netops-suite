"""
pdf_photo_report.py

Genera el PDF del reporte fotográfico agrupando las fotografías
según el lado seleccionado para cada imagen:

SITE, PDI, POP, CLIENTE
"""

import os

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import HexColor
from PIL import Image, ImageOps


PAGE_W, PAGE_H = letter

MARGIN = 1.3 * cm
LOGO_H = 1.3 * cm
HEADER_H = MARGIN + LOGO_H + 0.4 * cm
INFO_TABLE_H = 2.0 * cm

GRID_COLS = 2
GRID_ROWS = 2
ITEMS_PER_PAGE = GRID_COLS * GRID_ROWS

ACCENT = HexColor("#2F5496")


# ============================================================
# FIX IMAGEN (EXIF ORIENTATION)
# ============================================================

def fix_img(path):
    try:
        if not path or not os.path.exists(path):
            return None

        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        return img

    except:
        return None


# ============================================================
# CONFIGURACIÓN DE LADOS
# ============================================================

LADO_LABELS = {
    "site": "SITE",
    "pdi": "PDI",
    "pop": "POP",
    "cliente": "CLIENTE",
}

LADO_ORDER = ["site", "pdi", "pop", "cliente"]


def _normalize_lado(lado):
    lado = str(lado or "").strip().lower()
    if lado in LADO_LABELS:
        return lado
    return "site"


def _build_lado_title(lado):
    label = LADO_LABELS.get(_normalize_lado(lado), "SITE")
    return f"REPORTE FOTOGRAFICO INSTALACION EN {label}"


def _group_items_by_lado(items):
    groups = {
        "site": [],
        "pdi": [],
        "pop": [],
        "cliente": [],
    }

    for item in items:
        lado = _normalize_lado(item.get("lado"))
        groups[lado].append(item)

    return [
        (lado, groups[lado])
        for lado in LADO_ORDER
        if groups[lado]
    ]


def _truncate_to_width(c, text, font, size, max_width):
    if c.stringWidth(text, font, size) <= max_width:
        return text

    ell = "..."
    while text and c.stringWidth(text + ell, font, size) > max_width:
        text = text[:-1]

    return text + ell if text else ell


# ============================================================
# HEADER
# ============================================================

def _draw_header(c, meta):
    top = PAGE_H

    if meta.get("logo_izq"):
        try:
            img = ImageReader(meta["logo_izq"])
            iw, ih = img.getSize()
            scale = LOGO_H / ih

            c.drawImage(
                img,
                MARGIN,
                top - MARGIN - LOGO_H,
                width=iw * scale,
                height=LOGO_H,
                preserveAspectRatio=True,
                mask="auto",
            )
        except:
            pass

    if meta.get("logo_der"):
        try:
            img = ImageReader(meta["logo_der"])
            iw, ih = img.getSize()
            scale = LOGO_H / ih
            w = iw * scale

            c.drawImage(
                img,
                PAGE_W - MARGIN - w,
                top - MARGIN - LOGO_H,
                width=w,
                height=LOGO_H,
                preserveAspectRatio=True,
                mask="auto",
            )
        except:
            pass

    c.setFont("Helvetica-BoldOblique", 13)
    c.drawCentredString(
        PAGE_W / 2,
        top - MARGIN - LOGO_H / 2,
        meta.get("titulo", "REPORTE FOTOGRAFICO"),
    )


# ============================================================
# INFO TABLE
# ============================================================

def _draw_info_table(c, meta, y_top):

    rows = [
        ("PROY:", meta.get("proy", ""), "CLIENTE:", meta.get("cliente", "")),
        ("SOT:", meta.get("sot", ""), "FECHA:", meta.get("fecha", "")),
        ("CID:", meta.get("cid", ""), "CONTRATA:", meta.get("contrata", "")),
    ]

    table_w = PAGE_W - 2 * MARGIN
    row_h = INFO_TABLE_H / 3

    col1_w = table_w * 0.12
    col2_w = table_w * 0.38
    col3_w = table_w * 0.14
    col4_w = table_w * 0.36

    x0 = MARGIN
    y = y_top

    c.rect(x0, y - INFO_TABLE_H, table_w, INFO_TABLE_H)

    for i in range(1, 3):
        c.line(x0, y - i * row_h, x0 + table_w, y - i * row_h)

    c.line(x0 + col1_w, y - INFO_TABLE_H, x0 + col1_w, y)
    c.line(x0 + col1_w + col2_w, y - INFO_TABLE_H, x0 + col1_w + col2_w, y)
    c.line(x0 + col1_w + col2_w + col3_w, y - INFO_TABLE_H, x0 + col1_w + col2_w + col3_w, y)

    for r, (l1, v1, l2, v2) in enumerate(rows):

        row_center_y = y - r * row_h - row_h / 2

        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(x0 + col1_w / 2, row_center_y, l1)

        c.setFont("Helvetica", 8)
        v1 = _truncate_to_width(c, str(v1), "Helvetica", 8, col2_w)
        c.drawCentredString(x0 + col1_w + col2_w / 2, row_center_y, v1)

        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(x0 + col1_w + col2_w + col3_w / 2, row_center_y, l2)

        c.setFont("Helvetica", 8)
        v2 = _truncate_to_width(c, str(v2), "Helvetica", 8, col4_w)
        c.drawCentredString(
            x0 + col1_w + col2_w + col3_w + col4_w / 2,
            row_center_y,
            v2,
        )

    return y - INFO_TABLE_H


# ============================================================
# FOOTER
# ============================================================

def _draw_footer(c, page_num, total_pages):
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)

    c.drawRightString(
        PAGE_W - MARGIN,
        0.7 * cm,
        f"Página {page_num} de {total_pages}",
    )


# ============================================================
# MAIN
# ============================================================

def build_photo_report_pdf(meta, items, out_path, progress_cb=None):

    def log(msg):
        if progress_cb:
            progress_cb(msg)

    groups = _group_items_by_lado(items)

    total_pages = 0
    for lado, group_items in groups:
        total_pages += max(1, (len(group_items) + 3) // 4)

    if not groups:
        total_pages = 1

    c = canvas.Canvas(out_path, pagesize=letter)

    GRID_TOP = PAGE_H - HEADER_H - INFO_TABLE_H - 0.3 * cm
    GRID_BOTTOM = 1.0 * cm

    grid_h = GRID_TOP - GRID_BOTTOM
    grid_w = PAGE_W - 2 * MARGIN

    cell_w = grid_w / GRID_COLS
    cell_h = grid_h / GRID_ROWS

    caption_h = 1.3 * cm
    photo_h = cell_h - caption_h - 0.15 * cm

    current_page = 0

    for lado, group_items in groups:

        group_title = _build_lado_title(lado)

        group_meta = {
            **meta,
            "titulo": group_title,
        }

        group_pages = max(1, (len(group_items) + 3) // 4)

        for page_idx in range(group_pages):

            current_page += 1

            start = page_idx * 4
            end = start + 4
            page_items = group_items[start:end]

            _draw_header(c, group_meta)
            _draw_info_table(c, group_meta, PAGE_H - HEADER_H)

            for idx in range(4):

                row = idx // 2
                col = idx % 2

                x = MARGIN + col * cell_w
                y_top = GRID_TOP - row * cell_h

                c.rect(x, y_top - cell_h, cell_w, cell_h)

                if idx < len(page_items):

                    item = page_items[idx]
                    img_path = item.get("imagen")

                    if img_path:

                        pil_img = fix_img(img_path)

                        try:
                            if pil_img:
                                img = ImageReader(pil_img)
                            else:
                                img = ImageReader(img_path)

                            iw, ih = img.getSize()

                            scale = min(
                                (cell_w - 10) / iw,
                                (photo_h - 10) / ih,
                            )

                            w = iw * scale
                            h = ih * scale

                            c.drawImage(
                                img,
                                x + (cell_w - w) / 2,
                                y_top - photo_h + (photo_h - h) / 2,
                                width=w,
                                height=h,
                                mask="auto",
                            )

                        except:
                            c.drawString(x + 10, y_top - 50, "Error imagen")

            _draw_footer(c, current_page, total_pages)
            c.showPage()

    c.save()

    log(f"Listo: {out_path}")
    return out_path, total_pages

"""
pdf_photo_report.py

Genera el PDF del reporte fotográfico agrupando las fotografías
según el lado seleccionado para cada imagen:

    SITE
    PDI
    POP
    CLIENTE

Cada grupo genera su propio título:

    REPORTE FOTOGRAFICO INSTALACION EN SITE
    REPORTE FOTOGRAFICO INSTALACION EN PDI
    REPORTE FOTOGRAFICO INSTALACION EN POP
    REPORTE FOTOGRAFICO INSTALACION EN CLIENTE

Los grupos son independientes.
No existe una combinación fija entre SITE, PDI, POP y CLIENTE.

Ejemplos válidos:
    SITE + CLIENTE
    PDI + CLIENTE
    POP + CLIENTE
    SITE + PDI
    SITE + POP
    PDI + POP
    SITE + PDI + POP + CLIENTE
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import HexColor


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
# CONFIGURACIÓN DE LADOS
# ============================================================

LADO_LABELS = {
    "site": "SITE",
    "pdi": "PDI",
    "pop": "POP",
    "cliente": "CLIENTE",
}

# Este orden solamente define el orden de aparición
# de las secciones en el PDF.
LADO_ORDER = [
    "site",
    "pdi",
    "pop",
    "cliente",
]


def _normalize_lado(lado):
    """
    Normaliza el lado recibido desde el frontend/backend.

    Valores esperados:
        site
        pdi
        pop
        cliente

    Si llega vacío o inválido, se utiliza SITE como respaldo.
    """
    lado = str(lado or "").strip().lower()

    if lado in LADO_LABELS:
        return lado

    return "site"


def _build_lado_title(lado):
    """
    Construye el título exacto de cada sección.
    """
    label = LADO_LABELS.get(_normalize_lado(lado), "SITE")

    return f"REPORTE FOTOGRAFICO INSTALACION EN {label}"


def _group_items_by_lado(items):
    """
    Agrupa las fotografías por lado.

    Importante:
    - SITE, PDI, POP y CLIENTE son independientes.
    - Solo se crean grupos que tengan fotografías.
    - No se mezclan los lados.
    - Se mantiene el orden SITE -> PDI -> POP -> CLIENTE.
    """

    groups = {
        "site": [],
        "pdi": [],
        "pop": [],
        "cliente": [],
    }

    for item in items:
        lado = _normalize_lado(item.get("lado"))
        groups[lado].append(item)

    # Eliminar grupos vacíos
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


def _draw_header(c, meta):
    top = PAGE_H

    # ========================================================
    # LOGO IZQUIERDO
    # ========================================================

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

        except Exception:
            pass

    # ========================================================
    # LOGO DERECHO
    # ========================================================

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

        except Exception:
            pass

    # ========================================================
    # TÍTULO
    # ========================================================

    c.setFillColorRGB(0, 0, 0)

    c.setFont(
        "Helvetica-BoldOblique",
        13,
    )

    c.drawCentredString(
        PAGE_W / 2,
        top - MARGIN - LOGO_H / 2,
        meta.get(
            "titulo",
            "REPORTE FOTOGRAFICO",
        ),
    )


def _draw_info_table(c, meta, y_top):

    rows = [
        (
            "PROY:",
            meta.get("proy", ""),
            "CLIENTE:",
            meta.get("cliente", ""),
        ),
        (
            "SOT:",
            meta.get("sot", ""),
            "FECHA:",
            meta.get("fecha", ""),
        ),
        (
            "CID:",
            meta.get("cid", ""),
            "CONTRATA:",
            meta.get("contrata", ""),
        ),
    ]

    table_w = PAGE_W - 2 * MARGIN

    row_h = INFO_TABLE_H / 3

    col1_w = table_w * 0.12
    col2_w = table_w * 0.38
    col3_w = table_w * 0.14
    col4_w = table_w * 0.36

    x0 = MARGIN
    y = y_top

    # ========================================================
    # BORDE DE TABLA
    # ========================================================

    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.8)

    c.rect(
        x0,
        y - INFO_TABLE_H,
        table_w,
        INFO_TABLE_H,
        stroke=1,
        fill=0,
    )

    # Líneas horizontales

    for i in range(1, 3):
        c.line(
            x0,
            y - i * row_h,
            x0 + table_w,
            y - i * row_h,
        )

    # Líneas verticales

    c.line(
        x0 + col1_w,
        y - INFO_TABLE_H,
        x0 + col1_w,
        y,
    )

    c.line(
        x0 + col1_w + col2_w,
        y - INFO_TABLE_H,
        x0 + col1_w + col2_w,
        y,
    )

    c.line(
        x0 + col1_w + col2_w + col3_w,
        y - INFO_TABLE_H,
        x0 + col1_w + col2_w + col3_w,
        y,
    )

    # ========================================================
    # TEXTO
    # ========================================================

    for r, (l1, v1, l2, v2) in enumerate(rows):

        # Centro vertical de la fila
        row_center_y = (
            y
            - r * row_h
            - row_h / 2
        )

        label_size = 8.5
        value_size = 8

        label_y = row_center_y - 2.5
        value_y = row_center_y - 2.3

        # ====================================================
        # PRIMER CAMPO
        # PROY / SOT / CID
        # ====================================================

        c.setFont(
            "Helvetica-Bold",
            label_size,
        )

        c.drawCentredString(
            x0 + col1_w / 2,
            label_y,
            l1,
        )

        # Valor

        c.setFont(
            "Helvetica",
            value_size,
        )

        v1_fit = _truncate_to_width(
            c,
            str(v1),
            "Helvetica",
            value_size,
            col2_w - 8,
        )

        c.drawCentredString(
            x0 + col1_w + col2_w / 2,
            value_y,
            v1_fit,
        )

        # ====================================================
        # SEGUNDO CAMPO
        # CLIENTE / FECHA / CONTRATA
        # ====================================================

        c.setFont(
            "Helvetica-Bold",
            label_size,
        )

        c.drawCentredString(
            x0 + col1_w + col2_w + col3_w / 2,
            label_y,
            l2,
        )

        # Valor

        c.setFont(
            "Helvetica",
            value_size,
        )

        v2_fit = _truncate_to_width(
            c,
            str(v2),
            "Helvetica",
            value_size,
            col4_w - 8,
        )

        c.drawCentredString(
            x0 + col1_w
            + col2_w
            + col3_w
            + col4_w / 2,
            value_y,
            v2_fit,
        )

    return y - INFO_TABLE_H


def _draw_footer(c, page_num, total_pages):

    c.setFont(
        "Helvetica",
        8,
    )

    c.setFillColorRGB(
        0.4,
        0.4,
        0.4,
    )

    c.drawRightString(
        PAGE_W - MARGIN,
        0.7 * cm,
        f"Página {page_num} de {total_pages}",
    )


def build_photo_report_pdf(
    meta,
    items,
    out_path,
    progress_cb=None,
):
    """
    Genera el reporte fotográfico.

    meta:
        dict con:
            titulo
            proy
            cliente
            sot
            fecha
            cid
            contrata
            logo_izq
            logo_der

    items:
        lista de dicts:

        {
            "numero": int,
            "descripcion": str,
            "imagen": path,
            "lado": "site" | "pdi" | "pop" | "cliente"
        }

    El PDF agrupa automáticamente las imágenes por lado.

    Ejemplo:

        Foto 1 -> SITE
        Foto 2 -> CLIENTE
        Foto 3 -> SITE
        Foto 4 -> PDI
        Foto 5 -> CLIENTE

    Resultado:

        REPORTE FOTOGRAFICO INSTALACION EN SITE
            Foto 1
            Foto 3

        REPORTE FOTOGRAFICO INSTALACION EN PDI
            Foto 4

        REPORTE FOTOGRAFICO INSTALACION EN CLIENTE
            Foto 2
            Foto 5

    Si no existen fotos de POP, no se genera ninguna sección POP.
    """

    def log(msg):
        if progress_cb:
            progress_cb(msg)

    # ========================================================
    # AGRUPAR FOTOS POR LADO
    # ========================================================

    groups = _group_items_by_lado(items)

    # ========================================================
    # CALCULAR TOTAL DE PÁGINAS
    # ========================================================

    total_pages = 0

    for lado, group_items in groups:
        group_pages = max(
            1,
            (
                len(group_items)
                + ITEMS_PER_PAGE
                - 1
            )
            // ITEMS_PER_PAGE,
        )

        total_pages += group_pages

    # Si no hay imágenes
    if not groups:
        total_pages = 1

    log(
        f"Generando Reporte Fotográfico "
        f"({len(items)} ítems, "
        f"{len(groups)} secciones, "
        f"{total_pages} páginas)..."
    )

    # ========================================================
    # CREAR PDF
    # ========================================================

    c = canvas.Canvas(
        out_path,
        pagesize=letter,
    )

    # ========================================================
    # CONFIGURACIÓN DE GRILLA
    # ========================================================

    grid_top = (
        PAGE_H
        - HEADER_H
        - INFO_TABLE_H
        - 0.3 * cm
    )

    grid_bottom = 1.0 * cm

    grid_h = grid_top - grid_bottom
    grid_w = PAGE_W - 2 * MARGIN

    cell_w = grid_w / GRID_COLS
    cell_h = grid_h / GRID_ROWS

    caption_h = 1.3 * cm

    photo_h = (
        cell_h
        - caption_h
        - 0.15 * cm
    )

    # ========================================================
    # CONTROL DE PÁGINAS
    # ========================================================

    current_page = 0

    # ========================================================
    # GENERAR CADA SECCIÓN
    # ========================================================

    for lado, group_items in groups:

        # ----------------------------------------------------
        # TÍTULO DINÁMICO DEL GRUPO
        # ----------------------------------------------------

        group_title = _build_lado_title(lado)

        group_meta = {
            **meta,
            "titulo": group_title,
        }

        # ----------------------------------------------------
        # PÁGINAS DE ESTE LADO
        # ----------------------------------------------------

        group_total_pages = max(
            1,
            (
                len(group_items)
                + ITEMS_PER_PAGE
                - 1
            )
            // ITEMS_PER_PAGE,
        )

        for group_page_idx in range(
            group_total_pages
        ):

            current_page += 1

            # -----------------------------------------------
            # ITEMS DE ESTA PÁGINA
            # -----------------------------------------------

            start_idx = (
                group_page_idx
                * ITEMS_PER_PAGE
            )

            end_idx = (
                start_idx
                + ITEMS_PER_PAGE
            )

            page_items = group_items[
                start_idx:end_idx
            ]

            # -----------------------------------------------
            # HEADER
            # -----------------------------------------------

            _draw_header(
                c,
                group_meta,
            )

            # -----------------------------------------------
            # TABLA DE INFORMACIÓN
            # -----------------------------------------------

            _draw_info_table(
                c,
                group_meta,
                PAGE_H - HEADER_H,
            )

            # -----------------------------------------------
            # GRILLA 2x2
            # -----------------------------------------------

            for idx in range(
                ITEMS_PER_PAGE
            ):

                row = idx // GRID_COLS
                col = idx % GRID_COLS

                cell_x = (
                    MARGIN
                    + col * cell_w
                )

                cell_y_top = (
                    grid_top
                    - row * cell_h
                )

                cell_y_bottom = (
                    cell_y_top
                    - cell_h
                )

                # -------------------------------------------
                # BORDE DE CELDA
                # -------------------------------------------

                c.setStrokeColorRGB(
                    0,
                    0,
                    0,
                )

                c.setLineWidth(0.8)

                c.rect(
                    cell_x,
                    cell_y_bottom,
                    cell_w,
                    cell_h,
                    stroke=1,
                    fill=0,
                )

                # -------------------------------------------
                # SI EXISTE ITEM
                # -------------------------------------------

                if idx < len(page_items):

                    item = page_items[idx]

                    img_path = item.get(
                        "imagen"
                    )

                    # ---------------------------------------
                    # IMAGEN
                    # ---------------------------------------

                    if img_path:

                        try:

                            img = ImageReader(
                                img_path
                            )

                            iw, ih = img.getSize()

                            pad = 0.15 * cm

                            max_w = (
                                cell_w
                                - 2 * pad
                            )

                            max_h = (
                                photo_h
                                - 2 * pad
                            )

                            scale = min(
                                max_w / iw,
                                max_h / ih,
                            )

                            draw_w = iw * scale
                            draw_h = ih * scale

                            img_x = (
                                cell_x
                                + (
                                    cell_w
                                    - draw_w
                                )
                                / 2
                            )

                            photo_area_bottom = (
                                cell_y_top
                                - photo_h
                                + pad
                            )

                            img_y = (
                                photo_area_bottom
                                + (
                                    max_h
                                    - draw_h
                                )
                                / 2
                            )

                            c.drawImage(
                                img,
                                img_x,
                                img_y,
                                width=draw_w,
                                height=draw_h,
                                preserveAspectRatio=True,
                                mask="auto",
                            )

                        except Exception as e:

                            c.setFont(
                                "Helvetica",
                                8,
                            )

                            c.drawCentredString(
                                cell_x
                                + cell_w / 2,
                                cell_y_top
                                - photo_h / 2,
                                f"[Error imagen: {e}]",
                            )

                    else:

                        c.setFont(
                            "Helvetica",
                            9,
                        )

                        c.setFillColorRGB(
                            0.6,
                            0.6,
                            0.6,
                        )

                        c.drawCentredString(
                            cell_x
                            + cell_w / 2,
                            cell_y_top
                            - photo_h / 2,
                            "(sin imagen)",
                        )

                    # ---------------------------------------
                    # SEPARADOR FOTO / DESCRIPCIÓN
                    # ---------------------------------------

                    c.setStrokeColorRGB(
                        0,
                        0,
                        0,
                    )

                    c.line(
                        cell_x,
                        cell_y_top
                        - photo_h
                        - 0.1 * cm,
                        cell_x + cell_w,
                        cell_y_top
                        - photo_h
                        - 0.1 * cm,
                    )

                    # ---------------------------------------
                    # ITEM + DESCRIPCIÓN
                    # ---------------------------------------

                    c.setFillColorRGB(
                        0,
                        0,
                        0,
                    )

                    c.setFont(
                        "Helvetica-Bold",
                        8.5,
                    )

                    label = (
                        f"ITEM "
                        f"{item['numero']}: "
                    )

                    c.drawString(
                        cell_x + 4,
                        cell_y_bottom
                        + caption_h
                        - 16,
                        label,
                    )

                    label_w = c.stringWidth(
                        label,
                        "Helvetica-Bold",
                        8.5,
                    )

                    c.setFont(
                        "Helvetica-Oblique",
                        8.5,
                    )

                    desc = item.get(
                        "descripcion",
                        "",
                    )

                    avail_w1 = (
                        cell_w
                        - 8
                        - label_w
                    )

                    line1 = _truncate_to_width(
                        c,
                        desc,
                        "Helvetica-Oblique",
                        8.5,
                        avail_w1,
                    )

                    c.drawString(
                        cell_x
                        + 4
                        + label_w,
                        cell_y_bottom
                        + caption_h
                        - 16,
                        line1,
                    )

                    # Segunda línea
                    if (
                        line1.endswith("...")
                        and len(line1)
                        < len(desc)
                    ):

                        remainder = desc[
                            len(line1) - 3:
                        ]

                        avail_w2 = (
                            cell_w - 8
                        )

                        line2 = _truncate_to_width(
                            c,
                            remainder,
                            "Helvetica-Oblique",
                            8.5,
                            avail_w2,
                        )

                        c.drawString(
                            cell_x + 4,
                            cell_y_bottom
                            + caption_h
                            - 30,
                            line2,
                        )

            # -----------------------------------------------
            # FOOTER
            # -----------------------------------------------

            _draw_footer(
                c,
                current_page,
                total_pages,
            )

            # -----------------------------------------------
            # SIGUIENTE PÁGINA
            # -----------------------------------------------

            c.showPage()

    # ========================================================
    # GUARDAR PDF
    # ========================================================

    c.save()

    log(
        f"Listo: {out_path} "
        f"({total_pages} páginas)"
    )

    return out_path, total_pages
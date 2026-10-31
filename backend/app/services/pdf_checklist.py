"""
pdf_checklist.py
PDF del CheckList de Claro, con el estilo de los ejemplos:

  - Arriba a la izquierda: «CheckList de Claro», «Servicio ... - CPE ...» y
    «SOT: ... CID: ...»; arriba a la derecha, el logo de la empresa.
  - Secciones (A: VALIDACION..., B: ...) con su título en negrita.
  - Cada ítem con su título (negrita subrayada) y debajo:
      * ítems de TEXTO: la salida del comando como texto (Courier, hoja blanca),
      * ítems de FOTO: las capturas subidas; si no hay captura pero sí salida
        del comando, se dibuja como captura de terminal oscura.
  - Pie: fecha a la derecha y número de página en un recuadro azul.
"""

import textwrap

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.services.logo_image import logo_reader

PAGE_W, PAGE_H = letter
MARGIN = 1.6 * cm
HEADER_H = 2.9 * cm
FOOTER_H = 1.2 * cm

TITLE_COLOR = HexColor("#2F5496")
TERM_BG = HexColor("#0c0c0c")
TERM_TEXT = HexColor("#d4d4d4")
TERM_PROMPT = HexColor("#59d858")

TEXT_FONT = "Courier"
TEXT_SIZE = 6.8
TEXT_LEAD = 8.0


def _safe(text) -> str:
    """Las fuentes estándar solo entienden latin-1; lo demás se cambia por '?'."""
    return str(text or "").replace("\t", "    ").encode("latin-1", "replace").decode("latin-1")


def _geometry():
    top = PAGE_H - HEADER_H - 0.4 * cm
    bottom = FOOTER_H + 0.4 * cm
    return top, bottom, PAGE_W - 2 * MARGIN


def _draw_header_footer(c, page_num, meta):
    top = PAGE_H
    c.setFillColorRGB(0, 0, 0)

    logo = logo_reader(meta.get("logo"))
    if logo is not None:
        try:
            c.drawImage(
                logo, PAGE_W - MARGIN - 4.6 * cm, top - MARGIN - 1.7 * cm,
                width=4.6 * cm, height=1.7 * cm,
                preserveAspectRatio=True, anchor="ne", mask="auto",
            )
        except Exception:
            pass

    x = MARGIN
    y = top - MARGIN - 0.3 * cm
    c.setFillColor(TITLE_COLOR)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(x, y, _safe(meta.get("titulo") or "CheckList de Claro"))
    c.setFillColorRGB(0.15, 0.15, 0.15)
    c.setFont("Helvetica", 9)
    c.drawString(x, y - 15, _safe(meta.get("servicio_label", "")))
    c.drawString(x, y - 28, _safe(f"SOT: {meta.get('sot', '')}   CID: {meta.get('cid', '')}"))

    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(MARGIN, top - HEADER_H, PAGE_W - MARGIN, top - HEADER_H)

    # Pie: fecha a la derecha y página en un recuadro azul
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.line(MARGIN, FOOTER_H, PAGE_W - MARGIN, FOOTER_H)
    c.setFillColor(TITLE_COLOR)
    c.setFont("Helvetica", 9.5)
    c.drawRightString(PAGE_W - MARGIN - 1.5 * cm, FOOTER_H / 2 - 3, _safe(meta.get("fecha", "")))
    c.roundRect(PAGE_W - MARGIN - 1.1 * cm, FOOTER_H / 2 - 8, 1.1 * cm, 18, 3, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(PAGE_W - MARGIN - 0.55 * cm, FOOTER_H / 2 - 3, str(page_num))


def _wrap(text, width_chars):
    out = []
    for raw in _safe(text).replace("\r", "").split("\n"):
        if not raw.strip():
            out.append("")
            continue
        out.extend(textwrap.wrap(raw, width=width_chars, replace_whitespace=False,
                                 drop_whitespace=False, break_long_words=True) or [""])
    return out


def build_checklist_pdf(meta, sections, out_path, progress_cb=None):
    """
    meta: titulo, servicio_label, sot, cid, fecha, equipo, logo
    sections: [(titulo, [item, ...]), ...]; item:
        {"nombre", "modo": "texto"|"foto", "texto", "cmd", "images": [ruta, ...]}
    Devuelve (ruta, páginas).
    """
    top, bottom, content_w = _geometry()
    char_w = TEXT_SIZE * 0.6
    chars = max(40, int(content_w / char_w))

    def render(c, draw, total=0):
        page = 1
        y = top

        def new_page():
            nonlocal page, y
            if draw:
                _draw_header_footer(c, page, meta)
                c.showPage()
            page += 1
            y = top

        def need(h):
            if y - h < bottom:
                new_page()

        for sec_title, items in sections:
            need(1.6 * cm)
            if draw:
                c.setFillColorRGB(0, 0, 0)
                c.setFont("Helvetica-Bold", 11)
                c.drawString(MARGIN, y - 11, _safe(sec_title))
            y -= 22

            for it in items:
                need(2.0 * cm)
                title = _safe(it.get("nombre", ""))
                if draw:
                    c.setFillColorRGB(0, 0, 0)
                    c.setFont("Helvetica-Bold", 9.5)
                    c.drawString(MARGIN, y - 9, title)
                    w = c.stringWidth(title, "Helvetica-Bold", 9.5)
                    c.setLineWidth(0.6)
                    c.setStrokeColorRGB(0, 0, 0)
                    c.line(MARGIN, y - 11, MARGIN + w, y - 11)
                y -= 17

                images = it.get("images") or []
                texto = (it.get("texto") or "").rstrip()
                cmd = (it.get("cmd") or "").strip()

                if it.get("modo") == "texto" and texto:
                    # Texto plano, fluye por todas las páginas que haga falta
                    lines = _wrap(texto, chars)
                    if draw:
                        c.setFont(TEXT_FONT, TEXT_SIZE)
                        c.setFillColorRGB(0, 0, 0)
                    for line in lines:
                        if y - TEXT_LEAD < bottom:
                            new_page()
                            if draw:
                                c.setFont(TEXT_FONT, TEXT_SIZE)
                                c.setFillColorRGB(0, 0, 0)
                        if draw:
                            c.drawString(MARGIN, y - TEXT_SIZE, line)
                        y -= TEXT_LEAD
                    y -= 10
                    continue

                if images:
                    for path in images:
                        try:
                            img = ImageReader(path)
                            iw, ih = img.getSize()
                        except Exception:
                            continue
                        max_w = content_w
                        max_h = (top - bottom) * 0.9
                        k = min(max_w / iw, max_h / ih, 1.6)
                        dw, dh = iw * k, ih * k
                        need(dh + 6)
                        if draw:
                            c.drawImage(img, MARGIN, y - dh, width=dw, height=dh,
                                        preserveAspectRatio=True, mask="auto")
                        y -= dh + 10
                    continue

                if texto:
                    # Ítem de foto sin captura subida: la salida se dibuja como terminal
                    prompt = f"{meta.get('equipo') or 'equipo'}# {cmd}" if cmd else ""
                    lines = _wrap(prompt + ("\n" if prompt else "") + texto, chars - 2)
                    pad = 0.25 * cm
                    i = 0
                    while i < len(lines):
                        room = int((y - bottom - 2 * pad) / TEXT_LEAD)
                        if room < 6:
                            new_page()
                            continue
                        chunk = lines[i:i + room]
                        h = 2 * pad + len(chunk) * TEXT_LEAD
                        if draw:
                            c.setFillColor(TERM_BG)
                            c.rect(MARGIN, y - h, content_w, h, fill=1, stroke=0)
                            c.setFont(TEXT_FONT, TEXT_SIZE)
                            ty = y - pad - TEXT_SIZE
                            for j, line in enumerate(chunk):
                                c.setFillColor(TERM_PROMPT if (i == 0 and j == 0 and prompt) else TERM_TEXT)
                                c.drawString(MARGIN + pad, ty, line)
                                ty -= TEXT_LEAD
                        y -= h + 8
                        i += room
                    y -= 4
                    continue

                # Sin captura ni salida
                if draw:
                    c.setFont("Helvetica-Oblique", 8.5)
                    c.setFillColorRGB(0.55, 0.55, 0.55)
                    c.drawString(MARGIN, y - 8, "(sin captura)")
                y -= 20

        if draw:
            _draw_header_footer(c, page, meta)
            c.showPage()
        return page

    total = render(canvas.Canvas(out_path, pagesize=letter), False)
    if progress_cb:
        progress_cb(f"Generando CheckList ({total} páginas)...")
    c = canvas.Canvas(out_path, pagesize=letter)
    render(c, True, total)
    c.save()
    return out_path, total

"""
docx_checklist.py
CheckList en Word (.docx): el mismo contenido que el PDF (cabecera con logo, secciones, ítems con su salida de
comando o sus capturas, pie con fecha y número de página), editable en Word.
"""
import io
import os
from typing import List, Tuple

from docx import Document
from docx.enum.section import WD_ORIENT  # noqa: F401  (hoja vertical por defecto)
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from PIL import Image, ImageOps

TITLE = RGBColor(0x2F, 0x54, 0x96)
MONO = "Courier New"


def _stream(src) -> Tuple[io.BytesIO, int, int]:
    """Imagen (ruta o bytes) -> flujo PNG/JPEG que Word entiende, y su tamaño en píxeles (máx. 1800 px de ancho)."""
    im = Image.open(io.BytesIO(bytes(src)) if isinstance(src, (bytes, bytearray)) else src)
    im = ImageOps.exif_transpose(im)
    im.load()
    if im.width > 1800:
        im = im.resize((1800, max(1, round(im.height * 1800 / im.width))))
    out = io.BytesIO()
    if im.mode in ("RGBA", "LA", "P"):
        im.convert("RGBA").save(out, "PNG")
    else:
        im.convert("RGB").save(out, "JPEG", quality=88)
    out.seek(0)
    return out, im.width, im.height


def _border_bottom(paragraph, color="999999", size=6):
    p_pr = paragraph._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr")
    el = OxmlElement("w:bottom")
    for k, v in (("w:val", "single"), ("w:sz", str(size)), ("w:space", "4"), ("w:color", color)):
        el.set(qn(k), v)
    b.append(el)
    p_pr.append(b)


def _shade(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:color"), "auto")
    sh.set(qn("w:fill"), hex_fill)
    tc_pr.append(sh)


def _field(run, instr):
    for t, text in (("begin", None), (None, instr), ("end", None)):
        if t:
            f = OxmlElement("w:fldChar")
            f.set(qn("w:fldCharType"), t)
            run._r.append(f)
        else:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = text
            run._r.append(it)


def _run(par, text, size=9, bold=False, italic=False, underline=False, color=None, font=None):
    r = par.add_run(text)
    r.font.size = Pt(size)
    r.bold, r.italic, r.underline = bold, italic, underline
    if color is not None:
        r.font.color.rgb = color
    if font:
        r.font.name = font
        r._r.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), font)
    return r


def _tight(par, before=0, after=0):
    par.paragraph_format.space_before = Pt(before)
    par.paragraph_format.space_after = Pt(after)
    par.paragraph_format.line_spacing = 1.0


def _colored(par, line, dark, first=False):
    """Una línea con colores tipo MobaXterm (IPs, interfaces, up/down, prompt)."""
    from app.services.term_colors import line_segments
    base = RGBColor(0xD4, 0xD4, 0xD4) if dark else RGBColor(0, 0, 0)
    for txt, rgb in line_segments(line, dark, first):
        _run(par, txt, 7, font=MONO, color=RGBColor(*rgb) if rgb else base)


def build_checklist_docx(meta: dict, sections: List[tuple], out_path: str) -> str:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.59), Cm(27.94)  # carta, como el PDF
    sec.left_margin = sec.right_margin = Cm(1.6)
    sec.top_margin, sec.bottom_margin = Cm(3.2), Cm(2.0)
    sec.header_distance, sec.footer_distance = Cm(0.9), Cm(0.6)
    content_w = 21.59 - 3.2  # cm

    st = doc.styles["Normal"]
    st.font.name = "Calibri"
    st.font.size = Pt(9)

    # ---------------- cabecera: texto a la izquierda y logo a la derecha, en una tabla (no se desordena) ----------------
    hdr = sec.header
    hdr.is_linked_to_previous = False
    t = hdr.add_table(1, 2, Cm(content_w))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    left, right = t.rows[0].cells
    left.width, right.width = Cm(content_w - 5.0), Cm(5.0)
    p = left.paragraphs[0]
    _tight(p)
    _run(p, meta.get("titulo") or "CheckList de Claro", 13, bold=True, color=TITLE)
    p2 = left.add_paragraph()
    _tight(p2, 3)
    _run(p2, meta.get("servicio_label", ""), 9, color=RGBColor(0x26, 0x26, 0x26))
    p3 = left.add_paragraph()
    _tight(p3, 2)
    _run(p3, f"SOT: {meta.get('sot', '')}   CID: {meta.get('cid', '')}", 9, color=RGBColor(0x26, 0x26, 0x26))
    rp = right.paragraphs[0]
    rp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _tight(rp)
    logo = meta.get("logo")
    if logo:
        try:
            buf, w, h = _stream(logo if isinstance(logo, (bytes, bytearray)) else (logo if os.path.isfile(str(logo)) else b""))
            k = min(4.6 / (w / h), 1.7)  # alto en cm: cabe en 4,6 cm de ancho y 1,7 cm de alto
            rp.add_run().add_picture(buf, height=Cm(k))
        except Exception:
            pass
    # raya bajo la cabecera
    line = hdr.add_paragraph()
    _tight(line)
    _border_bottom(line)
    # el párrafo vacío que Word trae al crear el encabezado se quita
    first = hdr.paragraphs[0]
    if not first.text and first._p.getnext() is not None and first is not line:
        first._p.getparent().remove(first._p)

    # ---------------- pie: fecha y número de página ----------------
    ft = sec.footer
    ft.is_linked_to_previous = False
    fp = ft.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _tight(fp)
    _border_bottom(fp, size=4)
    r = _run(fp, f"{meta.get('fecha', '')}     Página ", 9.5, color=TITLE)
    pg = _run(fp, "", 9.5, bold=True, color=TITLE)
    _field(pg, "PAGE")

    # ---------------- cuerpo ----------------
    body = doc.paragraphs[0] if doc.paragraphs else doc.add_paragraph()
    _tight(body)
    first_sec = True
    for sec_title, items in sections:
        p = body if first_sec else doc.add_paragraph()
        first_sec = False
        _tight(p, 8, 4)
        p.paragraph_format.keep_with_next = True
        _run(p, str(sec_title or ""), 11, bold=True)
        for it in items:
            tp = doc.add_paragraph()
            _tight(tp, 6, 3)
            tp.paragraph_format.keep_with_next = True
            _run(tp, str(it.get("nombre", "")), 9.5, bold=True, underline=True)
            texto = (it.get("texto") or "").rstrip()
            images = it.get("images") or []
            cmd = (it.get("cmd") or "").strip()
            if it.get("modo") == "texto" and texto:
                for k, ln in enumerate(texto.replace("\r", "").split("\n")):
                    lp = doc.add_paragraph()
                    _tight(lp)
                    _colored(lp, ln.replace("\t", "    "), False, k == 0)
                continue
            if images:
                for path in images:
                    try:
                        buf, w, h = _stream(path)
                    except Exception:
                        continue
                    pp = doc.add_paragraph()
                    _tight(pp, 0, 4)
                    max_w, max_h = content_w, 19.0
                    wc = min(max_w, max_h * w / h)
                    pp.add_run().add_picture(buf, width=Cm(wc))
                continue
            if texto:
                # sin captura pero con salida: bloque oscuro tipo terminal
                tbl = doc.add_table(1, 1)
                tbl.autofit = True
                cell = tbl.rows[0].cells[0]
                _shade(cell, "0C0C0C")
                prompt = f"{meta.get('equipo') or 'equipo'}# {cmd}" if cmd else ""
                lines = ([prompt] if prompt else []) + texto.replace("\r", "").split("\n")
                cell.paragraphs[0].text = ""
                for i, ln in enumerate(lines):
                    lp = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
                    _tight(lp)
                    _colored(lp, ln.replace("\t", "    "), True, i == 0)
                continue
            sp = doc.add_paragraph()
            _tight(sp, 0, 6)
            _run(sp, "(sin captura)", 8.5, italic=True, color=RGBColor(0x8C, 0x8C, 0x8C))

    doc.save(out_path)
    return out_path

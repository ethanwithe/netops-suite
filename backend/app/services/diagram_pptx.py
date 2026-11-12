"""
diagram_pptx.py
Convierte un diagrama (elementos ya con sus campos resueltos) en un PowerPoint editable:
cuadros de texto, formas, líneas con flecha, iconos (imágenes) y tablas reales.
"""

import io
import re
from copy import deepcopy

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

EMU_PX = 9525
# El editor y el PDF dibujan la letra a «tamaño × 1,2698» px; 1 px = 0,75 pt. Con Pt(tamaño) a secas el PowerPoint salía un 5 % más
# grande que el editor y los textos se montaban o se salían de su caja.
FONT_K = 1.2698 * 0.75
A = "http://schemas.openxmlformats.org/drawingml/2006/main"


def emu(v) -> int:
    return int(round(float(v) * EMU_PX))


def rgb(c: str | None) -> RGBColor | None:
    if not c or not re.match(r"^#[0-9a-fA-F]{6}$", c):
        return None
    return RGBColor.from_string(c[1:].upper())


def family(font: str) -> str:
    first = (font or "Arial").split(",")[0].strip().strip("'\"")
    return "Arial" if first in ("Liberation Sans", "Helvetica", "sans-serif") else first


def parse_markup(line: str, base_bold: bool, base_italic: bool):
    out, bold, italic, buf, i = [], base_bold, base_italic, "", 0
    while i < len(line):
        if line.startswith("**", i):
            if buf: out.append((buf, bold, italic)); buf = ""
            bold = not bold; i += 2
        elif line.startswith("~~", i):
            if buf: out.append((buf, bold, italic)); buf = ""
            italic = not italic; i += 2
        else:
            buf += line[i]; i += 1
    if buf: out.append((buf, bold, italic))
    return out


def _el(tag: str, **attrs):
    e = etree.SubElement(etree.Element("dummy"), qn(tag))
    for k, v in attrs.items():
        e.set(k, str(v))
    return e


def _fill_xml(fill):
    """Relleno (color o degradado) como elemento DrawingML, o noFill."""
    if not fill:
        return _el("a:noFill")
    if isinstance(fill, str):
        sf = _el("a:solidFill")
        etree.SubElement(sf, qn("a:srgbClr")).set("val", fill.lstrip("#").upper())
        return sf
    g = _el("a:gradFill", rotWithShape="1")
    gs = etree.SubElement(g, qn("a:gsLst"))
    for pos, col in fill["grad"]:
        s = etree.SubElement(gs, qn("a:gs")); s.set("pos", str(int(float(pos) * 1000)))
        etree.SubElement(s, qn("a:srgbClr")).set("val", col.lstrip("#").upper())
    lin = etree.SubElement(g, qn("a:lin")); lin.set("ang", str(int(float(fill.get("angle", 0)) * 60000))); lin.set("scaled", "1")
    return g


# Orden que exige el esquema dentro de <p:spPr>: xfrm, geometría, RELLENO, LÍNEA, efectos… PowerPoint ignora (y usa el
# estilo azul con degradado de la plantilla) lo que llegue desordenado; LibreOffice no es tan estricto.
_AFTER_FILL = ("a:ln", "a:effectLst", "a:effectDag", "a:scene3d", "a:sp3d", "a:extLst")
_AFTER_LINE = ("a:effectLst", "a:effectDag", "a:scene3d", "a:sp3d", "a:extLst")


def _insert_ordered(spPr, new, after_tags):
    for tag in after_tags:
        nxt = spPr.find(qn(tag))
        if nxt is not None:
            nxt.addprevious(new)
            return
    spPr.append(new)


def _drop_style(shape):
    """Quita <p:style> (relleno/línea/fuente por defecto del tema) para que nada azul se cuele por detrás."""
    st = shape._element.find(qn("p:style"))
    if st is not None:
        shape._element.remove(st)


def _set_sp_fill(shape, fill):
    spPr = shape._element.spPr
    for tag in ("a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill"):
        for e in spPr.findall(qn(tag)):
            spPr.remove(e)
    _insert_ordered(spPr, _fill_xml(fill), _AFTER_FILL)


def _set_line(shape, color, width_px, dash="", head="", tail=""):
    spPr = shape._element.spPr
    for e in spPr.findall(qn("a:ln")):
        spPr.remove(e)
    ln = etree.Element(qn("a:ln"))
    _insert_ordered(spPr, ln, _AFTER_LINE)
    if not color or not width_px:
        etree.SubElement(ln, qn("a:noFill"))
        return
    ln.set("w", str(emu(width_px)))
    sf = etree.SubElement(ln, qn("a:solidFill"))
    etree.SubElement(sf, qn("a:srgbClr")).set("val", color.lstrip("#").upper())
    if dash and dash != "solid":
        etree.SubElement(ln, qn("a:prstDash")).set("val", dash)
    if head:
        etree.SubElement(ln, qn("a:headEnd")).set("type", head)
    if tail:
        etree.SubElement(ln, qn("a:tailEnd")).set("type", tail)


def _style_run(run, font, size, bold, italic, color, bg=None):
    f = run.font
    f.name = family(font)
    f.size = Pt(round(float(size) * FONT_K, 2))
    f.bold = bool(bold)
    f.italic = bool(italic)
    c = rgb(color)
    if c is not None:
        f.color.rgb = c
    if bg and re.match(r"^#[0-9a-fA-F]{6}$", bg):
        rPr = run._r.get_or_add_rPr()
        hl = etree.SubElement(rPr, qn("a:highlight"))
        etree.SubElement(hl, qn("a:srgbClr")).set("val", bg.lstrip("#").upper())
        # el orden del esquema: relleno de letra antes que highlight
        sf = rPr.find(qn("a:solidFill"))
        if sf is not None:
            rPr.remove(sf); rPr.insert(0, sf)


_VANCHOR = {"t": MSO_ANCHOR.TOP, "m": MSO_ANCHOR.MIDDLE, "b": MSO_ANCHOR.BOTTOM}


def _fill_paragraphs(tf, text, *, size, bold, italic, color, align, line_h=None, spc_bef=0, font="Arial"):  # noqa
    for i, line in enumerate((text or "").split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = {"c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT, "j": PP_ALIGN.JUSTIFY}.get(align, PP_ALIGN.LEFT)
        if line_h:
            p.line_spacing = Pt(round(float(line_h) * 0.75, 2))
        if spc_bef and i > 0:
            p.space_before = Pt(round(float(spc_bef) * 0.75, 2))
        for t, b, it in parse_markup(line, bool(bold), bool(italic)):
            r = p.add_run()
            r.text = t
            _style_run(r, font, size, b, it, color)
        if not line:
            etree.SubElement(p._p, qn("a:endParaRPr")).set("sz", str(int(size * FONT_K * 100)))


def _rotate(shape, rot):
    if rot:
        shape.rotation = float(rot) % 360


HEAD = {"none": "", "triangle": "triangle", "arrow": "arrow", "stealth": "stealth", "oval": "oval", "diamond": "diamond"}


def _grad(c):
    g = c.get("grad")
    if g and g.get("colors"):
        n = max(1, len(g["colors"]) - 1)
        return {"grad": [(i * 100 / n, col) for i, col in enumerate(g["colors"])], "angle": g.get("ang", 90)}
    return c.get("fill")


def clean_icon(data: bytes) -> bytes | None:
    """Reescribe el icono como PNG limpio (RGBA, sin perfil de color ni formatos raros).
    PowerPoint dibuja mal algunos PNG/GIF/WEBP (paleta con transparencia, 16 bits, perfiles ICC): salen como un bloque
    de color liso por encima de todo. Pasarlos por aquí lo evita; además admite WEBP, que PowerPoint no lee."""
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        im.load()
        if max(im.size) > 2000:
            k = 2000 / max(im.size)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))))
        im = im.convert("RGBA")
        out = io.BytesIO()
        im.save(out, "PNG")
        return out.getvalue()
    except Exception:
        return data  # que python-pptx decida si lo entiende


def build_pptx(doc: dict, load_icon) -> bytes:
    from app.services.diagram_fit import fit_doc, PAD_X
    doc = fit_doc(doc)
    prs = Presentation()
    W, H = doc.get("w", 1920), doc.get("h", 1080)
    prs.slide_width, prs.slide_height = Emu(emu(W)), Emu(emu(H))
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    for ph in list(slide.placeholders):
        ph._element.getparent().remove(ph._element)
    sh = slide.shapes

    for el in doc.get("elements", []):
        t = el.get("type")
        if t == "rect":
            s = sh.add_shape(MSO_SHAPE.RECTANGLE, emu(el["x"]), emu(el["y"]), emu(el["w"]), emu(el["h"]))
            s.shadow.inherit = False
            _set_sp_fill(s, el.get("fill"))
            _set_line(s, el.get("stroke"), el.get("strokeW", 0), el.get("dash", ""))
            _drop_style(s)
            if (el.get("text") or "").strip():
                tf = s.text_frame
                tf.word_wrap = True
                tf.vertical_anchor = _VANCHOR.get(el.get("valign") or "m", MSO_ANCHOR.MIDDLE)
                _fill_paragraphs(tf, el["text"], size=el.get("size", 16), bold=el.get("bold"), italic=el.get("italic"),
                                 color=el.get("color") or "#000000", align=el.get("align", "c"))
            _rotate(s, el.get("rot"))
        elif t == "text":
            tb = sh.add_textbox(emu(el["x"]), emu(el["y"]), emu(el["w"]), emu(el.get("h", 20)))
            tf = tb.text_frame
            tf.word_wrap = not el.get("nowrap")
            tf.auto_size = MSO_AUTO_SIZE.NONE
            tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
            if el.get("fill"):
                _set_sp_fill(tb, el["fill"])
                # sobre el color la letra no toca el borde: aire a los lados y centrada en vertical
                tf.margin_left = tf.margin_right = Emu(emu(PAD_X))
            tf.vertical_anchor = _VANCHOR.get(el.get("valign") or ("m" if el.get("fill") else "t"), MSO_ANCHOR.TOP)
            _fill_paragraphs(tf, el.get("text", ""), size=el.get("size", 12), bold=el.get("bold"), italic=el.get("italic"),
                             color=el.get("color") or "#000000", align=el.get("align", "l"), line_h=el.get("lineH"), spc_bef=el.get("spcBef"))
            _rotate(tb, el.get("rot"))
        elif t == "line":
            c = sh.add_connector(MSO_CONNECTOR.STRAIGHT, emu(el["x1"]), emu(el["y1"]), emu(el["x2"]), emu(el["y2"]))
            _set_line(c, el.get("stroke", "#000000"), el.get("strokeW", 1), el.get("dash", ""),
                      HEAD.get(el.get("head") or "none", ""), HEAD.get(el.get("tail") or "none", ""))
            _drop_style(c)
        elif t == "image":
            data = load_icon(el.get("icon"))
            if not data:
                continue
            data = clean_icon(data)
            if not data:
                continue
            pic = sh.add_picture(io.BytesIO(data), emu(el["x"]), emu(el["y"]), emu(el["w"]), emu(el["h"]))
            _rotate(pic, el.get("rot"))
        elif t == "table":
            _add_table(sh, el)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _add_table(sh, el):
    rows, cols = el["rows"], el["cols"]
    gf = sh.add_table(len(rows), len(cols), emu(el["x"]), emu(el["y"]), emu(sum(cols)), emu(sum(r["h"] for r in rows)))
    tbl = gf.table
    tblPr = tbl._tbl.tblPr
    for k in list(tblPr.attrib):
        del tblPr.attrib[k]
    for sid in tblPr.findall(qn("a:tableStyleId")):
        tblPr.remove(sid)
    for i, w in enumerate(cols):
        tbl.columns[i].width = Emu(emu(w))
    for i, r in enumerate(rows):
        tbl.rows[i].height = Emu(emu(r["h"]))
    for ri, row in enumerate(rows):
        for ci, c in enumerate(row["cells"]):
            if c.get("merged"):
                continue
            cell = tbl.cell(ri, ci)
            if (c.get("span") or 1) > 1:
                cell.merge(tbl.cell(ri, min(len(cols) - 1, ci + c["span"] - 1)))
            tf = cell.text_frame
            tf.word_wrap = True
            _fill_paragraphs(tf, c.get("text", ""), size=c.get("size", 12), bold=c.get("bold"), italic=c.get("italic"),
                             color=c.get("color") or "#000000", align=c.get("align", "l"), font="Calibri")
            cell.margin_left = cell.margin_right = 0
            cell.margin_top = cell.margin_bottom = 0
            cell.vertical_anchor = _VANCHOR.get(c.get("valign") or "m", MSO_ANCHOR.MIDDLE)
            tcPr = cell._tc.get_or_add_tcPr()
            for tag in ("a:noFill", "a:solidFill", "a:gradFill", "a:lnL", "a:lnR", "a:lnT", "a:lnB"):
                for e in tcPr.findall(qn(tag)):
                    tcPr.remove(e)
            for side in ("lnL", "lnR", "lnT", "lnB"):
                ln = etree.SubElement(tcPr, qn("a:" + side)); ln.set("w", "12700")
                sf = etree.SubElement(ln, qn("a:solidFill")); etree.SubElement(sf, qn("a:srgbClr")).set("val", "FFFFFF")
            tcPr.append(_fill_xml(_grad(c)))

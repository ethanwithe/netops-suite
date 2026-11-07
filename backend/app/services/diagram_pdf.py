"""
diagram_pdf.py
Dibuja el documento del editor de diagramas (lienzo 1920×1080 px) como PDF vectorial con reportlab:
textos, formas, líneas con flecha, iconos y tablas. Mismo formato de datos que diagram_pptx.py.
"""
import io
import math
import re
from typing import Callable

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

K = 0.75          # puntos de PDF por px del lienzo
PT = 1.2698       # px por punto de fuente (igual que en el PPTX)
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


def _col(c, default="#000000"):
    m = _HEX.match(c or "")
    return HexColor("#" + (m.group(1) if m else default.lstrip("#")))


def _font(bold, italic):
    return "Helvetica" + ("-BoldOblique" if bold and italic else "-Bold" if bold else "-Oblique" if italic else "")


def _text(c: canvas.Canvas, el: dict, x, y, w, h, anchor_mid=False, inner_pad=0.0, fscale=1.0):
    """Texto dentro de la caja (x, y, w, h) en px del lienzo (y hacia abajo)."""
    size = float(el.get("size", 12) or 12) * fscale
    fpx = size * PT
    font = _font(el.get("bold"), el.get("italic"))
    fpt = fpx * K
    lead = (float(el["lineH"]) if el.get("lineH") else fpx * 1.17) * K
    spc = float(el.get("spcBef") or 0) * K
    c.setFillColor(_col(el.get("color")))
    maxw = max(1, (w - 2 * inner_pad) * K)
    if fscale < 1:  # celdas de tabla: si una palabra no cabe, se achica la letra en vez de partirla
        from reportlab.pdfbase.pdfmetrics import stringWidth
        txt = str(el.get("text", ""))
        parts_ = [txt] if ("\n" not in txt and len(txt) <= 22) else txt.split()
        widest = max((stringWidth(wd, font, fpt) for wd in parts_), default=0)
        if widest > maxw:
            fpt *= maxw / widest
    c.setFont(font, fpt)
    lines: list[tuple[str, float]] = []
    for pi, para in enumerate(str(el.get("text", "")).split("\n")):
        parts = simpleSplit(para, font, fpt, maxw) if not el.get("nowrap") else [para]
        for k, ln in enumerate(parts or [""]):
            lines.append((ln, spc if (k == 0 and pi > 0) else 0))
    total = sum(lead + s for _, s in lines)
    top = (h * K - total) / 2 if anchor_mid else 0
    cy = top
    al = el.get("align", "l")
    for ln, s in lines:
        cy += s + lead
        base = (y * K) + (cy - lead) + (lead - fpt) / 2 + fpt * 0.82
        if al == "c":
            c.drawCentredString((x + w / 2) * K, -base, ln)
        elif al == "r":
            c.drawRightString((x + w - inner_pad) * K, -base, ln)
        else:
            c.drawString((x + inner_pad) * K, -base, ln)


def _arrow(c, x, y, ang, kind, size):
    c.saveState()
    c.translate(x * K, -y * K)
    c.rotate(-math.degrees(ang))
    s = size * K
    if kind in ("triangle", "arrow", "stealth"):
        p = c.beginPath()
        p.moveTo(0, 0); p.lineTo(-s * 1.6, s * 0.7); p.lineTo(-s * 1.6, -s * 0.7); p.close()
        c.drawPath(p, fill=1, stroke=0)
    elif kind == "oval":
        c.circle(-s * 0.5, 0, s * 0.6, fill=1, stroke=0)
    elif kind == "diamond":
        p = c.beginPath()
        p.moveTo(0, 0); p.lineTo(-s, s * 0.7); p.lineTo(-s * 2, 0); p.lineTo(-s, -s * 0.7); p.close()
        c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


def _dash(c, dash):
    m = {"dash": [6, 3], "lgDash": [10, 4], "sysDash": [4, 2], "dot": [1.5, 2.5], "sysDot": [1.5, 2.5], "dashDot": [6, 3, 1.5, 3]}
    c.setDash(m.get(dash or "", []))


def build_pdf(doc: dict, load_icon: Callable[[str], bytes | None]) -> bytes:
    W, H = float(doc.get("w", 1920)), float(doc.get("h", 1080))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W * K, H * K))
    c.translate(0, H * K)      # origen arriba-izquierda; y positiva hacia abajo => se usa -y

    def rotated(el, fn):
        rot = float(el.get("rot") or 0)
        c.saveState()
        if rot:
            cx, cy = (el["x"] + el["w"] / 2) * K, -(el["y"] + el["h"] / 2) * K
            c.translate(cx, cy); c.rotate(-rot); c.translate(-cx, -cy)
        fn()
        c.restoreState()

    for el in doc.get("elements", []):
        t = el.get("type")
        if t == "text":
            def draw(el=el):
                if el.get("fill"):
                    c.setFillColor(_col(el["fill"]))
                    c.rect(el["x"] * K, -(el["y"] + el["h"]) * K, el["w"] * K, el["h"] * K, fill=1, stroke=0)
                _text(c, el, el["x"], el["y"], el["w"], el["h"])
            rotated(el, draw)
        elif t == "rect":
            def draw(el=el):
                fill = bool(el.get("fill")); line = bool(el.get("stroke")) and bool(el.get("strokeW"))
                if fill:
                    c.setFillColor(_col(el["fill"]))
                if line:
                    c.setStrokeColor(_col(el["stroke"])); c.setLineWidth(float(el.get("strokeW", 1)) * K); _dash(c, el.get("dash"))
                if fill or line:
                    c.rect(el["x"] * K, -(el["y"] + el["h"]) * K, el["w"] * K, el["h"] * K, fill=int(fill), stroke=int(line))
                    c.setDash([])
                if str(el.get("text", "")).strip():
                    _text(c, el, el["x"], el["y"], el["w"], el["h"], anchor_mid=True)
            rotated(el, draw)
        elif t == "image":
            data = load_icon(el.get("icon", ""))
            if data:
                def draw(el=el, data=data):
                    c.drawImage(ImageReader(io.BytesIO(data)), el["x"] * K, -(el["y"] + el["h"]) * K, el["w"] * K, el["h"] * K, mask="auto")
                rotated(el, draw)
        elif t == "line":
            col = _col(el.get("stroke"))
            c.setStrokeColor(col); c.setFillColor(col)
            wpx = float(el.get("strokeW", 2) or 2)
            c.setLineWidth(wpx * K); _dash(c, el.get("dash"))
            c.line(el["x1"] * K, -el["y1"] * K, el["x2"] * K, -el["y2"] * K)
            c.setDash([])
            ang = math.atan2(-(el["y2"] - el["y1"]), el["x2"] - el["x1"])
            if el.get("tail", "none") != "none":
                _arrow(c, el["x2"], el["y2"], ang, el["tail"], max(6, wpx * 3))
            if el.get("head", "none") != "none":
                _arrow(c, el["x1"], el["y1"], ang + math.pi, el["head"], max(6, wpx * 3))
        elif t == "table":
            _table(c, el)
    c.showPage()
    c.save()
    return buf.getvalue()


def _table(c: canvas.Canvas, el: dict) -> None:
    cols, rows = el["cols"], el["rows"]
    y = el["y"]
    for row in rows:
        x = el["x"]
        ci = 0
        for cell in row["cells"]:
            if cell.get("merged"):      # ya está cubierta por la celda anterior (span)
                continue
            span = max(1, int(cell.get("span", 1) or 1))
            w = sum(cols[ci:ci + span])
            h = row["h"]
            g = cell.get("grad")
            if g and g.get("colors"):
                cs = g["colors"]
                mid = _col(cs[len(cs) // 2])
                c.setFillColor(mid)
                c.rect(x * K, -(y + h) * K, w * K, h * K, fill=1, stroke=0)
                # degradado vertical sencillo: franjas
                n = 12
                for k in range(n):
                    t = k / (n - 1)
                    a, b = (_col(cs[0]), _col(cs[-1]))
                    colr = Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t)
                    c.setFillColor(colr)
                    c.rect(x * K, -(y + h) * K + (h * K) * k / n, w * K, h * K / n + .3, fill=1, stroke=0)
            elif cell.get("fill"):
                c.setFillColor(_col(cell["fill"]))
                c.rect(x * K, -(y + h) * K, w * K, h * K, fill=1, stroke=0)
            c.setStrokeColor(HexColor("#FFFFFF")); c.setLineWidth(1 * K)
            c.rect(x * K, -(y + h) * K, w * K, h * K, fill=0, stroke=1)
            _text(c, cell, x, y, w, h, anchor_mid=True, inner_pad=1, fscale=0.9)
            x += w; ci += span
        y += row["h"]

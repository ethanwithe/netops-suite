"""
diagram_fit.py
Ajusta los textos con color de fondo («resaltados») para que la letra no se vea cortada en el borde:
 - el alto alcanza para todas las líneas (antes la letra sobresalía del color),
 - el ancho alcanza para la línea más larga cuando no se parte (nowrap) y siempre queda aire a los lados.
Solo agranda (nunca achica) y es idempotente: aplicarlo dos veces no cambia nada la segunda vez.
Lo usan los exportadores de PPTX y PDF; el editor aplica la misma regla al mostrar el diagrama.
"""
import re

from reportlab.pdfbase.pdfmetrics import stringWidth

PT = 4 / 3       # px por punto de fuente en PowerPoint (96 px por pulgada / 72 pt): se mide con la letra real más grande
PAD_X = 8.0      # aire a los lados del texto dentro del color
PAD_Y = 4.0      # aire arriba y abajo
_MARK = re.compile(r"\*\*|~~")


def _font(bold, italic):
    return "Helvetica" + ("-BoldOblique" if bold and italic else "-Bold" if bold else "-Oblique" if italic else "")


def fit_filled_text(el: dict) -> dict:
    """Devuelve el elemento (copia) corregido:
     - interlineado fijo menor que la letra (p. ej. 14,6 px con letra de 24 px): PowerPoint recorta la parte de arriba de cada
       línea; se sube a un valor que la letra sí cabe;
     - si además tiene color de fondo, la caja se agranda lo necesario."""
    if el.get("type") != "text" or not str(el.get("text", "")).strip():
        return el
    e = dict(el)
    size = float(e.get("size", 12) or 12)
    fpx = size * PT
    if e.get("lineH") and float(e["lineH"]) < fpx * 1.0:
        e["lineH"] = round(fpx * 1.15, 2)
    if not e.get("fill"):
        return e
    lines = str(e["text"]).split("\n")
    lead = float(e["lineH"]) if e.get("lineH") else fpx * 1.2
    spc = float(e.get("spcBef") or 0)
    need_h = len(lines) * lead + spc * max(0, len(lines) - 1) + 2 * PAD_Y
    x, y, w, h = float(e["x"]), float(e["y"]), float(e["w"]), float(e.get("h", 20))
    if e.get("nowrap") or len(lines) == 1:
        font = _font(e.get("bold"), e.get("italic"))
        widest = max(stringWidth(_MARK.sub("", ln), font, fpx) for ln in lines)
        need_w = widest + 2 * PAD_X + 2
        if not e.get("nowrap"):
            need_w = min(need_w, w)  # un texto que se parte solo no se ensancha
        if need_w > w:
            al = e.get("align", "l")
            if al == "c":
                x -= (need_w - w) / 2
            elif al == "r":
                x -= need_w - w
            w = need_w
    if need_h > h:
        y -= (need_h - h) / 2
        h = need_h
    e["x"], e["y"], e["w"], e["h"] = round(x, 2), round(y, 2), round(w, 2), round(h, 2)
    return e


def fit_doc(doc: dict) -> dict:
    d = dict(doc)
    d["elements"] = [fit_filled_text(el) for el in doc.get("elements", [])]
    return d

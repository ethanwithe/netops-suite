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

PT = 1.2698      # px por punto de fuente: el mismo que usa el editor, el PDF y (con FONT_K) el PPTX
PAD_X = 8.0      # aire a los lados del texto dentro del color
PAD_Y = 4.0      # aire arriba y abajo
_MARK = re.compile(r"\*\*|~~")


_SERIF = ("times", "georgia", "garamond", "cambria", "palatino", "serif")
_MONO = ("courier", "consolas", "mono", "lucida console")


def _font(bold, italic, fam=""):
    """Letra del PDF (las 14 estándar): tipos con serif -> Times, de ancho fijo -> Courier, el resto -> Helvetica."""
    f = (fam or "").lower()
    if any(k in f for k in _SERIF):
        return "Times-" + ("BoldItalic" if bold and italic else "Bold" if bold else "Italic" if italic else "Roman")
    if any(k in f for k in _MONO):
        return "Courier" + ("-BoldOblique" if bold and italic else "-Bold" if bold else "-Oblique" if italic else "")
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
    if "\n" not in str(e["text"]):
        e.pop("lineH", None)   # una sola línea sobre color: interlineado normal (el fijo la sube y se sale de la caja en PowerPoint)
    lines = str(e["text"]).split("\n")
    lead = float(e["lineH"]) if e.get("lineH") else fpx * 1.2
    spc = float(e.get("spcBef") or 0)
    need_h = len(lines) * lead + spc * max(0, len(lines) - 1) + 2 * PAD_Y
    x, y, w, h = float(e["x"]), float(e["y"]), float(e["w"]), float(e.get("h", 20))
    if e.get("nowrap") or len(lines) == 1:
        font = _font(e.get("bold"), e.get("italic"), e.get("font"))
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


def expand_images(els: list) -> list:
    """Un icono con fondo, borde o margen se dibuja como una forma detrás + el icono más pequeño encima."""
    out = []
    for el in els:
        if el.get("type") != "image":
            out.append(el)
            continue
        pad = float(el.get("pad") or 0)
        has_box = bool(el.get("fill")) or (bool(el.get("stroke")) and float(el.get("strokeW") or 0) > 0)
        if has_box:
            out.append({"type": "rect", "id": el.get("id", ""), "x": el["x"], "y": el["y"], "w": el["w"], "h": el["h"], "rot": el.get("rot"),
                        "fill": el.get("fill"), "stroke": el.get("stroke"), "strokeW": float(el.get("strokeW") or 0),
                        "shape": "round" if el.get("radius") else "rect", "radius": float(el.get("radius") or 0)})
        if pad:
            el = dict(el)
            el["x"] = float(el["x"]) + pad; el["y"] = float(el["y"]) + pad
            el["w"] = max(1.0, float(el["w"]) - 2 * pad); el["h"] = max(1.0, float(el["h"]) - 2 * pad)
        out.append(el)
    return out


def process_icon(data, el: dict):
    """Aplica al icono su color único (tint) y los giros (flipX / flipY)."""
    if not data or not (el.get("tint") or el.get("flipX") or el.get("flipY")):
        return data
    try:
        import io
        from PIL import Image, ImageOps
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGBA")
        t = str(el.get("tint") or "")
        if re.match(r"^#[0-9a-fA-F]{6}$", t):
            solid = Image.new("RGBA", im.size, tuple(int(t[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
            solid.putalpha(im.getchannel("A"))
            im = solid
        if el.get("flipX"):
            im = ImageOps.mirror(im)
        if el.get("flipY"):
            im = ImageOps.flip(im)
        out = io.BytesIO()
        im.save(out, "PNG")
        return out.getvalue()
    except Exception:
        return data


def fit_doc(doc: dict) -> dict:
    d = dict(doc)
    d["elements"] = expand_images([fit_filled_text(el) for el in doc.get("elements", [])])
    return d

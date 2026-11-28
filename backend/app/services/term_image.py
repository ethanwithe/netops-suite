"""Salida de comandos como IMAGEN (tipo terminal, con los colores de MobaXterm): en el PDF/Word generado no se puede editar.

Solo las salidas de configuración (show running-config / display current-configuration…) quedan como texto; el resto
de las salidas se entregan como imagen. Antes de generar, todo sigue siendo editable en pantalla.
"""
import io
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from app.services.term_colors import line_segments

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
BG = (12, 12, 12)
FG = (212, 212, 212)
PX = 26                      # tamaño de letra en píxeles (nítido al reducirlo en la hoja)
PAD = 14
LEAD = 1.96                  # alto de línea / ancho de letra (igual que el texto del PDF: 8,0 pt / (6,8 pt × 0,6))

_fonts: dict = {}
_png_cache: dict = {}


def _font(bold: bool = False):
    if bold not in _fonts:
        name = "LiberationMono-Bold.ttf" if bold else "LiberationMono-Regular.ttf"
        try:
            _fonts[bold] = ImageFont.truetype(str(FONT_DIR / name), PX)
        except Exception:  # noqa: BLE001
            _fonts[bold] = ImageFont.load_default()
    return _fonts[bold]


def char_width() -> float:
    f = _font()
    try:
        return float(f.getlength("M"))
    except Exception:  # noqa: BLE001
        return PX * 0.6


def render_lines(lines: List[str], first_is_prompt: bool = True, min_cols: int = 40) -> Tuple[bytes, int, int]:
    """PNG de las líneas dadas sobre fondo negro. -> (bytes, ancho px, alto px)."""
    key = (tuple(lines), bool(first_is_prompt), min_cols)
    if key in _png_cache:                         # PDF y Word del mismo CheckList: se dibuja una sola vez
        return _png_cache[key]
    cw = char_width()
    lh = round(cw * LEAD)
    cols = max(min_cols, max((len(l) for l in lines), default=1))
    w = int(cols * cw + PAD * 2)
    h = int(len(lines) * lh + PAD * 2)
    im = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(im)
    f = _font()
    for i, ln in enumerate(lines):
        x, y = PAD, PAD + i * lh
        for txt, rgb in line_segments(ln, True, first_is_prompt and i == 0):
            d.text((x, y), txt, font=f, fill=tuple(rgb) if rgb else FG)
            try:
                x += f.getlength(txt)
            except Exception:  # noqa: BLE001
                x += len(txt) * cw
    out = io.BytesIO()
    im.save(out, "PNG", compress_level=3)        # mismo resultado sin pérdida, mucho más rápido que optimize=True
    data = out.getvalue()
    _png_cache[key] = (data, w, h)
    if len(_png_cache) > 64:
        _png_cache.pop(next(iter(_png_cache)))
    return data, w, h


def dims(n_lines: int, cols: int) -> Tuple[int, int]:
    """Tamaño en píxeles que tendrá la imagen de n líneas con ese ancho mínimo (sin dibujarla)."""
    cw = char_width()
    return int(cols * cw + PAD * 2), int(n_lines * round(cw * LEAD) + PAD * 2)


def line_px() -> int:
    return round(char_width() * LEAD)

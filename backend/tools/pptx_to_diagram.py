"""
pptx_to_diagram.py
Convierte un PPTX de diagrama (una diapositiva) al JSON del editor de diagramas y extrae sus iconos.
Uso: python pptx_to_diagram.py diagrama.pptx salida_dir [prefijo_iconos]
Genera salida_dir/doc.json y salida_dir/icons/<slug>.<ext>
"""
import json, math, os, re, sys, zipfile
from xml.etree import ElementTree as ET

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main", "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
A = "{%s}" % NS["a"]; P = "{%s}" % NS["p"]; R = "{%s}" % NS["r"]
SCALE = 1920 / 19199225  # EMU -> px (lienzo de 1920 px de ancho)
PT = 1.2698             # 1 pt en px de este lienzo
THEME = {}


def px(v): return round(float(v) * SCALE, 2)


def color(el):
    """Devuelve '#RRGGBB' o None desde un nodo con srgbClr/schemeClr."""
    if el is None: return None
    c = el.find("a:srgbClr", NS)
    if c is not None: return "#" + c.get("val").upper()
    c = el.find("a:sysClr", NS)
    if c is not None:
        return "#" + (c.get("lastClr") or {"windowText": "000000", "window": "FFFFFF"}.get(c.get("val"), "000000")).upper()
    c = el.find("a:schemeClr", NS)
    if c is not None:
        base = THEME.get(c.get("val"), "#000000")
        lm, lo = c.find("a:lumMod", NS), c.find("a:lumOff", NS)
        if lm is not None or lo is not None:
            r, g, b = [int(base[i:i + 2], 16) for i in (1, 3, 5)]
            f = int(lm.get("val")) / 100000 if lm is not None else 1
            o = int(lo.get("val")) / 100000 if lo is not None else 0
            r, g, b = [max(0, min(255, round(x * f + 255 * o))) for x in (r, g, b)]
            return "#%02X%02X%02X" % (r, g, b)
        return base
    return None


def fill_of(sppr):
    if sppr is None: return None
    if sppr.find("a:noFill", NS) is not None: return None
    sf = sppr.find("a:solidFill", NS)
    return color(sf) if sf is not None else None


def ln_of(sppr, style):
    """(color, width_px, dash, head, tail) de la línea de una forma."""
    col, w, dash, head, tail = None, 0.0, "", "none", "none"
    ln = sppr.find("a:ln", NS) if sppr is not None else None
    if ln is not None:
        if ln.find("a:noFill", NS) is not None:
            return None, 0, "", "none", "none"
        sf = ln.find("a:solidFill", NS)
        if sf is not None: col = color(sf)
        if ln.get("w"): w = int(ln.get("w")) * SCALE
        d = ln.find("a:prstDash", NS)
        if d is not None and d.get("val") not in (None, "solid"): dash = d.get("val")
        he, te = ln.find("a:headEnd", NS), ln.find("a:tailEnd", NS)
        if he is not None: head = he.get("type", "none")
        if te is not None: tail = te.get("type", "none")
    if col is None and style is not None:
        ref = style.find("a:lnRef", NS)
        if ref is not None and ref.get("idx") not in (None, "0"):
            col = color(ref) or "#4F81BD"
            if not w: w = {"1": 9525, "2": 25400, "3": 38100}.get(ref.get("idx"), 12700) * SCALE
    return col, round(w, 2) or 1.0, dash, head, tail


def xfrm(sppr_or_grp):
    x = sppr_or_grp.find("a:xfrm", NS)
    if x is None: return 0, 0, 0, 0, 0, False, False
    o, e = x.find("a:off", NS), x.find("a:ext", NS)
    return (int(o.get("x")), int(o.get("y")), int(e.get("cx")), int(e.get("cy")), int(x.get("rot", 0)) / 60000,
            x.get("flipH") == "1", x.get("flipV") == "1")


def text_of(txbody, defaults=None):
    """Texto plano por párrafos + estilo del primer tramo."""
    if txbody is None: return None
    paras, style = [], {}
    align = "l"
    lnh = None
    spc = 0
    for p in txbody.findall("a:p", NS):
        pp = p.find("a:pPr", NS)
        if pp is not None:
            if pp.get("algn"): align = {"ctr": "c", "r": "r", "l": "l", "just": "l"}.get(pp.get("algn"), "l")
            sb = pp.find("a:spcBef/a:spcPts", NS)
            if sb is not None and not spc: spc = int(sb.get("val")) / 100 * PT
            ls = pp.find("a:lnSpc/a:spcPts", NS)
            if ls is not None and lnh is None: lnh = int(ls.get("val")) / 100 * PT
        runs = p.findall("a:r", NS)
        t = "".join((r.findtext("a:t", "", NS)) for r in runs)
        # salto de línea vertical dentro del párrafo
        if p.findall("a:br", NS):
            parts = []
            for ch in p:
                if ch.tag == A + "r": parts.append(ch.findtext("a:t", "", NS))
                elif ch.tag == A + "br": parts.append("\n")
            t = "".join(parts)
        paras.append(t)
        if not style and runs:
            rp = runs[0].find("a:rPr", NS)
            if rp is not None:
                style = {"size": round(int(rp.get("sz", 1800)) / 100, 1), "bold": rp.get("b") == "1", "italic": rp.get("i") == "1",
                         "color": color(rp.find("a:solidFill", NS)) or "#000000"}
                lat = rp.find("a:latin", NS)
                if lat is not None and "bold" in lat.get("typeface", "").lower(): style["bold"] = True
                hl = rp.find("a:highlight", NS)
                if hl is not None: style["bg"] = color(hl)
    if not style:
        ep = txbody.find("a:p/a:endParaRPr", NS)
        style = {"size": round(int(ep.get("sz", 1800)) / 100, 1) if ep is not None else 18, "bold": False, "italic": False, "color": "#000000"}
    # ¿alguno de los tramos tiene fondo de resaltado? (se usa como relleno del cuadro)
    return {"text": "\n".join(paras).rstrip("\n"), "align": align, "lineH": round(lnh, 2) if lnh else None, "spcBef": round(spc, 2), **style}


def main(pptx, out, prefix="icono"):
    global THEME
    z = zipfile.ZipFile(pptx)
    th = ET.fromstring(z.read("ppt/theme/theme1.xml"))
    for k in ("dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink"):
        n = th.find(".//a:clrScheme/a:%s" % k, NS)
        c = n.find("a:srgbClr", NS) if n is not None else None
        if c is None and n is not None: c = n.find("a:sysClr", NS)
        THEME[k] = "#" + (c.get("lastClr") or c.get("val")).upper()
    THEME.update({"tx1": THEME["dk1"], "bg1": THEME["lt1"], "tx2": THEME["dk2"], "bg2": THEME["lt2"]})
    rels = ET.fromstring(z.read("ppt/slides/_rels/slide1.xml.rels"))
    rid2file = {r.get("Id"): r.get("Target").replace("../", "ppt/") for r in rels if r.get("Target", "").startswith("../media")}
    slide = ET.fromstring(z.read("ppt/slides/slide1.xml"))
    os.makedirs(os.path.join(out, "icons"), exist_ok=True)
    icons, els, n = {}, [], [0]

    def icon_for(rid, crop=None):
        f = rid2file[rid]
        key = (f, tuple(crop) if crop else None)
        if key in icons: return icons[key]
        ext = os.path.splitext(f)[1].lower()
        n[0] += 1
        slug = "%s-%d" % (prefix, n[0])
        data = z.read(f)
        if crop:  # recorte: se guarda ya recortado para que sea igual en cualquier lado
            from io import BytesIO
            from PIL import Image
            im = Image.open(BytesIO(data)).convert("RGBA")
            w, h = im.size
            l, t, r, b = [c / 100000 for c in crop]
            im = im.crop((round(w * l), round(h * t), round(w * (1 - r)), round(h * (1 - b))))
            buf = BytesIO(); im.save(buf, "PNG"); data, ext = buf.getvalue(), ".png"
        open(os.path.join(out, "icons", slug + ext), "wb").write(data)
        icons[key] = slug
        return slug

    def add(el): el["id"] = "e%d" % (len(els) + 1); els.append(el)

    def shape(sp, gx=None):
        name = sp.find(".//p:cNvPr", NS).get("name")
        sppr = sp.find("p:spPr", NS)
        style = sp.find("p:style", NS)
        x, y, w, h, rot, fh, fv = xfrm(sppr)
        if gx:  # forma dentro de un grupo: se usa el marco del grupo
            x, y, w, h = gx
        blip = sppr.find("a:blipFill/a:blip", NS)
        if blip is not None:
            return add({"type": "image", "name": name, "x": px(x), "y": px(y), "w": px(w), "h": px(h), "rot": rot, "icon": icon_for(blip.get(R + "embed"))})
        f = fill_of(sppr)
        col, lw, dash, _, _ = ln_of(sppr, style)
        tx = text_of(sp.find("p:txBody", NS))
        is_txt = sp.find("p:nvSpPr/p:cNvSpPr", NS).get("txBox") == "1"
        has_text = tx and tx["text"].strip()
        if is_txt or (has_text and f is None and col is None):
            bp = sp.find("p:txBody/a:bodyPr", NS)
            nowrap = bp is not None and bp.get("wrap") == "none"
            d = {"type": "text", "name": name, "nowrap": nowrap, "x": px(x), "y": px(y), "w": px(w), "h": px(h), "rot": rot, "fill": f or (tx.get("bg") if tx else None)}
            d.update({k: tx[k] for k in ("text", "align", "lineH", "spcBef", "size", "bold", "italic", "color")})
            return add(d)
        d = {"type": "rect", "name": name, "x": px(x), "y": px(y), "w": px(w), "h": px(h), "rot": rot, "fill": f, "stroke": col if (lw and col) else None, "strokeW": round(lw, 2), "dash": dash}
        if has_text: d.update({k: tx[k] for k in ("text", "align", "size", "bold", "italic", "color")})
        add(d)

    def walk(parent):
        for ch in parent:
            tag = ch.tag
            if tag == P + "sp": shape(ch)
            elif tag == P + "pic":
                sppr = ch.find("p:spPr", NS)
                x, y, w, h, rot, fh, fv = xfrm(sppr)
                bl = ch.find("p:blipFill/a:blip", NS)
                sr = ch.find("p:blipFill/a:srcRect", NS)
                crop = [int(sr.get(k, 0)) for k in ("l", "t", "r", "b")] if sr is not None else None
                add({"type": "image", "name": ch.find(".//p:cNvPr", NS).get("name"), "x": px(x), "y": px(y), "w": px(w), "h": px(h), "rot": rot, "icon": icon_for(bl.get(R + "embed"), crop)})
            elif tag == P + "grpSp":
                gx, gy, gw, gh, grot, _, _ = xfrm(ch.find("p:grpSpPr", NS))
                for sp in ch.findall("p:sp", NS): shape(sp, (gx, gy, gw, gh))
            elif tag == P + "cxnSp":
                sppr = ch.find("p:spPr", NS)
                x, y, w, h, rot, fh, fv = xfrm(sppr)
                col, lw, dash, head, tail = ln_of(sppr, ch.find("p:style", NS))
                x1, y1, x2, y2 = x, y, x + w, y + h
                if fh: x1, x2 = x2, x1
                if fv: y1, y2 = y2, y1
                if rot:
                    cx, cy, a = x + w / 2, y + h / 2, math.radians(rot)
                    def rp(px_, py_): return (cx + (px_ - cx) * math.cos(a) - (py_ - cy) * math.sin(a), cy + (px_ - cx) * math.sin(a) + (py_ - cy) * math.cos(a))
                    (x1, y1), (x2, y2) = rp(x1, y1), rp(x2, y2)
                add({"type": "line", "name": ch.find(".//p:cNvPr", NS).get("name"), "x1": px(x1), "y1": px(y1), "x2": px(x2), "y2": px(y2),
                     "stroke": col or "#000000", "strokeW": lw, "dash": dash, "head": head, "tail": tail})
            elif tag == P + "graphicFrame":
                x, y, w, h, _, _, _ = xfrm_frame(ch)
                tbl = ch.find(".//a:tbl", NS)
                if tbl is None: continue
                cols = [px(g.get("w")) for g in tbl.findall("a:tblGrid/a:gridCol", NS)]
                rows = []
                for tr in tbl.findall("a:tr", NS):
                    row = []
                    for tc in tr.findall("a:tc", NS):
                        tx = text_of(tc.find("a:txBody", NS)) or {"text": "", "align": "l", "size": 12, "bold": False, "italic": False, "color": "#000000"}
                        tcpr = tc.find("a:tcPr", NS)
                        grad = None
                        gf = tcpr.find("a:gradFill", NS) if tcpr is not None else None
                        if gf is not None:
                            lin = gf.find("a:lin", NS)
                            grad = {"colors": [color(g) for g in gf.findall("a:gsLst/a:gs", NS)], "ang": int(lin.get("ang", 0)) / 60000 if lin is not None else 90}
                        cell = {"grad": grad, "text": tx["text"], "align": tx["align"], "size": tx["size"], "bold": tx["bold"], "italic": tx["italic"], "color": tx["color"],
                                "fill": fill_of(tcpr), "span": int(tc.get("gridSpan", 1)), "merged": tc.get("hMerge") == "1"}
                        row.append(cell)
                    rows.append({"h": px(tr.get("h")), "cells": row})
                add({"type": "table", "name": ch.find(".//p:cNvPr", NS).get("name"), "x": px(x), "y": px(y), "w": px(w), "h": px(h), "cols": cols, "rows": rows})

    def xfrm_frame(gf):
        xf = gf.find("p:xfrm", NS)
        o, e = xf.find("a:off", NS), xf.find("a:ext", NS)
        return int(o.get("x")), int(o.get("y")), int(e.get("cx")), int(e.get("cy")), 0, False, False

    tree = slide.find("p:cSld/p:spTree", NS)
    walk(tree)
    json.dump({"w": 1920, "h": 1080, "elements": els}, open(os.path.join(out, "doc.json"), "w"), ensure_ascii=False, indent=1)
    print(len(els), "elementos,", len(icons), "iconos")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "icono")

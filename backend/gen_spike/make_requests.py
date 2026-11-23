"""Pedidos de ejemplo (el mismo JSON que envían las pantallas) y su resultado esperado generado con Python normal."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import cases  # noqa: E402


def main(root, work):
    sys.path.insert(0, root)
    from app.services import gen_local
    up = os.path.join(work, "uploads_in")
    os.makedirs(up, exist_ok=True)
    names = []
    for i, c in enumerate([(200, 60, 60), (60, 160, 90), (50, 90, 200)], 1):
        n = f"0000000{i}-aaaa-bbbb-cccc-00000000000{i}.jpg"
        cases.photo(os.path.join(up, n), c)
        names.append(n)
    icon = cases.icon_png()
    os.makedirs(os.path.join(work, "icons_in"), exist_ok=True)
    open(os.path.join(work, "icons_in", "demo"), "wb").write(icon)
    ck = {"titulo": "CheckList de Claro", "servicio_label": "Internet", "sot": "5002", "cid": "C2", "cliente": "Cliente Y", "fecha": "21/11/2026", "equipo": "RTR1",
          "sections": [{"titulo": "1. Datos", "items": [{"nombre": "Versión", "modo": "texto", "texto": "IOS 17", "cmd": "show version", "images": []}, {"nombre": "Foto", "modo": "foto", "texto": "", "cmd": "", "images": names[:2]}]}]}
    ev = {"sot": "5003", "cliente": "Cliente Z", "items": [{"nombre": "Rack", "path": names[0], "original_path": names[1], "lado_label": "SITE"}, {"nombre": "ONT", "path": names[2], "original_path": "", "lado_label": "CLIENTE"}]}
    dg = {"filename": "mi diagrama", "doc": {"w": 1920, "h": 1080, "elements": [
        {"type": "text", "x": 100, "y": 100, "w": 700, "h": 90, "text": "Diagrama de prueba", "size": 28, "bold": True, "color": "#0E2B5E"},
        {"type": "rect", "x": 100, "y": 300, "w": 300, "h": 150, "shape": "round", "fill": "#1E78DC", "text": "Router", "size": 22, "color": "#FFFFFF"},
        {"type": "image", "x": 600, "y": 300, "w": 150, "h": 150, "icon": "demo"},
        {"type": "line", "x1": 400, "y1": 375, "x2": 600, "y2": 375, "stroke": "#333333", "strokeW": 4, "tail": "triangle", "head": "none"}]}}
    reqs = [{"kind": "checklist_pdf", "req": ck}, {"kind": "checklist_docx", "req": ck}, {"kind": "evidence_zip", "req": ev},
            {"kind": "diagram_pdf", "req": dg}, {"kind": "diagram_pptx", "req": dg}]
    json.dump(reqs, open(os.path.join(work, "requests.json"), "w"))
    # esperado, con Python normal
    w = gen_local.Work(os.path.join(work, "exp_work"), icons={"demo": icon})
    import shutil
    for n in names:
        shutil.copy(os.path.join(up, n), os.path.join(w.uploads, n))
    exp = os.path.join(work, "expected")
    os.makedirs(exp, exist_ok=True)
    for r in (gen_local.checklist_pdf(ck, w), gen_local.checklist_docx(ck, w), gen_local.evidence_zip(ev, w)):
        shutil.copy(r["path"], os.path.join(exp, r["filename"]))
    open(os.path.join(exp, "diagrama.pdf"), "wb").write(gen_local.diagram_pdf(dg, w))
    open(os.path.join(exp, "diagrama.pptx"), "wb").write(gen_local.diagram_pptx(dg, w))
    print("OK", sorted(os.listdir(exp)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

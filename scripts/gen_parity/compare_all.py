"""Compara los archivos generados en dos entornos.
PDF  -> páginas renderizadas, cero píxeles de diferencia.
PPTX/DOCX -> cada parte interna del ZIP debe ser idéntica (se ignoran solo las marcas de fecha de docProps)."""
import glob, os, subprocess, sys, zipfile
from PIL import Image, ImageChops

a, b = sys.argv[1], sys.argv[2]
bad = []
for f in sorted(os.listdir(a)):
    pa, pb = os.path.join(a, f), os.path.join(b, f)
    if not os.path.isfile(pa) or f.startswith("."):
        continue
    if not os.path.exists(pb):
        bad.append(f"{f}: falta en el segundo entorno"); continue
    if f.endswith(".pdf"):
        for g in glob.glob("/tmp/cmp_*.png"):
            os.remove(g)
        for src, tag in ((pa, "a"), (pb, "b")):
            subprocess.run(["pdftoppm", "-r", "110", "-png", src, f"/tmp/cmp_{tag}"], check=True)
        fa, fb = sorted(glob.glob("/tmp/cmp_a-*.png")), sorted(glob.glob("/tmp/cmp_b-*.png"))
        if len(fa) != len(fb):
            bad.append(f"{f}: {len(fa)} vs {len(fb)} páginas"); continue
        diff = 0
        for x, y in zip(fa, fb):
            d = ImageChops.difference(Image.open(x).convert("RGB"), Image.open(y).convert("RGB"))
            if d.getbbox():
                diff += 1
        print(f"{f}: {len(fa)} páginas, {'IDÉNTICO' if not diff else f'{diff} páginas distintas'}")
        if diff:
            bad.append(f)
    elif f.endswith(".zip"):
        same = open(pa, "rb").read() == open(pb, "rb").read()
        print(f"{f}: ZIP {'IDÉNTICO byte a byte' if same else 'DISTINTO'}")
        if not same:
            bad.append(f)
    elif f.endswith((".pptx", ".docx")):
        za, zb = zipfile.ZipFile(pa), zipfile.ZipFile(pb)
        na, nb = sorted(za.namelist()), sorted(zb.namelist())
        if na != nb:
            bad.append(f"{f}: partes distintas {set(na) ^ set(nb)}"); continue
        dif = [n for n in na if not n.startswith("docProps/") and za.read(n) != zb.read(n)]
        print(f"{f}: {len(na)} partes, {'IDÉNTICO' if not dif else 'distintas: ' + ', '.join(dif)}")
        if dif:
            bad.append(f"{f}: {dif}")
sys.exit(1 if bad else 0)

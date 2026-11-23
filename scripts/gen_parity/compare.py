"""Compara dos PDF página por página (renderizadas).
  exacto : cualquier diferencia de un solo píxel es error (prueba que diseño, textos, fuentes y vectores son idénticos).
  tolerancia: informa cuánto cambian las fotos por el códec JPEG de cada entorno y falla solo si pasa de un umbral."""
import subprocess, sys, glob, os
from PIL import Image, ImageChops, ImageStat

a, b, mode = sys.argv[1], sys.argv[2], sys.argv[3]
for f in glob.glob("/tmp/cmp_*.png"):
    os.remove(f)
for pdf, tag in ((a, "a"), (b, "b")):
    subprocess.run(["pdftoppm", "-r", "110", "-png", pdf, f"/tmp/cmp_{tag}"], check=True)
fa, fb = sorted(glob.glob("/tmp/cmp_a-*.png")), sorted(glob.glob("/tmp/cmp_b-*.png"))
print("páginas:", len(fa), len(fb))
assert len(fa) == len(fb) and fa, "distinto número de páginas"
bad = False
for x, y in zip(fa, fb):
    d = ImageChops.difference(Image.open(x).convert("RGB"), Image.open(y).convert("RGB")).convert("L")
    h = d.histogram()
    total = sum(h)
    differing = total - h[0]
    mean = ImageStat.Stat(d).mean[0]
    print(f"{os.path.basename(x)}: píxeles distintos {differing} ({100*differing/total:.3f}%), media {mean:.4f}, máx {d.getextrema()[1]}")
    if mode == "exacto" and differing:
        bad = True
    if mode == "tolerancia" and (100 * differing / total > 5 or mean > 1.0):
        bad = True
sys.exit(1 if bad else 0)

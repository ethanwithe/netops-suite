"""Compara página por página (renderizadas) dos PDF; sale con error si hay una sola diferencia de píxeles."""
import subprocess, sys, glob, os
from PIL import Image, ImageChops

a, b = sys.argv[1], sys.argv[2]
for pdf, tag in ((a, "a"), (b, "b")):
    subprocess.run(["pdftoppm", "-r", "110", "-png", pdf, f"/tmp/cmp_{tag}"], check=True)
fa, fb = sorted(glob.glob("/tmp/cmp_a-*.png")), sorted(glob.glob("/tmp/cmp_b-*.png"))
print("páginas:", len(fa), len(fb))
assert len(fa) == len(fb) and fa, "distinto número de páginas"
worst = 0
for x, y in zip(fa, fb):
    d = ImageChops.difference(Image.open(x).convert("RGB"), Image.open(y).convert("RGB"))
    box = d.getbbox()
    m = max(max(px) for px in d.getdata()) if box else 0
    print(os.path.basename(x), "idéntica" if not box else f"diferencia máx {m} en {box}")
    worst = max(worst, m)
sys.exit(1 if worst else 0)

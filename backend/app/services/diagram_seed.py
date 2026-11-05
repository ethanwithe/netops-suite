"""Iconos que vienen con el sistema (los del diagrama de ejemplo). Se cargan una vez en la base de datos."""
from pathlib import Path

from sqlalchemy.orm import Session

from app import models

DIR = Path(__file__).resolve().parent.parent / "assets" / "diagram_icons"
NAMES = {
    "roseta": ("Roseta óptica", "Cliente"),
    "switch-cliente": ("Switch cliente", "Cliente"),
    "nube-pop": ("Nube POP", "Proveedor"),
    "caja-fat": ("Caja FAT (punto de acceso terminal)", "Proveedor"),
    "olt": ("OLT", "Proveedor"),
    "caja-distribucion": ("Caja de distribución / splitter óptico", "Proveedor"),
    "router-cisco-c1121x": ("Router Cisco C1121X-4P", "Cliente"),
    "router-ont-huawei": ("Router ONT Huawei", "Cliente"),
    "logo-claro": ("Logo Claro", "Logos"),
}
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


def seed_diagram_icons(db: Session) -> None:
    if not DIR.is_dir():
        return
    for f in sorted(DIR.iterdir()):
        slug = f.stem
        if f.suffix.lower() not in MIME or db.get(models.DiagramIcon, slug):
            continue
        name, cat = NAMES.get(slug, (slug.replace("-", " ").title(), "Equipos"))
        db.add(models.DiagramIcon(id=slug, name=name, categoria=cat, content_type=MIME[f.suffix.lower()],
                                  data=f.read_bytes(), builtin=True))
    db.commit()

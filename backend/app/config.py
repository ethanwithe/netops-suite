"""
config.py
Configuración centralizada, leída de variables de entorno (con defaults
razonables para desarrollo local).
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://netops:netops@localhost:5432/netops",
)

# ---------------------------------------------------------------
# Dónde viven las fotos subidas y los PDF generados:
#   disk (por defecto, Railway/Docker): carpetas del servidor.
#   db   (por defecto en Vercel, que no permite guardar archivos): se
#        guardan en la base de datos y /tmp solo sirve de copia temporal.
# Se puede forzar con STORAGE_BACKEND=db|disk.
# ---------------------------------------------------------------
IS_VERCEL = bool(os.getenv("VERCEL"))
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "db" if IS_VERCEL else "disk").strip().lower()
_STORAGE_ROOT = Path("/tmp/netops") if STORAGE_BACKEND == "db" else BASE_DIR / "storage"

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", _STORAGE_ROOT / "uploads"))
OUTPUTS_DIR = Path(os.getenv("OUTPUTS_DIR", _STORAGE_ROOT / "outputs"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# Orígenes permitidos para CORS (en dev, el frontend corre en otro puerto)
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

# Para el frontend publicado en otro dominio (p. ej. *.vercel.app), una
# expresión regular: CORS_ORIGIN_REGEX=https://.*\\.vercel\\.app
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX") or None

# Caché opcional (Redis). Sin REDIS_URL todo funciona igual, solo sin caché.
REDIS_URL = os.getenv("REDIS_URL", "").strip()

# Días que se conservan archivos y PDF guardados en la base de datos.
FILE_RETENTION_DAYS = int(os.getenv("FILE_RETENTION_DAYS", "30"))

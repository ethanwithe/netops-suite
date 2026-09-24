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

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", BASE_DIR / "storage" / "uploads"))
OUTPUTS_DIR = Path(os.getenv("OUTPUTS_DIR", BASE_DIR / "storage" / "outputs"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# Orígenes permitidos para CORS (en dev, el frontend corre en otro puerto)
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

"""
Entrada para Vercel (funciones serverless de Python).
Vercel busca la variable `app` (ASGI). Railway/Docker NO usan este archivo:
ellos arrancan con uvicorn app.main:app.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402,F401

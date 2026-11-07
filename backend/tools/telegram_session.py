#!/usr/bin/env python3
"""
Genera TELEGRAM_SESSION (se corre UNA vez, en tu laptop).

    pip install telethon
    set TELEGRAM_API_ID=...        (Windows)   /   export TELEGRAM_API_ID=...   (Linux/Mac)
    set TELEGRAM_API_HASH=...
    python telegram_session.py

Te pide tu número, el código que te llega a Telegram y, si la tienes, la contraseña de dos pasos.
Al final imprime una línea larga: cópiala en Railway como variable TELEGRAM_SESSION.
Esa línea equivale a tu sesión de Telegram: no la pegues en chats ni la subas al repositorio.
"""
import os
import sys

from telethon.sessions import StringSession
from telethon.sync import TelegramClient

api_id, api_hash = os.getenv("TELEGRAM_API_ID", ""), os.getenv("TELEGRAM_API_HASH", "")
if not api_id.isdigit() or not api_hash:
    sys.exit("Define primero TELEGRAM_API_ID y TELEGRAM_API_HASH (ver arriba).")

with TelegramClient(StringSession(), int(api_id), api_hash) as c:
    print("\nTELEGRAM_SESSION=" + c.session.save() + "\n")

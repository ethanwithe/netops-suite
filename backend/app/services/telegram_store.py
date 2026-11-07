"""
Almacén de archivos en Telegram (cliente MTProto «disfrazado de REST»).

En vez de guardar el contenido en Postgres, cada archivo se sube a un chat de Telegram
(tus «Mensajes guardados» o un canal privado tuyo) usando tu propia cuenta con Telethon.
En la base de datos solo queda la referencia (chat + id de mensaje); el contenido se pide
a Telegram cuando hace falta y el backend lo sirve por sus URLs de siempre (/api/files/...).

Variables de entorno (en Railway, nunca en el repositorio):
  TELEGRAM_API_ID, TELEGRAM_API_HASH   -> de https://my.telegram.org  (API development tools)
  TELEGRAM_SESSION                     -> sesión de Telethon (se genera una vez con tools/telegram_session.py)
  TELEGRAM_CHAT                        -> opcional: @canal, id numérico o «me» (por defecto «me»)

Sin esas variables todo sigue guardándose en la base de datos como antes.
"""
import asyncio
import io
import logging
import os
import threading
from typing import Optional, Tuple

log = logging.getLogger("telegram_store")

API_ID = os.getenv("TELEGRAM_API_ID", "").strip()
API_HASH = os.getenv("TELEGRAM_API_HASH", "").strip()
SESSION = os.getenv("TELEGRAM_SESSION", "").strip()
CHAT = os.getenv("TELEGRAM_CHAT", "").strip() or "me"
TIMEOUT = 180

_lock = threading.Lock()
_loop: Optional[asyncio.AbstractEventLoop] = None
_client = None
_last_error = ""


def enabled() -> bool:
    return bool(API_ID.isdigit() and API_HASH and SESSION)


def last_error() -> str:
    return _last_error


def _peer():
    """«me», @usuario o id numérico (los canales llevan -100…)."""
    c = CHAT
    if c.lstrip("-").isdigit():
        return int(c)
    return c


def _ensure():
    """Arranca, una sola vez, un hilo con su propio event loop y el cliente conectado."""
    global _loop, _client
    if _client is not None:
        return
    with _lock:
        if _client is not None:
            return
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        loop = asyncio.new_event_loop()
        threading.Thread(target=loop.run_forever, daemon=True, name="telegram-loop").start()

        async def _start():
            cli = TelegramClient(StringSession(SESSION), int(API_ID), API_HASH, loop=loop,
                                 connection_retries=3, retry_delay=2)
            await cli.connect()
            if not await cli.is_user_authorized():
                raise RuntimeError("La sesión de Telegram no es válida: genera TELEGRAM_SESSION de nuevo.")
            return cli

        _client = asyncio.run_coroutine_threadsafe(_start(), loop).result(60)
        _loop = loop


def _run(coro):
    return asyncio.run_coroutine_threadsafe(coro, _loop).result(TIMEOUT)


def upload(name: str, data: bytes) -> Optional[Tuple[str, int]]:
    """Sube el archivo y devuelve (chat, id_mensaje); None si no se pudo (el llamador usa la base de datos)."""
    global _last_error
    if not enabled():
        return None
    try:
        _ensure()
        bio = io.BytesIO(data)
        bio.name = os.path.basename(name)

        async def _go():
            msg = await _client.send_file(_peer(), bio, force_document=True, caption=bio.name[:200],
                                          file_name=bio.name)
            return msg.id

        mid = _run(_go())
        _last_error = ""
        return CHAT, int(mid)
    except Exception as e:  # nunca tumbar la operación principal
        _last_error = f"{e.__class__.__name__}: {e}"
        log.warning("Telegram upload falló: %s", _last_error)
        return None


def download(chat: str, msg_id: int) -> Optional[bytes]:
    global _last_error
    if not enabled():
        return None
    try:
        _ensure()
        peer = int(chat) if chat.lstrip("-").isdigit() else chat

        async def _go():
            msg = await _client.get_messages(peer, ids=msg_id)
            if not msg or not msg.media:
                return None
            return await _client.download_media(msg, file=bytes)

        out = _run(_go())
        _last_error = "" if out else "El mensaje ya no existe en Telegram."
        return out
    except Exception as e:
        _last_error = f"{e.__class__.__name__}: {e}"
        log.warning("Telegram download falló: %s", _last_error)
        return None


def delete(chat: str, msg_id: int) -> None:
    if not enabled():
        return
    try:
        _ensure()
        peer = int(chat) if chat.lstrip("-").isdigit() else chat
        _run(_client.delete_messages(peer, [msg_id]))
    except Exception as e:
        log.warning("Telegram delete falló: %s", e)

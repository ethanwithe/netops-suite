"""
cache.py
Caché opcional en Redis para respuestas que se piden mucho y cambian poco
(listas de ítems y logos). Sin REDIS_URL, o si Redis no responde, todas las
funciones son no-ops y la aplicación trabaja directo con la base de datos.
"""

import json
import logging
from typing import Any, Optional

from app.config import REDIS_URL

logger = logging.getLogger(__name__)

_client = None
_failed = False
PREFIX = "netops:"


def _redis():
    global _client, _failed
    if _failed or not REDIS_URL:
        return None
    if _client is None:
        try:
            import redis

            _client = redis.Redis.from_url(
                REDIS_URL,
                socket_connect_timeout=1.5,
                socket_timeout=1.5,
                health_check_interval=30,
            )
        except Exception as exc:
            logger.warning("Redis no disponible (%s); se trabaja sin caché.", exc)
            _failed = True
            return None
    return _client


def _safe(fn, default=None):
    r = _redis()
    if r is None:
        return default
    try:
        return fn(r)
    except Exception as exc:  # Redis caído o lento: nunca debe romper la app
        logger.warning("Error de Redis ignorado: %s", exc)
        return default


def get_json(key: str) -> Optional[Any]:
    raw = _safe(lambda r: r.get(PREFIX + key))
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def set_json(key: str, value: Any, ttl: int = 300) -> None:
    _safe(lambda r: r.set(PREFIX + key, json.dumps(value), ex=ttl))


def get_bytes(key: str) -> Optional[bytes]:
    return _safe(lambda r: r.get(PREFIX + key))


def set_bytes(key: str, value: bytes, ttl: int = 3600) -> None:
    _safe(lambda r: r.set(PREFIX + key, value, ex=ttl))


def delete_prefix(prefix: str) -> None:
    def run(r):
        keys = list(r.scan_iter(match=f"{PREFIX}{prefix}*", count=200))
        if keys:
            r.delete(*keys)

    _safe(run)

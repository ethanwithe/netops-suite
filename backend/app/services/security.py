"""
security.py
Contraseñas (scrypt), sesiones firmadas (HMAC) y reglas de acceso (vigencia, horario, permisos).
Solo usa la biblioteca estándar: no hay dependencias nuevas.
"""

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import time

from app.config import DATABASE_URL

COOKIE_NAME = "netops_session"
SESSION_SECONDS = 14 * 24 * 3600

ROLES = ("superadmin", "admin", "user")

# Funciones que el administrador puede dar o quitar a cada usuario.
FEATURES: dict[str, str] = {
    "grafica": "Ventana gráfica",
    "plantillas": "Plantillas",
    "checklist": "CheckList",
    "fotografico": "Fotos (reporte fotográfico)",
    "poder_judicial": "Poder Judicial",
    "asistente": "Asistente Bit e IA",
    "exportar": "Exportar y descargar (Excel, Word, PPT, TXT, PDF)",
    "editar_catalogos": "Editar catálogos (plantillas, ítems, descripciones, ventanas)",
}


# ------------------------------ contraseñas ------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 2 ** 14, 8, 1
    dk = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except Exception:
        return False


# ------------------------------ sesiones ------------------------------

def _secret() -> bytes:
    env = os.getenv("AUTH_SECRET", "").strip()
    if env:
        return env.encode()
    # Sin AUTH_SECRET se deriva de la base de datos (estable entre despliegues, nunca va al repositorio).
    return hashlib.sha256(("netops-auth|" + DATABASE_URL).encode()).digest()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(user_id: str, token_version: int) -> str:
    body = _b64(json.dumps({"u": user_id, "v": token_version, "e": int(time.time()) + SESSION_SECONDS}).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str) -> tuple[str, int] | None:
    try:
        body, sig = token.split(".")
        good = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(_unb64(body))
        if data["e"] < time.time():
            return None
        return data["u"], int(data["v"])
    except Exception:
        return None


# ------------------------------ reglas de acceso ------------------------------

def app_now() -> dt.datetime:
    """Hora local de la app (por defecto Lima, UTC-5; se cambia con APP_TZ)."""
    tz_name = os.getenv("APP_TZ", "America/Lima")
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = dt.timezone(dt.timedelta(hours=-5))
    return dt.datetime.now(tz)


def is_admin(user) -> bool:
    return user.role in ("admin", "superadmin")


def has_feature(user, feature: str) -> bool:
    if is_admin(user):
        return True
    perms = user.permissions or {}
    return bool(perms.get(feature, True))


def effective_permissions(user) -> dict[str, bool]:
    return {f: has_feature(user, f) for f in FEATURES}


def access_problem(user, now: dt.datetime | None = None) -> str | None:
    """Motivo por el que NO puede entrar ahora (None = puede). Los administradores no tienen límites."""
    if not user.active:
        return "Tu usuario está desactivado. Habla con el administrador."
    if is_admin(user):
        return None
    now = now or app_now()
    today = now.date().isoformat()
    if user.valid_from and today < user.valid_from:
        return f"Tu acceso empieza el {user.valid_from}."
    if user.valid_until and today > user.valid_until:
        return f"Tu acceso venció el {user.valid_until}."
    hhmm = now.strftime("%H:%M")
    a, b = user.daily_start or "", user.daily_end or ""
    if a and b:
        inside = (a <= hhmm <= b) if a <= b else (hhmm >= a or hhmm <= b)  # admite horarios que cruzan la medianoche
        if not inside:
            return f"Solo puedes usar el sistema de {a} a {b}."
    elif a and hhmm < a:
        return f"Puedes usar el sistema desde las {a}."
    elif b and hhmm > b:
        return f"Puedes usar el sistema hasta las {b}."
    return None

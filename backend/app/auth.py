"""
auth.py
Quién es el usuario de cada petición y qué puede hacer. Lo usan el middleware de main.py
(que bloquea todo /api sin sesión) y los routers (Depends).
"""

import re
import time

from fastapi import Depends, HTTPException, Request, WebSocket, WebSocketException
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal, get_db
from app.services import security

PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/logout", "/api/tools/saturador.py"}

# prefijo de ruta -> función que hay que tener
FEATURE_BY_PREFIX = [
    ("/api/tests", "plantillas"),
    ("/api/serial", "plantillas"),
    ("/api/templates", "plantillas"),
    ("/api/checklist", "checklist"),
    ("/api/photos", "fotografico"),
    ("/api/mascot", "asistente"),
    ("/api/imageai", "asistente"),
    ("/api/export", "exportar"),
    ("/api/diagrams", "grafica"),
    ("/api/agenda", "asistente"),
]

# Rutas que modifican catálogos (no son "usar" la función): piden editar_catalogos.
CATALOG_MUTATIONS = [
    re.compile(r"^/api/templates/fragments"),
    re.compile(r"^/api/checklist/(items|templates)"),
    re.compile(r"^/api/photos/(windows|items)"),
    re.compile(r"^/api/services$"),
]


def token_from(request_like) -> str:
    tok = request_like.cookies.get(security.COOKIE_NAME, "")
    if not tok:
        h = request_like.headers.get("authorization", "")
        if h.lower().startswith("bearer "):
            tok = h[7:].strip()
    return tok


def user_from_token(db: Session, token: str):
    parsed = security.read_token(token) if token else None
    if not parsed:
        return None
    uid, ver = parsed
    user = db.get(models.User, uid)
    if not user or user.token_version != ver:
        return None
    return user


def required_feature(path: str, method: str) -> str | None:
    if method not in ("GET", "HEAD", "OPTIONS") and any(r.match(path) for r in CATALOG_MUTATIONS):
        return "editar_catalogos"
    for prefix, feat in FEATURE_BY_PREFIX:
        if path.startswith(prefix):
            return feat
    return None


# Caché de 5 s de quién es el dueño de una sesión: una página abre ~10 peticiones a la vez y cada una
# consultaba el usuario en la base. Las reglas por hora (vigencia, horario) se siguen evaluando en cada petición.
_AUTH_TTL = 5.0
_AUTH_CACHE: dict = {}


def clear_auth_cache() -> None:
    _AUTH_CACHE.clear()


def _cached_user(db, token: str):
    now = time.monotonic()
    hit = _AUTH_CACHE.get(token)
    if hit and now - hit[0] < _AUTH_TTL:
        return hit[1]
    user = user_from_token(db, token)
    if user:
        db.expunge(user)
        if len(_AUTH_CACHE) > 500:
            _AUTH_CACHE.clear()
        _AUTH_CACHE[token] = (now, user)
    else:
        _AUTH_CACHE.pop(token, None)
    return user


def check_request(path: str, method: str, token: str):
    """Devuelve (user, error) donde error = (status, code, mensaje) o None."""
    if token:
        hit = _AUTH_CACHE.get(token)
        if hit and time.monotonic() - hit[0] < _AUTH_TTL:
            return _verdict(hit[1], path, method)
    db = SessionLocal()
    try:
        return _verdict(_cached_user(db, token) if token else None, path, method)
    finally:
        db.close()


def _verdict(user, path: str, method: str):
    if not user:
        return None, (401, "no_session", "Inicia sesión para continuar.")
    problem = security.access_problem(user)
    if problem:
        return None, (403, "no_access", problem)
    feat = required_feature(path, method)
    if feat and not security.has_feature(user, feat):
        return None, (403, "no_permission", f"No tienes permiso para: {security.FEATURES.get(feat, feat)}.")
    return user, None


def current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    """Usuario de la petición (el middleware ya validó acceso y permisos; aquí se vuelve a cargar en la sesión)."""
    user = user_from_token(db, token_from(request))
    if not user:
        raise HTTPException(401, "Inicia sesión para continuar.")
    return user


def admin_user(user: models.User = Depends(current_user)) -> models.User:
    if not security.is_admin(user):
        raise HTTPException(403, "Solo el administrador puede hacer esto.")
    return user


def ws_user(feature: str):
    """Dependencia para WebSocket (el middleware HTTP no los cubre)."""
    async def dep(websocket: WebSocket):
        db = SessionLocal()
        try:
            user = user_from_token(db, token_from(websocket))
            err = None
            if not user:
                err = "Inicia sesión para continuar."
            elif security.access_problem(user):
                err = security.access_problem(user)
            elif not security.has_feature(user, feature):
                err = "No tienes permiso para esta función."
            if err:
                raise WebSocketException(code=4401, reason=err[:100])
            return user.id
        finally:
            db.close()
    return dep


def log_activity(db: Session, user, action: str, detail: str = "", client_id: str | None = None) -> None:
    try:
        db.add(models.ActivityLog(
            user_id=getattr(user, "id", None),
            username=getattr(user, "username", "") or "",
            action=action, detail=detail[:1000], client_id=client_id,
        ))
        db.commit()
    except Exception:
        db.rollback()

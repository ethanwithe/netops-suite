"""
auth.py (router)
Inicio y cierre de sesión, perfil propio, foto de perfil y cambio de contraseña.
No existe registro: las cuentas las crea el administrador.
"""

import time
from collections import defaultdict

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import Response as RawResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user, log_activity, token_from, user_from_token
from app.database import get_db
from app.services import security

router = APIRouter(prefix="/api/auth", tags=["auth"])

_fails: dict[str, list[float]] = defaultdict(list)
MAX_FAILS, WINDOW = 6, 15 * 60


def user_out(u: models.User) -> dict:
    return {
        "id": u.id, "username": u.username, "role": u.role, "full_name": u.full_name,
        "email": u.email, "phone": u.phone, "cargo": u.cargo,
        "has_avatar": bool(u.avatar), "avatar_v": len(u.avatar or b""),
        "must_change_password": bool(u.must_change_password),
        "permissions": security.effective_permissions(u),
        "is_admin": security.is_admin(u),
        "valid_until": u.valid_until, "daily_start": u.daily_start, "daily_end": u.daily_end,
    }


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    key = f"{username}|{request.client.host if request.client else ''}"
    now = time.time()
    _fails[key] = [t for t in _fails[key] if now - t < WINDOW]
    if len(_fails[key]) >= MAX_FAILS:
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos e inténtalo otra vez.")
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user or not security.verify_password(payload.password, user.password_hash):
        _fails[key].append(now)
        log_activity(db, user, "login_fallido", f"usuario: {username}")
        raise HTTPException(401, "Usuario o contraseña incorrectos.")
    problem = security.access_problem(user)
    if problem:
        log_activity(db, user, "login_bloqueado", problem)
        raise HTTPException(403, problem)
    _fails.pop(key, None)
    import datetime as dt
    user.last_login = dt.datetime.utcnow()
    db.commit()
    response.set_cookie(
        security.COOKIE_NAME, security.make_token(user.id, user.token_version),
        max_age=security.SESSION_SECONDS, httponly=True, samesite="lax",
        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https",
        path="/",
    )
    log_activity(db, user, "login")
    return user_out(user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    user = user_from_token(db, token_from(request))
    if user:
        log_activity(db, user, "logout")
    response.delete_cookie(security.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: models.User = Depends(current_user)):
    return user_out(user)


class ProfileIn(BaseModel):
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    cargo: str = Field(default="", max_length=80)


@router.put("/me")
def update_me(payload: ProfileIn, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    user.full_name = payload.full_name.strip()
    user.email = payload.email.strip()
    user.phone = payload.phone.strip()
    user.cargo = payload.cargo.strip()
    db.commit()
    log_activity(db, user, "perfil_editado")
    return user_out(user)


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=6, max_length=100)


@router.post("/password")
def change_password(payload: PasswordIn, response: Response, request: Request,
                    user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if not security.verify_password(payload.current, user.password_hash):
        raise HTTPException(400, "La contraseña actual no es correcta.")
    if payload.new == payload.current:
        raise HTTPException(400, "La nueva contraseña debe ser distinta de la actual.")
    user.password_hash = security.hash_password(payload.new)
    user.must_change_password = False
    user.token_version = (user.token_version or 0) + 1   # cierra las demás sesiones
    db.commit()
    response.set_cookie(
        security.COOKIE_NAME, security.make_token(user.id, user.token_version),
        max_age=security.SESSION_SECONDS, httponly=True, samesite="lax",
        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https", path="/",
    )
    log_activity(db, user, "password_cambiada")
    return user_out(user)


@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    data = await file.read()
    if len(data) > 3_000_000:
        raise HTTPException(413, "La foto pesa demasiado (máximo 3 MB).")
    ctype = (file.content_type or "").lower()
    if ctype not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
        raise HTTPException(400, "Sube una imagen PNG, JPG, WEBP o GIF.")
    user.avatar, user.avatar_type = data, ctype
    db.commit()
    return user_out(user)


@router.delete("/avatar")
def delete_avatar(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    user.avatar, user.avatar_type = None, ""
    db.commit()
    return user_out(user)


@router.get("/avatar/{user_id}")
def get_avatar(user_id: str, _: models.User = Depends(current_user), db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u or not u.avatar:
        raise HTTPException(404, "Sin foto.")
    return RawResponse(content=u.avatar, media_type=u.avatar_type or "image/png",
                       headers={"Cache-Control": "private, max-age=300"})

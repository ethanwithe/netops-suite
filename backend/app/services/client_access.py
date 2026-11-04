"""
client_access.py
Qué clientes ve cada usuario, quiénes participan en cada uno y cuántos puntos vale.
Cada cliente vale 1 punto, repartido a partes iguales entre sus participantes.
"""

import datetime as dt

from sqlalchemy.orm import Session

from app import models
from app.services import security


def participant_ids(db: Session, client_id: str) -> list[str]:
    return [r.user_id for r in db.query(models.ClientShare).filter(models.ClientShare.client_id == client_id).all()]


def can_access(db: Session, user: models.User, c: models.Client) -> bool:
    if security.is_admin(user):
        return True
    return user.id in participant_ids(db, c.id)


def add_participant(db: Session, client_id: str, user_id: str) -> None:
    if not db.get(models.ClientShare, (client_id, user_id)):
        db.add(models.ClientShare(client_id=client_id, user_id=user_id))


def visible(db: Session, user: models.User):
    """Clientes (no borrados) donde el usuario participa."""
    return (
        db.query(models.Client)
        .join(models.ClientShare, models.ClientShare.client_id == models.Client.id)
        .filter(models.ClientShare.user_id == user.id, models.Client.deleted_at.is_(None))
    )


def find_by_sot(db: Session, user: models.User, sot: str, include_deleted: bool = False):
    q = db.query(models.Client).join(models.ClientShare, models.ClientShare.client_id == models.Client.id)
    q = q.filter(models.ClientShare.user_id == user.id, models.Client.sot == sot)
    if not include_deleted:
        q = q.filter(models.Client.deleted_at.is_(None))
    return q.first()


def count_clients(db: Session, user_id: str, include_deleted: bool = False) -> int:
    q = db.query(models.Client).join(models.ClientShare, models.ClientShare.client_id == models.Client.id)
    q = q.filter(models.ClientShare.user_id == user_id)
    if not include_deleted:
        q = q.filter(models.Client.deleted_at.is_(None))
    return q.count()


def _users_by_id(db: Session) -> dict[str, models.User]:
    return {u.id: u for u in db.query(models.User).all()}


def _label(u: models.User | None) -> str:
    if not u:
        return "(usuario eliminado)"
    return u.full_name or u.username


def _shares_map(db: Session) -> dict[str, list[str]]:
    m: dict[str, list[str]] = {}
    for r in db.query(models.ClientShare).all():
        m.setdefault(r.client_id, []).append(r.user_id)
    return m


def _out(c: models.Client, shares: list[str], users: dict, viewer_id: str | None) -> dict:
    n = max(1, len(shares))
    return {
        "id": c.id, "sot": c.sot, "nombre": c.nombre, "fecha": c.fecha, "cid": c.cid,
        "proy": c.proy, "contrata": c.contrata, "datos": c.datos or {}, "reportes": c.reportes or [],
        "owner_id": c.owner_id,
        "owner_name": _label(users.get(c.owner_id)),
        "participants": [{"id": uid, "username": getattr(users.get(uid), "username", ""), "name": _label(users.get(uid))} for uid in shares],
        "point": round(1 / n, 4),
        "shared": len(shares) > 1,
        "mine": viewer_id in shares if viewer_id else False,
        "deleted_at": c.deleted_at.isoformat() + "Z" if c.deleted_at else "",
        "updated_at": c.updated_at.isoformat() + "Z" if c.updated_at else "",
    }


def client_out(db: Session, c: models.Client, viewer_id: str | None = None) -> dict:
    return _out(c, participant_ids(db, c.id), _users_by_id(db), viewer_id)


def list_clients_out(db: Session, viewer: models.User | None, user_id: str = "", month: str = "",
                     year: int | None = None, q: str = "", deleted: bool = False) -> list[dict]:
    """viewer=None => todos los clientes (solo administrador). Con viewer => solo donde participa."""
    users, shares = _users_by_id(db), _shares_map(db)
    rows = db.query(models.Client).filter(
        models.Client.deleted_at.isnot(None) if deleted else models.Client.deleted_at.is_(None)
    ).all()
    wanted = user_id or (viewer.id if viewer else "")
    if wanted:
        rows = [r for r in rows if wanted in shares.get(r.id, [])]
    if month:
        rows = [r for r in rows if (r.fecha or "").startswith(month)]
    if year is not None:
        rows = [r for r in rows if (r.fecha or "").startswith(f"{year:04d}-")]
    q = q.strip().lower()
    if q:
        rows = [r for r in rows if q in f"{r.sot} {r.nombre} {r.cid} {r.proy} {r.contrata}".lower()]
    rows.sort(key=lambda r: (r.fecha or "", r.created_at or dt.datetime.min), reverse=True)
    vid = viewer.id if viewer else None
    return [_out(r, shares.get(r.id, []), users, vid) for r in rows]


def points_for(db: Session, user_id: str, month: str = "", year: int | None = None) -> float:
    shares = _shares_map(db)
    total = 0.0
    for c in db.query(models.Client).filter(models.Client.deleted_at.is_(None)).all():
        ids = shares.get(c.id, [])
        if user_id not in ids:
            continue
        f = c.fecha or ""
        if month and not f.startswith(month):
            continue
        if year is not None and not f.startswith(f"{year:04d}-"):
            continue
        total += 1 / len(ids)
    return total


def dashboard(db: Session, viewer: models.User, scope: str, year: int) -> dict:
    """scope 'me' => solo sus clientes; 'all' => todos (solo administradores)."""
    users, shares = _users_by_id(db), _shares_map(db)
    rows = db.query(models.Client).filter(models.Client.deleted_at.is_(None)).all()
    allscope = scope == "all" and security.is_admin(viewer)
    if not allscope:
        rows = [r for r in rows if viewer.id in shares.get(r.id, [])]
    rows = [r for r in rows if (r.fecha or "").startswith(f"{year:04d}-")]

    months = [{"month": f"{year:04d}-{m:02d}", "clients": 0, "points": 0.0} for m in range(1, 13)]
    per_user: dict[str, dict] = {}
    for r in rows:
        ids = shares.get(r.id, []) or ([r.owner_id] if r.owner_id else [])
        try:
            mi = int((r.fecha or "")[5:7]) - 1
        except ValueError:
            mi = -1
        mine = 1 / max(1, len(ids)) if (allscope or viewer.id in ids) else 0
        if 0 <= mi < 12:
            months[mi]["clients"] += 1
            months[mi]["points"] += 1 if allscope else mine
        for uid in ids:
            d = per_user.setdefault(uid, {"user_id": uid, "name": _label(users.get(uid)),
                                          "username": getattr(users.get(uid), "username", ""), "clients": 0, "points": 0.0,
                                          "months": [0.0] * 12})
            d["clients"] += 1
            d["points"] += 1 / max(1, len(ids))
            if 0 <= mi < 12:
                d["months"][mi] += 1 / max(1, len(ids))
    for m in months:
        m["points"] = round(m["points"], 2)
    ranking = sorted(per_user.values(), key=lambda d: (-d["points"], d["name"]))
    for d in ranking:
        d["points"] = round(d["points"], 2)
        d["months"] = [round(x, 2) for x in d["months"]]
    mine_pts = round(points_for(db, viewer.id, year=year), 2)
    mine_n = sum(1 for r in rows if viewer.id in shares.get(r.id, []))
    shared_n = sum(1 for r in rows if len(shares.get(r.id, [])) > 1 and viewer.id in shares.get(r.id, []))
    recent = sorted(rows, key=lambda r: r.updated_at or dt.datetime.min, reverse=True)[:8]
    return {
        "scope": "all" if allscope else "me", "year": year,
        "total_clients": len(rows), "my_clients": mine_n, "my_points": mine_pts, "shared_clients": shared_n,
        "months": months, "ranking": ranking if allscope else [],
        "recent": [_out(r, shares.get(r.id, []), users, viewer.id) for r in recent],
    }

"""
bit_reports.py
Reportes que Bit arma para el administrador a partir de la actividad y los clientes de cada usuario.
Cada reporte devuelve datos listos para dibujar (barras, líneas, tablas o ficha de usuario).
"""

import datetime as dt
import unicodedata
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from app import models
from app.services import client_access as ca

REPORTS = {
    "resumen": "Resumen general: usuarios, clientes y actividad reciente",
    "actividad_usuarios": "Acciones por usuario (days)",
    "actividad_dias": "Acciones por día (days, user opcional)",
    "acciones": "Qué tipo de acciones se hacen (days, user opcional)",
    "clientes_usuarios": "Puntos/clientes por usuario (year)",
    "clientes_meses": "Clientes por mes (year, user opcional)",
    "ingresos": "Ingresos al sistema por usuario (days)",
    "usuario": "Ficha completa de un usuario (user)",
}


def _n(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn").strip()


def label(u: models.User) -> str:
    return (u.full_name or u.username).strip()


def find_user(db: Session, ref: str):
    """Usuario por nombre de usuario o nombre (sin tildes ni mayúsculas); None si no hay uno solo claro."""
    r = _n(ref)
    if not r:
        return None
    users = db.query(models.User).all()
    for u in users:
        if _n(u.username) == r or _n(u.full_name) == r:
            return u
    part = [u for u in users if r in _n(u.username) or r in _n(u.full_name) or any(r == w for w in _n(u.full_name).split())]
    return part[0] if len(part) == 1 else None


def _int(v, default, lo=1, hi=365):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _since(days: int) -> dt.datetime:
    return dt.datetime.utcnow() - dt.timedelta(days=days)


def _logs(db: Session, days: int, user_id: str | None = None):
    q = db.query(models.ActivityLog).filter(models.ActivityLog.at >= _since(days))
    if user_id:
        q = q.filter(models.ActivityLog.user_id == user_id)
    return q.all()


def facts_of(db: Session, user_id: str) -> list[str]:
    p = db.get(models.BitProfile, user_id)
    return list(p.facts or []) if p else []


def digest(db: Session) -> str:
    """Tabla compacta de todos los usuarios para que Bit pueda responder preguntas del administrador."""
    now = dt.datetime.utcnow()
    month = now.strftime("%Y-%m")
    logs = _logs(db, 7)
    by = Counter(l.user_id for l in logs)
    rows = []
    for u in db.query(models.User).order_by(models.User.created_at).limit(60).all():
        p = db.get(models.BitProfile, u.id)
        likes = "; ".join((p.facts or [])[:6]) if p else ""
        last = u.last_login.strftime("%Y-%m-%d %H:%M UTC") if u.last_login else "nunca"
        rows.append(f"- {u.username} | {label(u)} | {u.role}{'' if u.active else ' (inactivo)'} | cargo: {u.cargo or '-'} | último ingreso: {last} | "
                    f"clientes: {ca.count_clients(db, u.id)} | puntos del mes: {ca.points_for(db, u.id, month=month):.1f} | acciones 7d: {by.get(u.id, 0)}"
                    + (f" | gustos que Bit aprendió: {likes}" if likes else ""))
    return "\n".join(rows)


def build(db: Session, kind: str, params: dict) -> dict | None:
    kind = (kind or "").strip()
    days = _int(params.get("days"), 30)
    year = _int(params.get("year"), dt.date.today().year, 2000, 2100)
    user = find_user(db, params["user"]) if params.get("user") else None
    if params.get("user") and not user:
        return {"title": "No encontré a ese usuario", "type": "table", "columns": ["Aviso"], "rows": [[f"No hay un usuario claro para «{params['user']}»."]]}
    names = {u.id: label(u) for u in db.query(models.User).all()}

    if kind == "actividad_usuarios":
        c = Counter(l.user_id for l in _logs(db, days) if l.user_id)
        top = c.most_common(15)
        return {"title": f"Acciones por usuario · últimos {days} días", "type": "bar", "unit": "acciones",
                "labels": [names.get(k, "?") for k, _ in top], "series": [{"name": "Acciones", "values": [v for _, v in top]}]}

    if kind == "actividad_dias":
        logs = _logs(db, days, user.id if user else None)
        c = Counter(l.at.strftime("%Y-%m-%d") for l in logs)
        ds = [(dt.date.today() - dt.timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
        return {"title": f"Acciones por día · {label(user) if user else 'todos'} · {days} días", "type": "line", "unit": "acciones",
                "labels": [d[5:] for d in ds], "series": [{"name": "Acciones", "values": [c.get(d, 0) for d in ds]}]}

    if kind == "acciones":
        c = Counter(l.action for l in _logs(db, days, user.id if user else None) if l.action != "login_fallido")
        top = c.most_common(12)
        return {"title": f"Tipos de acción · {label(user) if user else 'todos'} · {days} días", "type": "bar", "unit": "veces",
                "labels": [k for k, _ in top], "series": [{"name": "Veces", "values": [v for _, v in top]}]}

    if kind == "clientes_usuarios":
        rows = sorted(((label(u), round(ca.points_for(db, u.id, year=year), 2), ca.count_clients(db, u.id)) for u in db.query(models.User).all()), key=lambda r: -r[1])[:15]
        return {"title": f"Puntos por usuario · {year}", "type": "bar", "unit": "puntos",
                "labels": [r[0] for r in rows], "series": [{"name": "Puntos", "values": [r[1] for r in rows]}]}

    if kind == "clientes_meses":
        shares = ca._shares_map(db)
        cnt = Counter()
        for c in db.query(models.Client).filter(models.Client.deleted_at.is_(None)).all():
            if not (c.fecha or "").startswith(f"{year:04d}-"):
                continue
            if user and user.id not in shares.get(c.id, []):
                continue
            cnt[int(c.fecha[5:7])] += 1
        mes = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
        return {"title": f"Clientes por mes · {label(user) if user else 'todos'} · {year}", "type": "bar", "unit": "clientes",
                "labels": mes, "series": [{"name": "Clientes", "values": [cnt.get(i, 0) for i in range(1, 13)]}]}

    if kind == "ingresos":
        logs = _logs(db, days)
        ok, bad = Counter(), Counter()
        for l in logs:
            if l.action == "login":
                ok[l.user_id] += 1
            elif l.action == "login_fallido":
                bad[l.user_id] += 1
        rows = []
        for u in db.query(models.User).all():
            rows.append([label(u), ok.get(u.id, 0), bad.get(u.id, 0), u.last_login.strftime("%d/%m/%Y %H:%M") if u.last_login else "nunca"])
        rows.sort(key=lambda r: -r[1])
        return {"title": f"Ingresos al sistema · últimos {days} días (hora UTC)", "type": "table", "columns": ["Usuario", "Ingresos", "Fallidos", "Último ingreso"], "rows": rows[:30]}

    if kind == "usuario":
        if not user:
            return {"title": "Falta indicar el usuario", "type": "table", "columns": ["Aviso"], "rows": [["Dime de qué usuario quieres la ficha."]]}
        now = dt.datetime.utcnow()
        logs = _logs(db, 30, user.id)
        acts = Counter(l.action for l in logs if l.action != "login_fallido")
        recent = sorted(logs, key=lambda l: l.at, reverse=True)[:10]
        pend = db.query(models.AgendaItem).filter(models.AgendaItem.user_id == user.id, models.AgendaItem.done == False).count()  # noqa: E712
        p = db.get(models.BitProfile, user.id)
        return {"title": f"Ficha de {label(user)}", "type": "profile",
                "cards": [{"label": "Rol", "value": user.role}, {"label": "Clientes", "value": str(ca.count_clients(db, user.id))},
                          {"label": "Puntos del mes", "value": f"{ca.points_for(db, user.id, month=now.strftime('%Y-%m')):.1f}"},
                          {"label": "Acciones (30 d)", "value": str(sum(acts.values()))}, {"label": "Pendientes en agenda", "value": str(pend)},
                          {"label": "Último ingreso", "value": user.last_login.strftime("%d/%m %H:%M") if user.last_login else "nunca"}],
                "labels": [k for k, _ in acts.most_common(8)], "series": [{"name": "Acciones", "values": [v for _, v in acts.most_common(8)]}],
                "unit": "veces", "facts": list((p.facts if p else []) or [])[:15],
                "columns": ["Cuándo (UTC)", "Acción", "Detalle"], "rows": [[l.at.strftime("%d/%m %H:%M"), l.action, (l.detail or "")[:70]] for l in recent]}

    # resumen (por defecto)
    now = dt.datetime.utcnow()
    users = db.query(models.User).all()
    logs7 = _logs(db, 7)
    active = len({l.user_id for l in logs7 if l.user_id})
    total_clients = db.query(models.Client).filter(models.Client.deleted_at.is_(None)).count()
    top = Counter(l.user_id for l in logs7 if l.user_id).most_common(8)
    return {"title": "Resumen general", "type": "profile",
            "cards": [{"label": "Usuarios", "value": str(len(users))}, {"label": "Activos (7 d)", "value": str(active)},
                      {"label": "Clientes", "value": str(total_clients)}, {"label": "Acciones (7 d)", "value": str(len(logs7))}],
            "labels": [names.get(k, "?") for k, _ in top], "series": [{"name": "Acciones", "values": [v for _, v in top]}], "unit": "acciones (7 días)",
            "facts": [], "columns": [], "rows": []}

"""
Lo que Bit aprende de cómo trabaja cada persona, sin que se lo explique de nuevo:
pantallas que abre y a qué horas (rutinas), comandos que usa, SOT en los que trabaja (proyectos),
y qué le sirve en las respuestas (votos 👍/👎). Con eso se arma el contexto que ve el modelo y las
sugerencias para adelantarse a lo que va a necesitar.

Las contraseñas y claves nunca se guardan: los comandos que las mencionan se descartan.
"""
import datetime as dt
import random
import re
from collections import Counter, defaultdict
from typing import List

from sqlalchemy.orm import Session

from app import models

SENSITIVE = re.compile(r"(passw|passwd|secret|community|snmp-server\s+user|\bkey\b|token|contrase|clave|\bpsk\b|credential|\bcipher\b)", re.I)
KINDS = ("page", "cmd", "sot", "checklist")
KEEP_DAYS = 120

ROUTE_NAMES = {
    "/panel": "el panel", "/agenda": "la agenda", "/perfil": "tu perfil", "/grafica": "Gráfica",
    "/grafica/ont-cisco": "la Gráfica de ONT y Router Cisco", "/grafica/iconos": "los iconos de la Gráfica",
    "/plantillas": "Plantillas", "/checklist": "el CheckList", "/checklist/saturador": "el Saturador",
    "/clientes": "Clientes", "/fotografico/gpon-ont": "el reporte fotográfico GPON con ONT",
    "/fotografico/gpon-modulo": "el reporte fotográfico GPON con módulo", "/fotografico/fibra": "el reporte de fibra",
    "/fotografico/poder-judicial": "el reporte Poder Judicial",
}


def route_name(r: str) -> str:
    if r in ROUTE_NAMES:
        return ROUTE_NAMES[r]
    if r.startswith("/checklist/"):
        return "el CheckList " + r.split("/")[-1]
    return r


def clean_cmd(t: str) -> str:
    t = " ".join((t or "").split())[:200]
    return "" if len(t) < 3 or SENSITIVE.search(t) else t


def record(db: Session, user_id: str, events: List[dict]) -> int:
    n = 0
    for e in (events or [])[:40]:
        kind = str(e.get("kind", ""))
        if kind not in KINDS:
            continue
        key = str(e.get("key", ""))[:200]
        if kind == "cmd":
            key = clean_cmd(key)
        key = key.strip()
        if not key or key == "/login":
            continue
        db.add(models.BitEvent(user_id=user_id, kind=kind, key=key, detail=str(e.get("detail", ""))[:200]))
        n += 1
    if n:
        db.commit()
        if random.random() < 0.05:  # poda ocasional
            db.query(models.BitEvent).filter(models.BitEvent.user_id == user_id,
                                             models.BitEvent.at < dt.datetime.utcnow() - dt.timedelta(days=KEEP_DAYS)).delete()
            db.commit()
    return n


def _events(db: Session, user_id: str, kind: str, days: int):
    return (db.query(models.BitEvent).filter(models.BitEvent.user_id == user_id, models.BitEvent.kind == kind,
                                             models.BitEvent.at >= dt.datetime.utcnow() - dt.timedelta(days=days)).all())


def frequent_commands(db: Session, user_id: str, limit: int = 12) -> List[dict]:
    rows = _events(db, user_id, "cmd", 120)
    cnt: Counter = Counter()
    last: dict = {}
    for r in rows:
        cnt[r.key] += 1
        last[r.key] = max(last.get(r.key, r.at), r.at)
    ranked = sorted(cnt, key=lambda k: (cnt[k], last[k]), reverse=True)[:limit]
    return [{"cmd": k, "n": cnt[k]} for k in ranked]


def routines(db: Session, user_id: str, tz: int, now_utc: dt.datetime | None = None) -> List[dict]:
    """Pantallas que suele abrir a esta hora (±1 h) en este tipo de día (laborable o fin de semana), en ≥3 días distintos."""
    now_utc = now_utc or dt.datetime.utcnow()
    off = dt.timedelta(minutes=tz or 0)
    local_now = now_utc - off
    weekday = local_now.weekday() < 5
    days_by_route: dict = defaultdict(set)
    for r in _events(db, user_id, "page", 60):
        lt = r.at - off
        if (lt.weekday() < 5) == weekday and abs(lt.hour - local_now.hour) <= 1 and lt.date() != local_now.date():
            days_by_route[r.key].add(lt.date())
    out = [{"route": k, "days": len(v)} for k, v in days_by_route.items() if len(v) >= 3]
    return sorted(out, key=lambda x: -x["days"])[:3]


def projects(db: Session, user_id: str, limit: int = 5) -> List[str]:
    """SOT en los que trabajó hace poco (por sus acciones y por lo que abrió en el CheckList)."""
    seen: dict = {}
    since = dt.datetime.utcnow() - dt.timedelta(days=30)
    for l in (db.query(models.ActivityLog).filter(models.ActivityLog.user_id == user_id, models.ActivityLog.at >= since,
                                                    models.ActivityLog.action.like("cliente_%")).order_by(models.ActivityLog.at).all()):
        m = re.search(r"SOT\s*([0-9A-Za-z-]+)(?:\s*·\s*(.+))?", l.detail or "")
        if m:
            seen[m.group(1)] = (m.group(2) or "").strip()[:40]
    for r in _events(db, user_id, "sot", 30):
        seen.setdefault(r.key, r.detail[:40])
    items = list(seen.items())[-limit:][::-1]
    return [f"SOT {k}" + (f" ({v})" if v else "") for k, v in items]


def style_line(style: dict | None) -> str:
    st = style or {}
    out = []
    if st.get("largo", 0) >= 2 and st.get("largo", 0) >= st.get("corto", 0):
        out.append("prefiere respuestas más cortas y directas")
    if st.get("corto", 0) >= 2 and st.get("corto", 0) > st.get("largo", 0):
        out.append("prefiere respuestas con más detalle")
    if st.get("incorrecto", 0) >= 2:
        out.append("ha marcado respuestas como incorrectas: verifica con cuidado y di cuando no estés seguro")
    if st.get("no_entendio", 0) >= 2:
        out.append("a veces no le entiendes: haz una pregunta de aclaración antes de responder")
    if st.get("ok", 0) >= 5 and not out:
        out.append("le gusta tu estilo actual; mantenlo")
    return "; ".join(out)


def context(db: Session, user: models.User, prof, tz: int) -> str:
    parts = []
    if prof is not None and (prof.summary or "").strip():
        parts.append("Cómo trabaja (resumen aprendido): " + prof.summary.strip()[:600])
    pr = projects(db, user.id)
    if pr:
        parts.append("Proyectos recientes: " + "; ".join(pr) + ".")
    cm = frequent_commands(db, user.id, 8)
    if cm:
        parts.append("Comandos que más usa: " + "; ".join(c["cmd"] for c in cm) + ".")
    ro = routines(db, user.id, tz)
    if ro:
        parts.append("A esta hora suele abrir: " + ", ".join(route_name(r["route"]) for r in ro) + ".")
    sl = style_line(getattr(prof, "style", None))
    if sl:
        parts.append("Sobre cómo responderle: " + sl + ".")
    if not parts:
        return ""
    return ("\nLO QUE HAS APRENDIDO DE SU FORMA DE TRABAJAR (úsalo para ayudar sin que tenga que explicar de nuevo; adelántate con una "
            "sugerencia concreta cuando venga al caso, sin recitar esta lista):\n" + "\n".join(parts))


def suggestions(db: Session, user: models.User, tz: int, now_utc: dt.datetime | None = None) -> List[dict]:
    now_utc = now_utc or dt.datetime.utcnow()
    off = dt.timedelta(minutes=tz or 0)
    out: List[dict] = []
    pend = (db.query(models.AgendaItem).filter(models.AgendaItem.user_id == user.id, models.AgendaItem.done == False)  # noqa: E712
            .order_by(models.AgendaItem.due_at.is_(None), models.AgendaItem.due_at).all())
    for i in pend:
        if i.due_at and i.due_at <= now_utc + dt.timedelta(minutes=90):
            late = i.due_at < now_utc
            when = (i.due_at - off).strftime("%H:%M")
            out.append({"id": "ag" + i.id[:6], "text": f"{'Se te pasó' if late else 'Pronto'}: {i.title} ({when})", "route": "/agenda"})
    undated = [i for i in pend if not i.due_at and i.kind == "task"]
    if undated:
        out.append({"id": "tasks", "text": f"Tienes {len(undated)} tarea{'s' if len(undated) > 1 else ''} sin fecha. ¿Las ordenamos?", "route": "/agenda"})
    for r in routines(db, user.id, tz)[:1]:
        out.append({"id": "rt" + r["route"], "text": f"A esta hora sueles abrir {route_name(r['route'])}. ¿Vamos?", "route": r["route"]})
    pr = projects(db, user.id, 1)
    if pr:
        out.append({"id": "pj", "text": f"Lo último en lo que trabajaste: {pr[0]}.", "route": "/clientes"})
    return out[:4]


def briefing(db: Session, user: models.User, name: str, tz: int) -> dict:
    now_utc = dt.datetime.utcnow()
    off = dt.timedelta(minutes=tz or 0)
    h = (now_utc - off).hour
    saludo = "Buenos días" if h < 12 else "Buenas tardes" if h < 19 else "Buenas noches"
    sug = suggestions(db, user, tz, now_utc)
    today = (now_utc - off).date()
    pend = (db.query(models.AgendaItem).filter(models.AgendaItem.user_id == user.id, models.AgendaItem.done == False).all())  # noqa: E712
    hoy = [i for i in pend if i.due_at and (i.due_at - off).date() == today]
    bits = [f"{saludo}{', ' + name if name else ''}."]
    if hoy:
        first = sorted(hoy, key=lambda i: i.due_at)[0]
        bits.append(f"Hoy tienes {len(hoy)} cosa{'s' if len(hoy) > 1 else ''} en tu agenda; la primera: {first.title} a las {(first.due_at - off).strftime('%H:%M')}.")
    elif pend:
        bits.append(f"Tienes {len(pend)} pendiente{'s' if len(pend) > 1 else ''} en tu agenda.")
    else:
        bits.append("Tu agenda está limpia.")
    if sug and sug[0]["id"].startswith("rt"):
        bits.append(sug[0]["text"])
    return {"text": " ".join(bits), "suggestions": sug}


def vote(db: Session, user_id: str, ok: bool, reason: str) -> None:
    from app.routers.mascot import _prof  # evitar duplicar la creación del perfil
    p = _prof(db, user_id)
    st = dict(p.style or {})
    key = "ok" if ok else reason if reason in ("largo", "corto", "incorrecto", "no_entendio") else "otro"
    st[key] = int(st.get(key, 0)) + 1
    p.style = st
    p.updated_at = dt.datetime.utcnow()
    db.commit()

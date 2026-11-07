"""
Memoria de trabajo y anticipación de Bit.

- add(): guarda (o refuerza) un recuerdo: proyecto, comando, configuración, preferencia, rutina...
- ctx(): lo que Bit "ya sabe" del trabajo de la persona, para no tener que explicárselo otra vez.
- routines(): rutinas detectadas a partir de la actividad real (días y horas, qué hace cada día).
- proactive(): sugerencias para adelantarse (pendientes vencidos, trabajo sin terminar, costumbres del día).
"""
import datetime as dt
import os
import re
from collections import Counter
from typing import List
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app import models

KINDS = ("proyecto", "comando", "config", "preferencia", "rutina", "feedback", "dato")
LABEL = {"proyecto": "Proyectos y clientes", "comando": "Comandos que usa", "config": "Configuraciones",
         "preferencia": "Preferencias", "rutina": "Rutinas", "feedback": "Respuestas valoradas", "dato": "Otros datos"}
MAX_PER_USER = 200

# Nunca se guarda nada que parezca una credencial.
SECRET = re.compile(r"(password|passwd|secret|community|token|api[-_ ]?key|clave|contrase|\bpass\b|key-string|private-key|\bkey\s+\S{4,}|\bcipher\b)", re.I)

DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
ACTION_LABEL = {  # acción registrada -> (cómo decirlo, pantalla)
    "reporte_generado": ("generar reportes", "/fotografico/gpon-ont"),
    "diagrama_exportado": ("exportar diagramas", "/grafica"),
    "exportacion": ("exportar clientes", "/clientes"),
    "cliente_creado": ("registrar clientes", "/clientes"),
    "cliente_editado": ("actualizar clientes", "/clientes"),
}


def _tz():
    try:
        return ZoneInfo(os.getenv("APP_TZ", "America/Lima"))
    except Exception:
        return dt.timezone(dt.timedelta(hours=-5))


def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9ñ ]", "", (t or "").lower().replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")).strip()


def _clean(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\[\]\n\r]", " ", t or "")).strip()[:200]


def add(db: Session, user_id: str, kind: str, text: str, weight: int = 1) -> bool:
    """Guarda o refuerza un recuerdo. No hace commit. Devuelve False si se descartó."""
    kind = kind if kind in KINDS else "dato"
    t = _clean(text)
    if len(t) < 3 or (kind in ("comando", "config", "dato", "proyecto") and SECRET.search(t)):
        return False
    key = kind + ":" + _norm(t)
    now = dt.datetime.utcnow()
    row = db.query(models.BitMemory).filter(models.BitMemory.user_id == user_id, models.BitMemory.key == key).first()
    if row:
        row.weight = (row.weight or 1) + max(1, weight)
        row.last_seen = now
        return True
    db.add(models.BitMemory(user_id=user_id, kind=kind, text=t, key=key, weight=max(1, weight), created_at=now, last_seen=now))
    db.flush()
    n = db.query(models.BitMemory).filter(models.BitMemory.user_id == user_id).count()
    if n > MAX_PER_USER:  # se olvida lo menos usado y más viejo
        old = (db.query(models.BitMemory).filter(models.BitMemory.user_id == user_id)
               .order_by(models.BitMemory.weight, models.BitMemory.last_seen).limit(n - MAX_PER_USER).all())
        for o in old:
            db.delete(o)
    return True


def items(db: Session, user_id: str) -> List[models.BitMemory]:
    return (db.query(models.BitMemory).filter(models.BitMemory.user_id == user_id)
            .order_by(models.BitMemory.weight.desc(), models.BitMemory.last_seen.desc()).all())


def ctx(db: Session, user_id: str) -> str:
    rows = items(db, user_id)
    if not rows:
        return "\nMemoria de trabajo: aún vacía; ve aprendiendo cómo trabaja (proyectos, comandos, configuraciones, preferencias)."
    out = ["\nMEMORIA DE TRABAJO de esta persona (úsala sin pedirle que la repita; (×n) = cuántas veces lo ha repetido):"]
    for k in KINDS:
        sel = [r for r in rows if r.kind == k]
        if k == "feedback":
            sel = sorted(sel, key=lambda r: r.last_seen, reverse=True)
        sel = sel[:8 if k != "feedback" else 6]
        if sel:
            out.append(f"- {LABEL[k]}: " + " | ".join(r.text + (f" (×{r.weight})" if (r.weight or 1) > 1 and k != "feedback" else "") for r in sel))
    return "\n".join(out)


def routines(db: Session, user: models.User) -> List[str]:
    """Rutinas deducidas de la actividad real de los últimos 60 días."""
    tz = _tz()
    since = dt.datetime.utcnow() - dt.timedelta(days=60)
    logs = [l for l in db.query(models.ActivityLog).filter(models.ActivityLog.user_id == user.id, models.ActivityLog.at >= since).all()
            if l.action not in ("login_fallido", "login_bloqueado", "logout")]
    if len(logs) < 8:
        return []
    loc = [(l.at.replace(tzinfo=dt.timezone.utc).astimezone(tz), l.action) for l in logs]
    out: List[str] = []
    hours = Counter(t.hour for t, _ in loc)
    best = [h for h, _ in hours.most_common(3)]
    if best:
        lo, hi = min(best), max(best)
        out.append(f"Suele estar activo entre las {lo:02d}:00 y las {hi + 1:02d}:00")
    days = Counter(t.weekday() for t, _ in loc)
    top_days = [DAYS[d] for d, _ in days.most_common(2)]
    if top_days:
        out.append("Días de más trabajo: " + " y ".join(top_days))
    by_day: dict = {}
    for t, a in loc:
        if a in ACTION_LABEL:
            by_day.setdefault(t.weekday(), Counter())[a] += 1
    for d, c in sorted(by_day.items()):
        a, n = c.most_common(1)[0]
        if n >= 3:
            out.append(f"Los {DAYS[d]} suele {ACTION_LABEL[a][0]} ({n} veces)")
    return out[:6]


def proactive(db: Session, user: models.User) -> List[dict]:
    """Sugerencias para adelantarse a lo que la persona va a necesitar. [{text, go?}]"""
    tz = _tz()
    now_u = dt.datetime.utcnow()
    now_l = now_u.replace(tzinfo=dt.timezone.utc).astimezone(tz)
    out: List[dict] = []

    # 1. Agenda: vencidos y de hoy
    pend = (db.query(models.AgendaItem).filter(models.AgendaItem.user_id == user.id, models.AgendaItem.done == False)  # noqa: E712
            .filter(models.AgendaItem.due_at.isnot(None)).order_by(models.AgendaItem.due_at).all())
    late = [p for p in pend if p.due_at < now_u]
    today = [p for p in pend if p.due_at >= now_u and p.due_at.replace(tzinfo=dt.timezone.utc).astimezone(tz).date() == now_l.date()]
    if late:
        out.append({"text": f"Tienes {len(late)} pendiente(s) vencido(s): " + "; ".join(p.title for p in late[:3]) + ".", "go": "/agenda"})
    if today:
        out.append({"text": "Hoy te toca: " + "; ".join(f"{p.title} ({p.due_at.replace(tzinfo=dt.timezone.utc).astimezone(tz).strftime('%H:%M')})" for p in today[:3]) + ".", "go": "/agenda"})

    # 2. Trabajo sin terminar: SOT tocados en los últimos 3 días sin reporte generado
    recent = (db.query(models.ActivityLog).filter(models.ActivityLog.user_id == user.id, models.ActivityLog.at >= now_u - dt.timedelta(days=3))
              .order_by(models.ActivityLog.at).all())
    touched, done = {}, set()
    for l in recent:
        m = re.search(r"SOT\s+(\S+)", l.detail or "")
        if not m:
            continue
        if l.action == "reporte_generado":
            done.add(m.group(1))
        elif l.action in ("cliente_creado", "cliente_editado", "cliente_por_bit"):
            touched[m.group(1)] = l.at
    open_ = [s for s in touched if s not in done]
    if open_:
        out.append({"text": "Trabajaste el SOT " + ", ".join(open_[:2]) + " estos días y no veo un reporte generado. ¿Lo dejamos listo?", "go": "/checklist"})

    # 3. Costumbre del día de la semana
    since = now_u - dt.timedelta(days=60)
    cnt: Counter = Counter()
    today_done = set()
    for l in db.query(models.ActivityLog).filter(models.ActivityLog.user_id == user.id, models.ActivityLog.at >= since).all():
        if l.action not in ACTION_LABEL:
            continue
        lt = l.at.replace(tzinfo=dt.timezone.utc).astimezone(tz)
        if lt.weekday() == now_l.weekday():
            cnt[l.action] += 1
        if lt.date() == now_l.date():
            today_done.add(l.action)
    for a, n in cnt.most_common(1):
        if n >= 3 and a not in today_done:
            lab, go = ACTION_LABEL[a]
            out.append({"text": f"Los {DAYS[now_l.weekday()]} sueles {lab}. ¿Te preparo algo para eso?", "go": go})
    return out[:4]

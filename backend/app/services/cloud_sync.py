"""
cloud_sync.py
App de escritorio: sincroniza la base local (SQLite) con la nube (la misma web en Railway) usando SOLO la API
pública /api/sync con la sesión del usuario. Nunca habla con Postgres ni necesita claves de la nube.

- Inicio de sesión: con Internet se valida contra la nube y se guarda una copia local de la cuenta (mismo id), así
  después se entra también sin conexión. Si la nube dice «contraseña incorrecta» a un usuario ya vinculado, no se entra.
- Subir: cada registro cambiado se envía con su versión base (idempotente). Si la nube tiene otra versión => CONFLICTO:
  nunca se pisa en silencio; el usuario elige «la mía» o «la de la nube».
- Bajar: se traen los cambios de la nube; si lo local también cambió => CONFLICTO.
- Fotos: se suben/bajan por su nombre (id único) con verificación de huella.
- El token de sesión se guarda protegido con DPAPI de Windows (en otros sistemas, archivo solo legible por el usuario).
"""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx

from app import models
from app.config import UPLOADS_DIR
from app.database import SessionLocal
from app.routers import sync as S
from app.services import client_access as ca, reference_sync, security

DATA = {"client": S.client_data, "workspace": S.ws_data, "checklist_copy": S.ck_data}
ORDER = ("client", "workspace", "checklist_copy")
PHOTO_RE = re.compile(r"(?<![A-Za-z0-9-])([0-9a-fA-F-]{32,36}\.(?:png|jpe?g|gif|webp))(?![A-Za-z0-9])", re.I)
CYCLE_SECONDS = 10
REF_EVERY = 60          # los datos de referencia (usuarios, logos, catálogos) se revisan como mucho cada minuto
_ref_at = [0.0]
BATCH_OPS, BATCH_BYTES = 50, 6_000_000


class NeedLogin(Exception):
    pass


class Offline(Exception):
    pass


# ------------------------------------------------------------------ configuración y token protegido
_cfg_lock = threading.Lock()


def _dir() -> Path:
    d = Path(os.getenv("NETOPS_DATA_DIR") or Path.home() / ".netops-suite")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cfg_path() -> Path:
    return _dir() / "cloud.json"


def load_cfg() -> dict:
    with _cfg_lock:
        try:
            return json.loads(_cfg_path().read_text("utf-8"))
        except (OSError, ValueError):
            return {}


def save_cfg(cfg: dict) -> None:
    with _cfg_lock:
        p = _cfg_path()
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(cfg), "utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, p)


def cloud_url() -> str:
    return (load_cfg().get("url") or os.getenv("NETOPS_CLOUD_URL", "")).strip().rstrip("/")


def _dpapi(data: bytes, protect: bool) -> bytes:
    import ctypes
    from ctypes import wintypes as wt

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    src = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    out = Blob()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0, ctypes.byref(out)):
        raise OSError("DPAPI")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


def protect_secret(text: str) -> str:
    raw = text.encode()
    if os.name == "nt":
        try:
            return "dpapi:" + base64.b64encode(_dpapi(raw, True)).decode()
        except Exception:  # noqa: BLE001
            pass
    return "file:" + base64.b64encode(raw).decode()


def unprotect_secret(blob: str) -> str:
    kind, _, body = (blob or "").partition(":")
    raw = base64.b64decode(body) if body else b""
    if kind == "dpapi":
        return _dpapi(raw, False).decode()
    return raw.decode()


def _token(cfg: dict) -> str:
    try:
        return unprotect_secret(cfg.get("token", "")) if cfg.get("token") else ""
    except Exception:  # noqa: BLE001
        return ""


def is_linked(username: str) -> bool:
    return username.strip().lower() in (load_cfg().get("linked") or {})


# ------------------------------------------------------------------ estado visible en la interfaz
STATE: dict[str, Any] = {"state": "idle", "running": False, "last_sync": "", "error": "", "pending": 0}
_kick = threading.Event()
_run_lock = threading.Lock()


def _set(**kw: Any) -> None:
    STATE.update(kw)


def kick() -> None:
    _kick.set()


def _http(token: str = "") -> httpx.Client:
    h = {"X-Client": "native"}
    if token:
        h["Authorization"] = "Bearer " + token
    return httpx.Client(base_url=cloud_url(), headers=h, timeout=httpx.Timeout(60, connect=8), follow_redirects=True)


def _call(h: httpx.Client, method: str, url: str, **kw: Any) -> httpx.Response:
    try:
        r = h.request(method, url, **kw)
    except httpx.HTTPError as e:
        raise Offline(str(e)) from e
    if r.status_code == 401:
        raise NeedLogin()
    if r.status_code >= 500 or r.status_code == 429:
        raise Offline(f"La nube respondió {r.status_code}")
    return r


# ------------------------------------------------------------------ inicio de sesión contra la nube
def _mirror_user(db, data: dict, password: str) -> models.User:
    """Copia local de la cuenta de la nube (mismo id): permite entrar luego sin conexión."""
    uname = str(data["username"]).strip().lower()
    clash = db.query(models.User).filter(models.User.username == uname, models.User.id != data["id"]).first()
    if clash:  # una cuenta local de otra persona con el mismo nombre (p. ej. la de fábrica): se aparta, no se borra
        clash.username, clash.active = f"{clash.username}-local-{clash.id[:6]}", False
        db.flush()
    u = db.get(models.User, data["id"])
    if not u:
        u = models.User(id=data["id"], username=uname, password_hash="")
        db.add(u)
    u.username, u.role = uname, data.get("role") or "user"
    for f in ("full_name", "email", "phone", "cargo", "valid_until", "daily_start", "daily_end"):
        setattr(u, f, data.get(f) or "")
    u.permissions = data.get("permissions") or {}
    u.password_hash = security.hash_password(password)
    u.active, u.must_change_password = True, False
    db.commit()
    return u


def login_via_cloud(db, username: str, password: str):
    """('ok', usuario) | ('denied', mensaje) | ('offline', None)."""
    url = cloud_url()
    if not url:
        return "offline", None
    try:
        r = httpx.post(url + "/api/auth/login", json={"username": username, "password": password},
                       headers={"X-Client": "native"}, timeout=httpx.Timeout(15, connect=6), follow_redirects=True)
    except httpx.HTTPError:
        return "offline", None
    if r.status_code in (401, 403, 429):
        try:
            return "denied", r.json().get("detail")
        except ValueError:
            return "denied", None
    if r.status_code != 200:
        return "offline", None
    data = r.json()
    token = data.pop("token", "")
    user = _mirror_user(db, data, password)
    cfg = load_cfg()
    cfg.setdefault("device_id", uuid.uuid4().hex)
    cfg.setdefault("linked", {})[user.username] = user.id
    if token:
        cfg["token"], cfg["user_id"] = protect_secret(token), user.id
    save_cfg(cfg)
    kick()
    return "ok", user


# ------------------------------------------------------------------ utilidades de datos
def _hash(data: Any) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def photo_names(obj: Any) -> list[str]:
    return sorted(set(m.group(1) for m in PHOTO_RE.finditer(json.dumps(obj, ensure_ascii=False, default=str))))


def _local_row(db, ent: str, eid: str):
    if ent == "client":
        return db.get(models.Client, eid)
    if ent == "workspace":
        cid, _, key = eid.partition("|")
        return db.get(models.UserWorkspace, (cid, key))
    return db.get(models.ChecklistUserCopy, eid)


def _tracked(db, ent: str, eid: str, create: bool = False):
    t = db.get(models.CloudItem, (ent, eid))
    if not t and create:
        t = models.CloudItem(entity=ent, id=eid)
        db.add(t)
    return t


def _upload_photos(h: httpx.Client, db, names: list[str]) -> None:
    todo = [n for n in dict.fromkeys(names) if not db.get(models.CloudItem, ("photo", n)) and (UPLOADS_DIR / n).is_file()]
    if not todo:
        return

    def one(n: str):
        content = (UPLOADS_DIR / n).read_bytes()
        sha = hashlib.sha256(content).hexdigest()
        r = _call(h, "POST", "/api/sync/photos", files={"file": (n, content)}, data={"photo_id": Path(n).stem, "sha256": sha})
        return n, sha, r

    with ThreadPoolExecutor(max_workers=4) as ex:      # varias fotos a la vez (la base se escribe aquí, en un solo hilo)
        for n, sha, r in ex.map(one, todo):
            if r.status_code == 200 and r.json().get("sha256") == sha:      # solo se marca como enviada si llegó completa
                db.add(models.CloudItem(entity="photo", id=n, synced_hash=sha, status="SYNCED"))
                db.commit()
            elif r.status_code == 422:
                raise Offline("La foto llegó dañada: se reintenta.")


def _download_photos(h: httpx.Client, names: list[str]) -> None:
    todo = [n for n in dict.fromkeys(names) if not (UPLOADS_DIR / n).is_file()]
    if not todo:
        return

    def one(n: str) -> None:
        r = _call(h, "GET", f"/api/files/uploads/{n}")
        if r.status_code == 200 and r.content:
            dest = UPLOADS_DIR / n
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(r.content)
            os.replace(tmp, dest)

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(one, todo))


# ------------------------------------------------------------------ aplicar lo que llega de la nube
def _apply_remote(db, user: models.User, item: dict):
    ent, eid, d = item["entity"], item["id"], item.get("data") or {}
    now = dt.datetime.utcnow()
    if ent == "client":
        row = db.get(models.Client, eid)
        if item.get("deleted"):
            if row and not row.deleted_at:
                row.deleted_at, row.deleted_by = now, "nube"
            return row
        if row is None:
            row = models.Client(id=eid, sot=d.get("sot", ""), datos={}, reportes=[], owner_id=user.id, version=1)
            db.add(row)
            db.flush()
        ca.add_participant(db, eid, user.id)
        row.sot, row.nombre, row.fecha = d.get("sot", ""), d.get("nombre", ""), d.get("fecha", "")
        row.cid, row.proy, row.contrata = d.get("cid", ""), d.get("proy", ""), d.get("contrata", "")
        row.datos = d.get("datos") or {}
        have = {r.get("filename"): r for r in (row.reportes or []) if isinstance(r, dict)}
        for r in d.get("reportes") or []:
            if isinstance(r, dict) and r.get("filename"):
                have[r["filename"]] = r
        row.reportes = list(have.values())[-150:]
        row.deleted_at = row.deleted_by = None
        db.flush()
        return row
    if ent == "workspace":
        cid, key = d.get("client_id") or eid.partition("|")[0], d.get("key") or eid.partition("|")[2]
        if not db.get(models.Client, cid):
            return None
        w = db.get(models.UserWorkspace, (cid, key))
        if w is None:
            w = models.UserWorkspace(client_id=cid, key=key, state={}, version=1)
            db.add(w)
        w.label, w.route, w.state, w.updated_by = d.get("label", ""), d.get("route", ""), d.get("state") or {}, "nube"
        db.flush()
        return w
    c = db.get(models.ChecklistUserCopy, eid)
    if c is None:
        c = models.ChecklistUserCopy(id=eid, user_id=user.id, tpl_id=d.get("tpl_id", ""), nombre="", data={}, version=1)
        db.add(c)
    c.tpl_id, c.nombre, c.data = d.get("tpl_id", c.tpl_id), d.get("nombre", ""), d.get("data") or {}
    db.flush()
    return c


def _mark_synced(db, ent: str, eid: str, item_version: int):
    db.commit()
    row = _local_row(db, ent, eid)
    t = _tracked(db, ent, eid, create=True)
    if row is not None:
        db.refresh(row)
        t.local_version = row.version or 0
        t.synced_hash = _hash({"deleted": True} if (ent == "client" and row.deleted_at) else DATA[ent](row))
    t.remote_version, t.status, t.info, t.updated_at = item_version, "SYNCED", None, dt.datetime.utcnow()
    db.commit()


def _local_changed(db, ent: str, row, t) -> bool:
    if row is None:
        return False
    if t is None:
        return True
    if t.local_version and (row.version or 0) == t.local_version:
        return False
    deleted = ent == "client" and bool(row.deleted_at)
    return _hash({"deleted": True} if deleted else DATA[ent](row)) != t.synced_hash


# ------------------------------------------------------------------ subir
def _collect(db, user: models.User) -> list[tuple]:
    ids = [r[0] for r in db.query(models.ClientShare.client_id).filter(models.ClientShare.user_id == user.id)]
    out: list[tuple] = []
    for c in db.query(models.Client).filter(models.Client.id.in_(ids)):
        out.append(("client", c.id, c, c.version or 0, bool(c.deleted_at)))
    for w in db.query(models.UserWorkspace).filter(models.UserWorkspace.client_id.in_(ids)):
        out.append(("workspace", S.ws_id(w.client_id, w.key), w, w.version or 0, False))
    for k in db.query(models.ChecklistUserCopy).filter(models.ChecklistUserCopy.user_id == user.id):
        out.append(("checklist_copy", k.id, k, k.version or 0, False))
    out.sort(key=lambda x: ORDER.index(x[0]))
    return out


def _op_id(ent: str, eid: str, h: str, base: Optional[int]) -> str:
    return hashlib.sha256(f"{ent}|{eid}|{h}|{base}".encode()).hexdigest()[:40]   # igual en cada reintento => idempotente


def _push(db, h: httpx.Client, user: models.User, cfg: dict) -> tuple[int, int]:
    queued: list[dict] = []
    tracked = {(t.entity, t.id): t for t in db.query(models.CloudItem).filter(models.CloudItem.entity != "photo")}
    seen = set()
    for ent, eid, row, ver, deleted in _collect(db, user):
        seen.add((ent, eid))
        t = tracked.get((ent, eid))
        if t and t.status in ("CONFLICT", "ERROR") and t.local_version == ver:
            continue
        if t and t.status == "SYNCED" and t.local_version == ver:
            continue
        data = {"deleted": True} if deleted else DATA[ent](row)
        hh = _hash(data)
        if t and t.status == "SYNCED" and t.synced_hash == hh:
            t.local_version = ver
            continue
        if deleted and not (t and t.remote_version):
            continue                                    # se creó y se borró sin llegar a la nube
        base = t.remote_version if (t and t.remote_version) else None
        queued.append({"op_id": _op_id(ent, eid, hh, base), "entity": ent, "entity_id": eid,
                       "action": "delete" if deleted else "upsert", "base_version": base,
                       "data": {} if deleted else data, "_h": hh, "_ver": ver})
    # registros que existían en la nube y ya no están aquí (ventana o copia borradas)
    for (ent, eid), t in tracked.items():
        if ent in ("workspace", "checklist_copy") and t.remote_version and (ent, eid) not in seen and t.status == "SYNCED" and _local_row(db, ent, eid) is None:
            queued.append({"op_id": _op_id(ent, eid, "deleted", t.remote_version), "entity": ent, "entity_id": eid,
                           "action": "delete", "base_version": t.remote_version, "data": {}, "_h": "deleted", "_ver": 0})
    db.commit()
    applied = problems = 0
    i = 0
    while i < len(queued):
        batch, size = [], 0
        while i < len(queued) and len(batch) < BATCH_OPS and (not batch or size < BATCH_BYTES):
            batch.append(queued[i])
            size += len(json.dumps(queued[i]["data"], default=str))
            i += 1
        for op in batch:
            if op["action"] == "upsert":
                _upload_photos(h, db, photo_names(op["data"]))    # primero las fotos: así quien baje el dato ya las encuentra
        body = {"device_id": cfg.get("device_id", ""), "ops": [{k: v for k, v in op.items() if not k.startswith("_")} for op in batch]}
        r = _call(h, "POST", "/api/sync/push", json=body)
        if r.status_code != 200:
            raise Offline(f"push: {r.status_code} {r.text[:120]}")
        by_id = {x["op_id"]: x for x in r.json().get("results", [])}
        for op in batch:
            res = by_id.get(op["op_id"])
            if not res:
                continue
            ent, eid = op["entity"], op["entity_id"]
            t = _tracked(db, ent, eid, create=True)
            if res["status"] == "applied":
                if op["action"] == "delete":
                    if ent == "client":
                        t.remote_version = res.get("version") or t.remote_version
                        t.local_version, t.synced_hash, t.status, t.info = op["_ver"], op["_h"], "SYNCED", None
                    else:
                        db.delete(t)
                else:
                    t.remote_version, t.local_version, t.synced_hash = int(res.get("version") or 1), op["_ver"], op["_h"]
                    t.status, t.info = "SYNCED", None
                applied += 1
            elif res["status"] == "conflict":
                t.status, t.local_version = "CONFLICT", op["_ver"]
                t.info = {"server": res.get("server"), "reason": res.get("reason", "version"), "action": op["action"]}
                problems += 1
            else:                                       # rejected | error
                t.status, t.local_version = "ERROR", op["_ver"]
                t.info = {"error": res.get("error") or "No se pudo enviar."}
                problems += 1
            t.updated_at = dt.datetime.utcnow()
        db.commit()
    return applied, problems


# ------------------------------------------------------------------ bajar
def _pull(db, h: httpx.Client, user: models.User, cfg: dict) -> int:
    changed = 0
    cursors = cfg.setdefault("cursors", {})
    for ent in ORDER:
        since, cursor, new_since = cursors.get(ent, ""), "", ""
        while True:
            params: dict[str, Any] = {"entity": ent, "limit": 100}
            if cursor:
                params["cursor"] = cursor
            elif since:
                params["since"] = since
            r = _call(h, "GET", "/api/sync/pull", params=params)
            if r.status_code != 200:
                raise Offline(f"pull: {r.status_code}")
            page = r.json()
            if not new_since:
                st = dt.datetime.fromisoformat(page["server_time"].replace("Z", "+00:00")) - dt.timedelta(seconds=3)
                new_since = st.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"
            for it in page.get("items", []):
                changed += _pull_item(db, h, user, it)
            cursor = page.get("next_cursor") or ""
            if not cursor:
                break
        cursors[ent] = new_since
        save_cfg(cfg)
    return changed


def _pull_reference(db, h: httpx.Client, user: models.User, cfg: dict) -> None:
    """Usuarios, logos, catálogos y ajustes de la nube. Un fallo aquí no frena el resto de la sincronización."""
    try:
        if time.time() - _ref_at[0] < REF_EVERY:
            return
        have = cfg.setdefault("ref", {})
        r = _call(h, "POST", "/api/sync/reference", json={"have": have})
        if r.status_code != 200:
            return
        _ref_at[0] = time.time()
        done = reference_sync.apply(db, r.json().get("tables", {}), user.id)
        if done:
            have.update(done)
            save_cfg(cfg)
    except (Offline, NeedLogin):
        raise
    except Exception:  # noqa: BLE001
        db.rollback()


def _pull_item(db, h: httpx.Client, user: models.User, it: dict) -> int:
    ent, eid = it["entity"], it["id"]
    t = _tracked(db, ent, eid)
    row = _local_row(db, ent, eid)
    if t and t.status == "CONFLICT":
        t.info = {**(t.info or {}), "server": it}      # se guarda lo más nuevo de la nube para decidir
        db.commit()
        return 0
    if t and t.remote_version == it["version"]:
        _download_photos(h, photo_names(it.get("data")))
        return 0
    if row is not None and _local_changed(db, ent, row, t):
        same = t is None and _hash(DATA[ent](row)) == _hash(it.get("data")) and not it.get("deleted")
        if not same:
            t = _tracked(db, ent, eid, create=True)
            t.status, t.local_version = "CONFLICT", row.version or 0
            t.info = {"server": it, "reason": "version", "action": "upsert"}
            db.commit()
            return 0
    _download_photos(h, photo_names(it.get("data")))
    _apply_remote(db, user, it)
    _mark_synced(db, ent, eid, int(it["version"]))
    return 1


# ------------------------------------------------------------------ ciclo completo
def sync_once(force: bool = False) -> dict:
    if force:
        _ref_at[0] = 0.0
    with _run_lock:          # un solo ciclo a la vez (el automático y el «Sincronizar ahora» esperan su turno)
        return _sync_locked()


def _sync_locked() -> dict:
    try:
        cfg = load_cfg()
        token = _token(cfg)
        if not cloud_url() or not token:
            _set(state="needs_login" if cfg.get("linked") else "idle")
            return dict(STATE)
        _set(running=True)
        db = SessionLocal()
        try:
            user = db.get(models.User, cfg.get("user_id", ""))
            if not user or not user.active:
                _set(state="needs_login")
                return dict(STATE)
            with _http(token) as h:
                applied, problems = _push(db, h, user, cfg)
                got = _pull(db, h, user, cfg)
                _pull_reference(db, h, user, cfg)
            conflicts = db.query(models.CloudItem).filter(models.CloudItem.status == "CONFLICT").count()
            errors = db.query(models.CloudItem).filter(models.CloudItem.status == "ERROR").count()
            _set(state="conflict" if conflicts else ("error" if errors else "synced"), pending=conflicts + errors, conflicts=conflicts,
                 last_sync=dt.datetime.utcnow().isoformat() + "Z", error="", sent=applied, received=got)
        finally:
            db.close()
    except NeedLogin:
        _set(state="needs_login", error="La sesión con la nube venció: inicia sesión otra vez con Internet.")
    except Offline as e:
        _set(state="offline", error=str(e)[:200])
    except Exception as e:  # noqa: BLE001
        _set(state="error", error=f"{type(e).__name__}: {str(e)[:200]}")
    finally:
        _set(running=False)
    return dict(STATE)


def pending_count(db) -> int:
    return db.query(models.CloudItem).filter(models.CloudItem.status.in_(("CONFLICT", "ERROR"))).count()


def conflicts(db, user: models.User) -> list[dict]:
    out = []
    for t in db.query(models.CloudItem).filter(models.CloudItem.status == "CONFLICT"):
        row = _local_row(db, t.entity, t.id)
        label = t.id
        if t.entity == "client" and row:
            label = f"SOT {row.sot} {row.nombre}".strip()
        elif t.entity == "workspace" and row:
            c = db.get(models.Client, row.client_id)
            label = f"Ventana «{row.label or row.key}» · SOT {c.sot if c else ''}"
        elif t.entity == "checklist_copy" and row:
            label = f"CheckList «{row.nombre}»"
        srv = (t.info or {}).get("server") or {}
        out.append({"entity": t.entity, "id": t.id, "label": label, "reason": (t.info or {}).get("reason", "version"),
                    "server_updated_at": srv.get("updated_at", ""), "server_deleted": bool(srv.get("deleted"))})
    return out


def resolve(db, user: models.User, ent: str, eid: str, resolution: str) -> None:
    t = db.get(models.CloudItem, (ent, eid))
    if not t or t.status != "CONFLICT":
        raise ValueError("Ese conflicto ya no existe.")
    info = t.info or {}
    srv = info.get("server") or {}
    cfg = load_cfg()
    if resolution == "theirs":
        with _http(_token(cfg)) as h:
            _download_photos(h, photo_names(srv.get("data")))
        row = _local_row(db, ent, eid)
        if info.get("reason") == "duplicate_sot":    # la nube ya tiene otro cliente con esa SOT: se queda el de la nube
            if row is not None and ent == "client":
                row.deleted_at, row.deleted_by = dt.datetime.utcnow(), "conflicto"
            db.delete(t)
            db.commit()
            _apply_remote(db, user, srv)
            _mark_synced(db, srv["entity"], srv["id"], int(srv["version"]))
        else:
            _apply_remote(db, user, srv)
            _mark_synced(db, ent, eid, int(srv["version"]))
    elif resolution == "mine":
        if info.get("reason") == "duplicate_sot":
            raise ValueError("Esa SOT ya existe en la nube: elige la de la nube o cambia la SOT en este equipo.")
        row = _local_row(db, ent, eid)
        deleting = info.get("action") == "delete" or (ent == "client" and row is not None and bool(row.deleted_at))
        data = {} if deleting or row is None else DATA[ent](row)
        base = int(srv.get("version") or t.remote_version or 0) or None
        op = {"op_id": uuid.uuid4().hex, "entity": ent, "entity_id": eid, "action": "delete" if deleting else "upsert",
              "base_version": base, "data": data, "force": True}
        with _http(_token(cfg)) as h:
            _upload_photos(h, db, photo_names(data))
            r = _call(h, "POST", "/api/sync/push", json={"device_id": cfg.get("device_id", ""), "ops": [op]})
        res = (r.json().get("results") or [{}])[0] if r.status_code == 200 else {}
        if res.get("status") != "applied":
            raise ValueError(res.get("error") or "No se pudo aplicar lo tuyo en la nube.")
        t.remote_version, t.status, t.info = int(res.get("version") or base or 1), "SYNCED", None
        if row is not None:
            t.local_version = row.version or 0
            t.synced_hash = _hash({"deleted": True} if deleting else data)
        db.commit()
    else:
        raise ValueError("Resolución inválida.")
    kick()


# ------------------------------------------------------------------ hilo permanente
def start_agent() -> None:
    def loop() -> None:
        while True:
            try:
                sync_once()
            except Exception:  # noqa: BLE001
                pass
            _kick.wait(CYCLE_SECONDS)
            _kick.clear()

    threading.Thread(target=loop, daemon=True, name="cloud-sync").start()

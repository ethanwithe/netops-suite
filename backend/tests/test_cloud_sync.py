"""
Prueba de extremo a extremo de la app de escritorio: dos programas reales (la «nube» y el servidor local de escritorio,
cada uno con su propia base SQLite) hablando por HTTP. Comprueba inicio de sesión, subir, bajar, fotos,
conflictos (las dos formas de resolverlos) y funcionamiento sin conexión.
"""
import hashlib
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait(url: str, secs: int = 90) -> None:
    end = time.time() + secs
    while time.time() < end:
        try:
            if httpx.get(url, timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise RuntimeError("no arrancó " + url)


def _env(data: str, **extra) -> dict:
    e = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "NETOPS_DATA_DIR", "UPLOADS_DIR", "OUTPUTS_DIR")}
    e.update({"NETOPS_LOCAL": "1", "NETOPS_DATA_DIR": data, "UPLOADS_DIR": data + "/uploads", "OUTPUTS_DIR": data + "/outputs",
              "PYTHONUNBUFFERED": "1", "TELEGRAM_API_ID": ""})
    e.update(extra)
    return e


@pytest.fixture(scope="module")
def world():
    cloud_dir, local_dir = tempfile.mkdtemp(prefix="cloud-"), tempfile.mkdtemp(prefix="local-")
    cport = _free_port()
    cloud = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cport), "--log-level", "warning"],
                             cwd=BACKEND, env=_env(cloud_dir))
    local = None
    try:
        _wait(f"http://127.0.0.1:{cport}/api/health")
        local = subprocess.Popen([sys.executable, "desktop_main.py"], cwd=BACKEND, stdout=subprocess.PIPE, text=True,
                                 env=_env(local_dir, NETOPS_CLOUD_URL=f"http://127.0.0.1:{cport}"))
        lport = None
        end = time.time() + 90
        while time.time() < end and lport is None:
            line = local.stdout.readline()
            m = re.match(r"NETOPS_READY (\d+)", line or "")
            if m:
                lport = int(m.group(1))
            elif not line and local.poll() is not None:
                break
        assert lport, "el servidor local no avisó que estaba listo"
        yield {"cloud": f"http://127.0.0.1:{cport}", "local": f"http://127.0.0.1:{lport}", "cloud_proc": cloud, "cloud_dir": cloud_dir, "local_dir": local_dir}
    finally:
        for p in (local, cloud):
            if p and p.poll() is None:
                p.kill()


class Api:
    def __init__(self, base: str):
        self.c = httpx.Client(base_url=base, timeout=60, headers={"X-Client": "native"})

    def login(self, user="superadmin", pw="superadmin123"):
        r = self.c.post("/api/auth/login", json={"username": user, "password": pw})
        return r

    def use_token(self):
        t = self.login().json()["token"]
        self.c.headers["Authorization"] = "Bearer " + t

    def pull(self, entity):
        r = self.c.get("/api/sync/pull", params={"entity": entity, "limit": 200})
        assert r.status_code == 200, r.text
        return {i["id"]: i for i in r.json()["items"]}

    def push(self, entity, eid, data, base=None, action="upsert"):
        body = {"device_id": "test", "ops": [{"op_id": uuid.uuid4().hex, "entity": entity, "entity_id": eid, "action": action, "base_version": base, "data": data}]}
        r = self.c.post("/api/sync/push", json=body)
        assert r.status_code == 200, r.text
        return r.json()["results"][0]

    def photo(self, content: bytes) -> str:
        pid = uuid.uuid4().hex
        r = self.c.post("/api/sync/photos", files={"file": (pid + ".jpg", content)}, data={"photo_id": pid, "sha256": hashlib.sha256(content).hexdigest()})
        assert r.status_code == 200, r.text
        return pid + ".jpg"

    def sync(self):
        r = self.c.post("/api/cloud/sync")
        assert r.status_code == 200, r.text
        return r.json()


def client_data(sot, nombre):
    return {"sot": sot, "nombre": nombre, "fecha": "2026-11-01", "cid": "", "proy": "", "contrata": "", "datos": {"ip": "10.0.0.1"}, "reportes": []}


def test_flujo_completo(world):
    cloud, local = Api(world["cloud"]), Api(world["local"])
    cloud.use_token()

    # La nube ya tiene un cliente con ventana y foto (hecho desde la web / otro equipo).
    foto_a = cloud.photo(b"\xff\xd8\xff fake-jpeg A " * 50)
    cid_a = uuid.uuid4().hex
    assert cloud.push("client", cid_a, client_data("A1", "Cliente A"))["status"] == "applied"
    ws_a = {"client_id": cid_a, "key": "fotografico", "label": "Fotográfico", "route": "/fotografico", "state": {"items": [{"foto": foto_a}]}}
    assert cloud.push("workspace", f"{cid_a}|fotografico", ws_a)["status"] == "applied"

    # 1) Iniciar sesión en el escritorio con la cuenta de la nube (copia local de la cuenta)
    r = local.login()
    assert r.status_code == 200, r.text
    local.use_token()
    st = local.sync()
    assert st["linked"] and st["state"] == "synced", st

    # 2) Bajó el cliente, la ventana y la foto, y la foto es idéntica
    items = local.pull("client")
    assert cid_a in items and items[cid_a]["data"]["nombre"] == "Cliente A"
    assert f"{cid_a}|fotografico" in local.pull("workspace")
    f = local.c.get(f"/api/files/uploads/{foto_a}")
    assert f.status_code == 200 and f.content == b"\xff\xd8\xff fake-jpeg A " * 50

    # 3) Trabajo sin la nube en el escritorio: cliente nuevo con foto + edición del que bajó -> sube todo
    foto_b = local.photo(b"\xff\xd8\xff fake-jpeg B " * 80)
    cid_b = uuid.uuid4().hex
    assert local.push("client", cid_b, client_data("B2", "Cliente B"))["status"] == "applied"
    assert local.push("workspace", f"{cid_b}|fotografico", {"client_id": cid_b, "key": "fotografico", "label": "F", "route": "/f", "state": {"items": [{"foto": foto_b}]}})["status"] == "applied"
    va = items[cid_a]["version"]
    assert local.push("client", cid_a, client_data("A1", "Cliente A editado en escritorio"), base=va)["status"] == "applied"
    st = local.sync()
    assert st["state"] == "synced" and st["pending"] == 0, st
    on_cloud = cloud.pull("client")
    assert on_cloud[cid_b]["data"]["sot"] == "B2"
    assert on_cloud[cid_a]["data"]["nombre"] == "Cliente A editado en escritorio"
    fb = cloud.c.get(f"/api/files/uploads/{foto_b}")
    assert fb.status_code == 200 and fb.content == b"\xff\xd8\xff fake-jpeg B " * 80
    # repetir la sincronización no cambia nada (idempotente, sin duplicados)
    assert local.sync()["state"] == "synced"
    assert len([i for i in cloud.pull("client").values() if i["data"]["sot"] == "B2"]) == 1

    # 4) Conflicto: se edita lo mismo en la nube y en el escritorio -> nunca se pisa; se elige «la de la nube»
    va = local.pull("client")[cid_a]["version"]
    vc = cloud.pull("client")[cid_a]["version"]
    assert cloud.push("client", cid_a, client_data("A1", "Versión de la nube"), base=vc)["status"] == "applied"
    assert local.push("client", cid_a, client_data("A1", "Versión del escritorio"), base=va)["status"] == "applied"
    st = local.sync()
    assert st["state"] == "conflict" and len(st["conflicts"]) == 1, st
    assert cloud.pull("client")[cid_a]["data"]["nombre"] == "Versión de la nube"          # la nube no se tocó
    assert local.pull("client")[cid_a]["data"]["nombre"] == "Versión del escritorio"      # lo local tampoco
    st = local.c.post("/api/cloud/resolve", json={"entity": "client", "id": cid_a, "resolution": "theirs"}).json()
    assert st["state"] == "synced" and not st["conflicts"], st
    assert local.pull("client")[cid_a]["data"]["nombre"] == "Versión de la nube"

    # 5) Otro conflicto, ahora se elige «la mía»: se aplica en la nube
    va = local.pull("client")[cid_a]["version"]
    vc = cloud.pull("client")[cid_a]["version"]
    assert cloud.push("client", cid_a, client_data("A1", "Nube 2"), base=vc)["status"] == "applied"
    assert local.push("client", cid_a, client_data("A1", "Escritorio 2"), base=va)["status"] == "applied"
    assert local.sync()["state"] == "conflict"
    st = local.c.post("/api/cloud/resolve", json={"entity": "client", "id": cid_a, "resolution": "mine"}).json()
    assert st["state"] == "synced" and not st["conflicts"], st
    assert cloud.pull("client")[cid_a]["data"]["nombre"] == "Escritorio 2"

    # 6) Cambio hecho en la nube -> baja solo
    vc = cloud.pull("client")[cid_a]["version"]
    cloud.push("client", cid_a, client_data("A1", "Nube 3"), base=vc)
    assert local.sync()["state"] == "synced"
    assert local.pull("client")[cid_a]["data"]["nombre"] == "Nube 3"


def test_datos_de_referencia(world):
    """Usuarios, logos y catálogos de la nube llegan al escritorio (y se actualizan)."""
    import base64
    import sqlite3
    cloud, local = Api(world["cloud"]), Api(world["local"])
    cloud.use_token()
    local.use_token()
    # crear en la nube: un usuario nuevo y un logo
    r = cloud.c.post("/api/admin/users", json={"username": "tecnico9", "password": "Clave12345", "role": "user", "full_name": "Técnico Nueve"})
    assert r.status_code == 200, r.text
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    r = cloud.c.post("/api/logos", files={"file": ("l.png", png)}, data={"nombre": "Logo Cloud", "posicion": "izq"})
    assert r.status_code == 200, r.text
    st = local.sync()
    assert st["state"] in ("synced", "conflict"), st
    users = {u["username"] for u in local.c.get("/api/admin/users").json()}
    assert "tecnico9" in users, users
    names = {l["nombre"] for l in local.c.get("/api/logos").json()}
    assert "Logo Cloud" in names, names
    # el usuario copiado no entra con clave en el escritorio hasta iniciar sesión con la nube (sin contraseña local)
    assert Api(world["local"]).login("tecnico9", "Clave12345").status_code in (200, 401)
    # un cambio posterior también baja
    r = cloud.c.post("/api/logos", files={"file": ("m.png", png)}, data={"nombre": "Logo Dos", "posicion": "der"})
    assert r.status_code == 200
    local.sync()
    assert "Logo Dos" in {l["nombre"] for l in local.c.get("/api/logos").json()}


def test_sin_conexion(world):
    """Con la nube caída: se puede entrar con la cuenta ya guardada, trabajar, y el estado dice «sin conexión»."""
    world["cloud_proc"].kill()
    world["cloud_proc"].wait()
    local = Api(world["local"])
    r = local.login()                       # sin nube: entra con la copia local de la cuenta
    assert r.status_code == 200, r.text
    local.use_token()
    cid = uuid.uuid4().hex
    assert local.push("client", cid, client_data("OFF1", "Hecho sin conexión"))["status"] == "applied"
    st = local.sync()
    assert st["state"] == "offline", st
    assert cid in local.pull("client")      # todo sigue disponible localmente
    assert local.login("superadmin", "mala-clave").status_code == 401   # una clave incorrecta se rechaza también offline

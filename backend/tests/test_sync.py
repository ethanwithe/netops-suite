"""Pruebas de la API de sincronización (SQLite local; en la nube es la misma lógica sobre PostgreSQL)."""
import hashlib
import uuid


def op(entity, eid, data, base=None, action="upsert", force=False, op_id=None):
    return {"op_id": op_id or str(uuid.uuid4()), "entity": entity, "entity_id": eid, "action": action,
            "base_version": base, "data": data, "force": force}


def push(c, *ops):
    r = c.post("/api/sync/push", json={"device_id": "test", "ops": list(ops)})
    assert r.status_code == 200, r.text
    return r.json()["results"]


def new_client(c, sot="9001"):
    cid = str(uuid.uuid4())
    res = push(c, op("client", cid, {"sot": sot, "nombre": "Cliente A", "datos": {"IP_GESTION": "10.0.0.1"}}))[0]
    assert res["status"] == "applied", res
    return cid, res


def test_create_is_idempotent(client):
    cid = str(uuid.uuid4())
    o = op("client", cid, {"sot": "9100", "nombre": "X"})
    a = push(client, o)[0]
    b = push(client, o)[0]           # el mismo op_id otra vez (reintento)
    assert a["status"] == "applied" and b.get("replayed") is True
    pull = client.get("/api/sync/pull", params={"entity": "client"}).json()
    assert sum(1 for i in pull["items"] if i["id"] == cid) == 1


def test_conflict_not_overwritten(client):
    cid, res = new_client(client, "9101")
    v = res["version"]
    ok = push(client, op("client", cid, {"sot": "9101", "nombre": "Editado en A"}, base=v))[0]
    assert ok["status"] == "applied" and ok["version"] == v + 1
    stale = push(client, op("client", cid, {"sot": "9101", "nombre": "Editado en B"}, base=v))[0]
    assert stale["status"] == "conflict" and stale["server"]["data"]["nombre"] == "Editado en A"
    got = client.get(f"/api/clients/by-sot/9101").json()
    assert got["nombre"] == "Editado en A"          # nada se pisó en silencio


def test_resolve_mine_and_theirs(client):
    cid, res = new_client(client, "9102")
    push(client, op("client", cid, {"sot": "9102", "nombre": "Servidor"}, base=res["version"]))
    mine = op("client", cid, {"sot": "9102", "nombre": "Mío"}, base=res["version"])
    assert push(client, mine)[0]["status"] == "conflict"
    r = client.post("/api/sync/resolve", json={"op": mine, "resolution": "mine"}).json()
    assert r["status"] == "applied"
    assert client.get("/api/clients/by-sot/9102").json()["nombre"] == "Mío"
    other = op("client", cid, {"sot": "9102", "nombre": "Otro"}, base=1)
    assert push(client, other)[0]["status"] == "conflict"
    t = client.post("/api/sync/resolve", json={"op": other, "resolution": "theirs"}).json()
    assert t["status"] == "adopted" and t["server"]["data"]["nombre"] == "Mío"


def test_duplicate_sot_is_conflict(client):
    new_client(client, "9103")
    res = push(client, op("client", str(uuid.uuid4()), {"sot": "9103", "nombre": "Duplicado"}))[0]
    assert res["status"] == "conflict" and res["reason"] == "duplicate_sot"


def test_workspace_roundtrip_and_shrink(client):
    cid, _ = new_client(client, "9104")
    wid = f"{cid}|foto:test"
    big = {"cells": ["x" * 100] * 40}
    r1 = push(client, op("workspace", wid, {"label": "Foto", "route": "/f", "state": big}))[0]
    assert r1["status"] == "applied", r1
    r2 = push(client, op("workspace", wid, {"state": {"cells": []}}, base=r1["version"]))[0]
    assert r2["status"] == "conflict" and r2["reason"] == "shrink"       # no se vacía por accidente
    r3 = push(client, op("workspace", wid, {"state": {"cells": []}}, base=r1["version"], force=True))[0]
    assert r3["status"] == "applied"
    assert len(client.get("/api/clients/workspace-versions", params={"sot": "9104", "key": "foto:test"}).json()) >= 1


def test_pull_pagination_and_changes(client):
    for i in range(5):
        new_client(client, f"92{i:02d}")
    seen, cursor = set(), ""
    for _ in range(20):
        r = client.get("/api/sync/pull", params={"entity": "client", "limit": 2, "cursor": cursor}).json()
        seen |= {i["id"] for i in r["items"]}
        cursor = r["next_cursor"]
        if not cursor:
            break
    assert len(seen) >= 5
    ch = client.get("/api/sync/changes", params={"since": "2000-01-01T00:00:00Z"}).json()
    assert ch["counts"]["client"] >= 5 and ch["total"] >= 5


def test_invalid_ops_are_rejected_not_crashing(client):
    res = push(client, op("client", "bad id!", {"sot": "9300"}), op("nada", "x" * 10, {}))
    assert [r["status"] for r in res] == ["rejected", "rejected"]


def test_photo_upload_idempotent_and_verified(client):
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001")
    pid = str(uuid.uuid4())
    files = {"file": ("a.png", png, "image/png")}
    r = client.post("/api/sync/photos", files=files, data={"photo_id": pid, "sha256": hashlib.sha256(png).hexdigest()})
    assert r.status_code == 200 and r.json()["duplicate"] is False
    r2 = client.post("/api/sync/photos", files={"file": ("a.png", png, "image/png")}, data={"photo_id": pid})
    assert r2.json()["duplicate"] is True and r2.json()["path"] == r.json()["path"]
    bad = client.post("/api/sync/photos", files={"file": ("b.png", png, "image/png")}, data={"photo_id": str(uuid.uuid4()), "sha256": "0" * 64})
    assert bad.status_code == 422
    assert client.get(f"/api/sync/photos/{pid}").json()["sha256"] == hashlib.sha256(png).hexdigest()


def test_requires_login():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as anon:
        assert anon.post("/api/sync/push", json={"ops": []}).status_code == 401


def test_reportes_union_and_outputs(client):
    cid = str(uuid.uuid4())
    r = push(client, op("client", cid, {"sot": "9400", "nombre": "R", "reportes": [{"tipo": "grafica", "nombre": "G", "filename": "g1.pdf", "url": "/api/files/outputs/g1.pdf"}]}))[0]
    assert r["status"] == "applied"
    r2 = push(client, op("client", cid, {"sot": "9400", "nombre": "R", "reportes": [{"tipo": "checklist", "nombre": "C", "filename": "c1.pdf"}]}, base=r["version"]))[0]
    assert r2["status"] == "applied"
    got = client.get("/api/clients/by-sot/9400").json()
    assert sorted(x["filename"] for x in got["reportes"]) == ["c1.pdf", "g1.pdf"]
    up = client.post("/api/sync/outputs", files={"file": ("x.pdf", b"%PDF-1.4 test", "application/pdf")}, data={"name": "Prueba offline.pdf"})
    assert up.status_code == 200 and up.json()["size"] == 13
    assert client.get("/api/files/outputs/Prueba%20offline.pdf").content == b"%PDF-1.4 test"
    assert client.post("/api/sync/outputs", files={"file": ("x", b"1", "a/b")}, data={"name": "../x"}).status_code == 400

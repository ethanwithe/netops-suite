"""Marcas de Gráfica creadas por el superadmin, nombres editables y diseño base con los campos de arriba."""


def test_marcas_y_nombres(client):
    lay = client.get("/api/diagrams/options/layout").json()
    assert lay["groups"] == [] or isinstance(lay["groups"], list)

    # crear una marca nueva (al mismo nivel que Cisco/Huawei/Fortinet)
    r = client.post("/api/diagrams/options/groups", json={"label": "Mikrotik"})
    assert r.status_code == 200, r.text
    gid = r.json()["groups"][-1]["id"]
    assert "-" not in gid and r.json()["groups"][-1]["label"] == "Mikrotik"

    # renombrar una marca de fábrica, una opción de fábrica y la marca nueva
    assert client.put("/api/diagrams/options/labels", json={"id": "cisco", "label": "Cisco Systems"}).status_code == 200
    assert client.put("/api/diagrams/options/labels", json={"id": "cisco-fibra", "label": "Fibra dedicada"}).status_code == 200
    r = client.put("/api/diagrams/options/labels", json={"id": gid, "label": "MikroTik RouterOS"})
    lay = r.json()
    assert lay["labels"]["cisco"] == "Cisco Systems" and lay["labels"]["cisco-fibra"] == "Fibra dedicada"
    assert [g["label"] for g in lay["groups"] if g["id"] == gid] == ["MikroTik RouterOS"]
    assert client.put("/api/diagrams/options/labels", json={"id": "cisco", "label": "  "}).status_code == 400
    assert client.put("/api/diagrams/options/labels", json={"id": "nada-inexistente", "label": "X"}).status_code == 404

    # la marca nueva acepta opciones propias, que también se pueden renombrar
    doc = {"w": 100, "h": 100, "elements": [], "fieldGroups": [{"title": "DATOS", "fields": [{"key": "sot", "label": "SOT"}]}]}
    r = client.post("/api/diagrams/options", json={"grupo": gid, "nombre": "Radio enlace", "doc": doc})
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    assert client.put("/api/diagrams/options/labels", json={"id": oid, "label": "Radio enlace PtP"}).status_code == 200
    assert next(o for o in client.get("/api/diagrams/options").json() if o["id"] == oid)["nombre"] == "Radio enlace PtP"

    # el diseño base conserva los campos de arriba (fieldGroups) junto al lienzo
    assert client.post(f"/api/diagrams/options/{oid}/base", json={"doc": {**doc, "fieldGroups": [{"title": "NUEVO", "fields": []}]}}).status_code == 200
    got = client.get(f"/api/diagrams/options/{oid}").json()
    assert got["base"]["fieldGroups"][0]["title"] == "NUEVO" and got["published"]["fieldGroups"][0]["title"] == "NUEVO"

    # borrar la marca borra sus opciones
    r = client.delete(f"/api/diagrams/options/groups/{gid}")
    assert r.status_code == 200 and not [g for g in r.json()["groups"] if g["id"] == gid]
    assert not [o for o in client.get("/api/diagrams/options").json() if o["grupo"] == gid]
    assert client.delete("/api/diagrams/options/groups/cisco").status_code == 404

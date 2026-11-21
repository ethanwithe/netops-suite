import os

from app.services.gen_local import Work, package_zip


def test_package_zip_is_deterministic(tmp_path):
    w1, w2 = Work(str(tmp_path / "a")), Work(str(tmp_path / "b"))
    for w in (w1, w2):
        open(os.path.join(w.uploads, "f1.jpg"), "wb").write(b"\xff\xd8fake1")
        open(os.path.join(w.outputs, "RF.pdf"), "wb").write(b"%PDF-fake")
    client = {"sot": "7001", "nombre": "Cliente", "cid": "C", "fecha": "2026-11-21", "proy": "", "contrata": "", "datos": {"IP": "1.1.1.1"}}
    reps = [{"tipo": "foto", "nombre": "RF", "filename": "RF.pdf"}]
    wss = [{"key": "foto:x", "label": "Fotos · Site", "state": {"extras": [{"path": "f1.jpg", "nombre": "Rack", "lado": "site"}]}}]
    a = package_zip(client, reps, wss, 1, w1)
    b = package_zip(client, reps, wss, 1, w2)
    assert a["counts"] == {"pdf": 1, "checklist": 0, "graficas": 0, "fotos": 1}
    assert open(a["path"], "rb").read() == open(b["path"], "rb").read()

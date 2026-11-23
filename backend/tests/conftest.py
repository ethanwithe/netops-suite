import os
import sys
import tempfile
from pathlib import Path

# Base SQLite temporal: las pruebas no tocan ninguna base real.
_tmp = tempfile.mkdtemp(prefix="netops-test-")
os.environ.pop("DATABASE_URL", None)
os.environ["NETOPS_DATA_DIR"] = _tmp
os.environ.setdefault("TELEGRAM_API_ID", "")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from app.main import app
    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={"username": "superadmin", "password": "superadmin123"}, headers={"x-client": "native"})
        assert r.status_code == 200, r.text
        assert r.json().get("token")
        c.headers.update({"Authorization": "Bearer " + r.json()["token"]})
        yield c

"""El paquete de generadores debe funcionar SOLO con lo que trae (sin FastAPI ni base de datos): es lo que corre en el teléfono."""
import subprocess
import sys
import textwrap
import zipfile
import io


def test_bundle_runs_standalone(tmp_path, client):
    r = client.get("/api/gen/bundle")
    assert r.status_code == 200 and r.headers["etag"]
    assert client.get("/api/gen/bundle", headers={"If-None-Match": r.headers["etag"]}).status_code == 304
    zipfile.ZipFile(io.BytesIO(r.content)).extractall(tmp_path)
    code = textwrap.dedent(f'''
        import sys
        for m in ("sqlalchemy", "fastapi", "pydantic", "app.models", "app.database", "app.config", "app.services.filestore"):
            sys.modules[m] = None          # cualquier import de esto rompería: el paquete no debe necesitarlo
        sys.path.insert(0, {str(tmp_path)!r})
        from app.services import gen_local, zip_plans, diagram_pdf, diagram_pptx, pdf_checklist, docx_checklist, pdf_poder_judicial, pdf_photo_report, report_project
        w = gen_local.Work({str(tmp_path / "w")!r})
        out = gen_local.checklist_pdf({{"sot": "1", "cliente": "X", "sections": [{{"titulo": "A", "items": [{{"nombre": "n", "modo": "texto", "texto": "ok", "cmd": "", "images": []}}]}}]}}, w)
        assert out["pages"] == 1, out
        pdf = gen_local.diagram_pdf({{"doc": {{"w": 1920, "h": 1080, "elements": [{{"type": "text", "x": 10, "y": 10, "w": 300, "h": 50, "text": "hola", "size": 20}}]}}}}, w)
        assert pdf[:4] == b"%PDF"
        print("STANDALONE-OK")
    ''')
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(tmp_path))
    assert "STANDALONE-OK" in res.stdout, res.stderr[-2000:]

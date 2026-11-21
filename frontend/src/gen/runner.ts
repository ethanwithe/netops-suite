/** Código Python que corre dentro de Pyodide (en el worker): une la carpeta de trabajo con gen_local. */
export const RUNNER = `
import json, os, shutil
from app.services import gen_local

WORK = "/work"

def _reset():
    shutil.rmtree(WORK, ignore_errors=True)
    for d in ("uploads", "outputs", "logos", "icons"):
        os.makedirs(os.path.join(WORK, d), exist_ok=True)

def _dir(name):
    out = {}
    d = os.path.join(WORK, name)
    for f in os.listdir(d):
        with open(os.path.join(d, f), "rb") as fh:
            out[f] = fh.read()
    return out

def run(kind, req_json):
    req = json.loads(req_json)
    w = gen_local.Work(WORK, logos=_dir("logos"), icons=_dir("icons"))
    if kind == "photo_report": r = gen_local.photo_report(req, w)
    elif kind == "pj_report": r = gen_local.pj_report(req, w)
    elif kind == "checklist_pdf": r = gen_local.checklist_pdf(req, w)
    elif kind == "checklist_docx": r = gen_local.checklist_docx(req, w)
    elif kind == "evidence_zip": r = gen_local.evidence_zip(req, w)
    elif kind == "package_zip":
        r = gen_local.package_zip(req["client"], req["reportes"], req["workspaces"], req["version"], w)
    elif kind in ("diagram_pdf", "diagram_pptx"):
        data = gen_local.diagram_pdf(req, w) if kind == "diagram_pdf" else gen_local.diagram_pptx(req, w)
        ext = "pdf" if kind == "diagram_pdf" else "pptx"
        name = "diagrama." + ext
        with open(os.path.join(w.outputs, name), "wb") as fh:
            fh.write(data)
        r = {"filename": name, "path": w.output(name), "pages": 1, "warnings": []}
    else:
        raise ValueError("Generador desconocido: " + kind)
    r = dict(r)
    r.pop("path", None)
    return json.dumps(r, ensure_ascii=False)
`;

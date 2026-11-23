// Ejecuta el generador real dentro de Pyodide (Python en WebAssembly): la misma versión que correrá offline en el navegador/app.
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import path from "node:path";

const [, , backendDir, outPdf, mode = "flat"] = process.argv;
const py = await loadPyodide();
await py.loadPackage(["pillow", "micropip"]);
await py.runPythonAsync(`import micropip\nawait micropip.install("reportlab==4.2.5")`);
py.FS.mkdirTree("/work");
py.mountNodeFS("/backend", path.resolve(backendDir));
py.mountNodeFS("/out", path.dirname(path.resolve(outPdf)));
const ver = await py.runPythonAsync(`import PIL, reportlab, sys\nf"python {sys.version.split()[0]} pillow {PIL.__version__} reportlab {reportlab.Version}"`);
console.log("Pyodide:", ver);
await py.runPythonAsync(`
import sys
sys.path.insert(0, "/backend/gen_spike")
import make_report
make_report.main("/backend", "/out/${path.basename(outPdf)}", "${mode}")
`);
console.log("generado", outPdf, fs.statSync(outPdf).size);

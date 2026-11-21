// Corre TODOS los generadores reales dentro de Pyodide (Python en WebAssembly).
import { loadPyodide } from "pyodide";
import path from "node:path";

const [, , backendDir, outDir] = process.argv;
const py = await loadPyodide();
await py.loadPackage(["pillow", "lxml", "micropip"]);
await py.runPythonAsync(`import micropip
await micropip.install(["reportlab==4.2.5", "python-pptx==1.0.2", "python-docx==1.1.2", "pypdf==5.9.0"])`);
py.mountNodeFS("/backend", path.resolve(backendDir));
py.mountNodeFS("/out", path.resolve(outDir));
await py.runPythonAsync(`
import sys
sys.path.insert(0, "/backend/gen_spike")
import cases
cases.main("/backend", "/out")
`);

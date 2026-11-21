// Simula lo que hace el worker de la app (frontend/src/gen/worker.ts): Pyodide con los archivos LOCALES de public/pyodide,
// librerías instaladas desde esos archivos (sin Internet), paquete /api/gen/bundle y el RUNNER real (frontend/src/gen/runner.ts).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [, , publicDir, bundleZip, workDir, outDir] = process.argv;
const base = path.resolve(publicDir, "pyodide");
const { loadPyodide } = await import(pathToFileURL(path.join(base, "pyodide.mjs")).href);
const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
const py = await loadPyodide({ indexURL: base + "/" });
await py.loadPackage(manifest.packages);
py.mountNodeFS("/wheels", path.join(base, "wheels"));
const mp = py.pyimport("micropip");
await mp.install(manifest.wheels.map((f) => `emfs:/wheels/${f}`), { deps: false });
py.FS.mkdirTree("/pkg");
py.unpackArchive(fs.readFileSync(bundleZip), "zip", { extractDir: "/pkg" });
py.runPython(`import sys\nsys.path.insert(0, "/pkg")`);
const src = fs.readFileSync("frontend/src/gen/runner.ts", "utf8");
py.runPython(src.slice(src.indexOf("`") + 1, src.lastIndexOf("`")));

const reqs = JSON.parse(fs.readFileSync(path.join(workDir, "requests.json"), "utf8"));
fs.mkdirSync(outDir, { recursive: true });
for (const { kind, req } of reqs) {
  py.runPython("_reset()");
  for (const f of fs.readdirSync(path.join(workDir, "uploads_in"))) py.FS.writeFile(`/work/uploads/${f}`, fs.readFileSync(path.join(workDir, "uploads_in", f)));
  for (const f of fs.readdirSync(path.join(workDir, "icons_in"))) py.FS.writeFile(`/work/icons/${f}`, fs.readFileSync(path.join(workDir, "icons_in", f)));
  const meta = JSON.parse(py.globals.get("run")(kind, JSON.stringify(req)));
  for (const f of py.FS.readdir("/work/outputs")) {
    if (f.startsWith(".")) continue;
    fs.writeFileSync(path.join(outDir, f), py.FS.readFile(`/work/outputs/${f}`));
  }
  console.log(kind, "→", meta.filename);
}

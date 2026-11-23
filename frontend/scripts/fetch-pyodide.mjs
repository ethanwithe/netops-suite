// Descarga Pyodide (Python en WebAssembly) y las librerías de los generadores a public/pyodide/, para que la app
// (web, Windows, Android) los lleve consigo y funcione sin Internet. Se ejecuta antes de «npm run build».
import fs from "node:fs";
import path from "node:path";

// La app de escritorio genera con el Python del propio programa: no necesita Pyodide.
if (process.env.VITE_DESKTOP) { console.log("Pyodide omitido (VITE_DESKTOP)."); process.exit(0); }

const VERSION = "0.26.4";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const OUT = path.resolve("public/pyodide");
const CORE = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
const FROM_PYODIDE = ["pillow", "lxml", "micropip", "typing-extensions"];
const PYPI = [["reportlab", "4.2.5"], ["chardet", "5.2.0"], ["python-pptx", "1.0.2"], ["XlsxWriter", "3.2.0"], ["python-docx", "1.1.2"], ["pypdf", "5.9.0"]];

async function get(url, retries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}
async function save(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await get(url));
  console.log("  +", path.relative(OUT, file));
}

const done = path.join(OUT, "manifest.json");
if (fs.existsSync(done) && JSON.parse(fs.readFileSync(done, "utf8")).version === VERSION && !process.argv.includes("--force")) {
  console.log("Pyodide ya está en public/pyodide");
  process.exit(0);
}
console.log(`Descargando Pyodide ${VERSION}…`);
for (const f of CORE) await save(CDN + f, path.join(OUT, f));

const lock = JSON.parse(fs.readFileSync(path.join(OUT, "pyodide-lock.json"), "utf8"));
const need = new Set();
const visit = (n) => {
  const k = n.toLowerCase().replace(/_/g, "-");
  if (need.has(k)) return;
  const p = lock.packages[k];
  if (!p) throw new Error("Paquete no está en Pyodide: " + n);
  need.add(k);
  (p.depends || []).forEach(visit);
};
FROM_PYODIDE.forEach(visit);
const pkgs = [];
for (const k of need) {
  const p = lock.packages[k];
  await save(CDN + p.file_name, path.join(OUT, p.file_name));
  pkgs.push(k);
}
const wheels = [];
for (const [name, ver] of PYPI) {
  const meta = JSON.parse((await get(`https://pypi.org/pypi/${name}/${ver}/json`)).toString());
  const f = meta.urls.find((u) => u.packagetype === "bdist_wheel" && u.filename.endsWith("-none-any.whl"));
  if (!f) throw new Error(`Sin wheel puro para ${name} ${ver}`);
  await save(f.url, path.join(OUT, "wheels", f.filename));
  wheels.push(f.filename);
}
fs.writeFileSync(done, JSON.stringify({ version: VERSION, packages: pkgs, wheels }, null, 1));
console.log("Listo:", pkgs.length, "paquetes de Pyodide y", wheels.length, "librerías Python");

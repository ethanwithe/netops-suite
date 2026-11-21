/// <reference lib="webworker" />
/**
 * Worker que ejecuta los generadores REALES (los mismos archivos Python del servidor) con Pyodide, dentro del equipo.
 * Mensajes: init {bundle} → listo; run {kind, req, files:{uploads,logos,icons}} → {meta, outputs}.
 */
import { RUNNER } from "./runner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Py = any;
let py: Py = null;
let version = "";

async function init(bundle: ArrayBuffer, bundleVersion: string) {
  if (py && version === bundleVersion) return;
  const base = "/pyodide/";
  const { loadPyodide } = await import(/* @vite-ignore */ base + "pyodide.mjs");
  const manifest = await (await fetch(base + "manifest.json")).json();
  if (!py) {
    py = await loadPyodide({ indexURL: base });
    await py.loadPackage(manifest.packages, { checkIntegrity: false });
    const mp = py.pyimport("micropip");
    const urls = manifest.wheels.map((f: string) => new URL(`${base}wheels/${f}`, self.location.origin).href);
    await mp.install(urls, { deps: false });
  }
  py.FS.mkdirTree("/pkg");
  py.unpackArchive(bundle, "zip", { extractDir: "/pkg" });
  py.runPython(`import sys\nif "/pkg" not in sys.path: sys.path.insert(0, "/pkg")\nimport importlib\nfor m in [k for k in list(sys.modules) if k == "app" or k.startswith("app.")]: del sys.modules[m]`);
  py.runPython(RUNNER);
  version = bundleVersion;
}

function put(dir: string, files: Record<string, Uint8Array>) {
  for (const [n, data] of Object.entries(files)) py.FS.writeFile(`/work/${dir}/${n.replace(/[\\/]/g, "_")}`, data);
}

async function run(kind: string, req: unknown, files: { uploads: Record<string, Uint8Array>; logos: Record<string, Uint8Array>; icons: Record<string, Uint8Array> }, outputs: Record<string, Uint8Array>) {
  py.runPython("_reset()");
  put("uploads", files.uploads); put("logos", files.logos); put("icons", files.icons); put("outputs", outputs);
  const fn = py.globals.get("run");
  const meta = JSON.parse(fn(kind, JSON.stringify(req)));
  fn.destroy?.();
  const out: Record<string, Uint8Array> = {};
  for (const f of py.FS.readdir("/work/outputs") as string[]) {
    if (f === "." || f === ".." || f.startsWith(".")) continue;
    out[f] = py.FS.readFile(`/work/outputs/${f}`);
  }
  return { meta, outputs: out };
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, op } = ev.data;
  try {
    if (op === "init") { await init(ev.data.bundle, ev.data.version); (self as unknown as Worker).postMessage({ id, ok: true }); }
    else if (op === "run") {
      const r = await run(ev.data.kind, ev.data.req, ev.data.files, ev.data.outputs || {});
      const transfer = Object.values(r.outputs).map((u) => u.buffer);
      (self as unknown as Worker).postMessage({ id, ok: true, ...r }, transfer);
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((e as Error)?.message || e) });
  }
};

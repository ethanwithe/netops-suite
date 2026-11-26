/**
 * Guardado de archivos generados (PDF, ZIP, Word, PowerPoint, TXT):
 *  - donde el navegador lo permite se pregunta en qué carpeta y con qué nombre guardar;
 *  - si no, se descarga normal; en ambos casos aparece un aviso («Guardado», «Descargando», «Cancelado» o error).
 * `installDownloadGuard()` hace que todos los enlaces/botones de descarga de la app pasen por aquí.
 */

type Picker = (o: { suggestedName?: string; startIn?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  name: string; getFile?: () => Promise<File>; createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

const MIME: Record<string, string> = {
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain", csv: "text/csv", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  py: "text/x-python", png: "image/png", jpg: "image/jpeg",
};

// ---------------------------------------------------------------- aviso en pantalla
let box: HTMLDivElement | null = null;
let timer = 0;
function toast(msg: string, kind: "ok" | "info" | "error" = "info", action?: { label: string; run: () => void }, ms = 5000) {
  if (!box) {
    box = document.createElement("div");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.style.cssText = "position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:100000;max-width:min(92vw,460px);";
    document.body.appendChild(box);
  }
  window.clearTimeout(timer);
  const color = kind === "ok" ? "#15803d" : kind === "error" ? "#b91c1c" : "#1e293b";
  box.innerHTML = "";
  const card = document.createElement("div");
  card.style.cssText = `background:${color};color:#fff;border-radius:12px;padding:10px 14px;font:500 13px/1.35 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center;`;
  const t = document.createElement("span");
  t.textContent = msg;
  card.appendChild(t);
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.style.cssText = "background:#fff;color:#111;border:0;border-radius:8px;padding:5px 10px;font-weight:700;cursor:pointer;white-space:nowrap;";
    b.onclick = () => { box!.innerHTML = ""; action.run(); };
    card.appendChild(b);
  }
  box.appendChild(card);
  timer = window.setTimeout(() => { if (box) box.innerHTML = ""; }, ms);
}
export const notify = toast;

// ---------------------------------------------------------------- guardado
function plainDownload(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.dataset.direct = "1";
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

async function viaPicker(blob: Blob, name: string): Promise<"saved" | "cancelled"> {
  const pick = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker!;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const types = MIME[ext] ? [{ description: ext.toUpperCase(), accept: { [MIME[ext]]: ["." + ext] } }] : undefined;
  try {
    // startIn «downloads»: el selector abre en Descargas y no en una carpeta protegida del sistema
    const h = await pick({ suggestedName: name, types, startIn: "downloads" }).catch((e) => {
      if ((e as DOMException)?.name === "AbortError") throw e;
      return pick({ suggestedName: name });          // algunos navegadores rechazan «types»/«startIn»
    });
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    // Se comprueba lo que quedó escrito: si el visor integrado del programa no escribió bien, se descarga por el método normal.
    try {
      const f = await (h as unknown as { getFile: () => Promise<File> }).getFile();
      if (f.size !== blob.size) throw new Error("tamaño distinto");
    } catch { plainDownload(blob, name); toast(`Descargado: ${name} (carpeta Descargas)`, "ok"); return "saved"; }
    toast(`Guardado: ${h.name}`, "ok");
    return "saved";
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") { toast("Descarga cancelada: el archivo no se guardó.", "info"); return "cancelled"; }
    throw e;
  }
}

/** Nombre válido en Windows/Android: sin símbolos raros, sin punto/espacio al final, largo razonable y siempre con extensión. */
export function safeName(filename: string): string {
  const raw = (filename || "archivo").normalize("NFC").replace(/[\u0000-\u001f\\/:*?"<>|%#&{}$!'`@+=~^;,\[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const dot = raw.lastIndexOf(".");
  let base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 6) : "";
  base = base.replace(/[. ]+$/g, "").slice(0, 100).trim() || "archivo";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base += " 1";
  return ext ? `${base}.${ext}` : base;
}

export async function saveFile(source: string | Blob, filename: string): Promise<void> {
  const name = safeName(filename);
  let blob: Blob;
  try {
    if (typeof source === "string") {
      const r = await fetch(source, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      blob = await r.blob();
      if (blob.size === 0) {            // respuesta vacía (caché o corte): se pide de nuevo sin caché
        const r2 = await fetch(source, { credentials: "include", cache: "no-store" });
        if (!r2.ok) throw new Error(String(r2.status));
        blob = await r2.blob();
      }
    } else blob = source;
    if (blob.size === 0) throw new Error("vacío");
  } catch {
    toast(`No se pudo descargar «${name}». Revisa la conexión e inténtalo otra vez.`, "error", undefined, 7000);
    return;
  }
  const canPick = typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
  if (canPick) {
    try { await viaPicker(blob, name); return; }
    catch {
      // sin un toque reciente el navegador no deja abrir el selector: se ofrece un botón para elegir dónde guardar
      toast(`«${name}» está listo.`, "info", { label: "Guardar como…", run: () => { void viaPicker(blob, name).catch(() => { plainDownload(blob, name); toast(`Descargado: ${name} (carpeta Descargas)`, "ok"); }); } }, 15_000);
      return;
    }
  }
  plainDownload(blob, name);
  toast(`Descargado: ${name}. Búscalo en tu carpeta de Descargas.`, "ok");
}

/** Todos los enlaces con `download` (y los que se crean por código) pasan por saveFile. */
export function installDownloadGuard(): void {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[download]") as HTMLAnchorElement | null;
    if (!a || a.dataset.direct || !a.href) return;
    let u: URL;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin && u.protocol !== "blob:" && u.protocol !== "data:") return;
    e.preventDefault();
    e.stopPropagation();
    const fromUrl = decodeURIComponent(u.pathname.split("/").pop() || "");
    void saveFile(a.href, a.getAttribute("download") || fromUrl || "archivo");
  }, true);
}

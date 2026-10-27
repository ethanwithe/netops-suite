/**
 * Reduce la foto ANTES de subirla: una foto de celular pesa 4–10 MB; a 2000 px
 * y JPEG 85 % pesa ~0,4–0,8 MB, se sube mucho más rápido y entra en los
 * límites de tamaño de Vercel (4,5 MB por petición). Para un PDF es más que
 * suficiente.
 */

const MAX_SIDE = 2000;
const QUALITY = 0.85;
const SKIP_BELOW = 450 * 1024; // lo que ya es liviano se sube tal cual

export async function compressForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));

    if (k === 1 && (file.size <= SKIP_BELOW || (file.type === "image/jpeg" && file.size <= 1.5 * 1024 * 1024))) {
      bmp.close();
      return file;
    }

    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return file;
    }
    ctx.fillStyle = "#fff"; // PNG con transparencia -> fondo blanco
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file; // no empeorar

    const base = (file.name || "foto").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file; // si el navegador no puede, se sube la original
  }
}

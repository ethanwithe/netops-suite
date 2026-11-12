import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { compressForUpload } from "../utils/imageCompress";
import CameraCapture from "./CameraCapture";
import { getPlaceFast, stampImage, stampLines } from "../utils/photoStamp";
import type { Place } from "../utils/photoStamp";

interface Props {
  onUploaded: (path: string, url: string) => void;
  label?: string;
  compact?: boolean;
  initialUrl?: string;
  /** Cliente que se imprime en el sello de las fotos tomadas con la cámara. */
  cliente?: string;
  /** Muestra el botón «Tomar foto» (cámara con fecha, hora y ubicación). */
  camera?: boolean;
  /** Permite elegir varias fotos a la vez (se suben una tras otra). */
  multiple?: boolean;
  /** Foto de cámara: llega además la foto sin sello y las líneas del sello (para poder moverlo después). */
  onStampRaw?: (raw: { path: string; url: string }, lines: string[]) => void;
  /** Una foto de la cámara (ya subida) se quitó desde el visor de la cámara. */
  onDiscard?: (path: string, mode: "trash" | "delete") => void;
}

export default function ImageUpload({ onUploaded, label = "Subir imagen...", compact = false, initialUrl, cliente = "", camera = true, multiple = false, onStampRaw, onDiscard }: Props) {
  const [preview, setPreview] = useState<string | null>(initialUrl || null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<string | null>(null);

  // Si quien nos usa cambia la imagen (p. ej. al guardar la versión editada
  // con líneas/texto), la vista previa debe mostrar la nueva, no la anterior.
  useEffect(() => {
    setPreview(initialUrl || null);
  }, [initialUrl]);

  // Libera la URL temporal de la última vista previa al desmontar.
  useEffect(() => {
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  async function handleFile(file: File): Promise<string | undefined> {
    if (!file.type.startsWith("image/")) return;

    const previous = preview;
    const blobUrl = URL.createObjectURL(file);
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = blobUrl;

    setLoading(true);
    setPreview(blobUrl);

    try {
      const form = new FormData();
      form.append("file", await compressForUpload(file));
      const { data } = await api.post("/files/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(data.path, data.url);
      return data.path as string;
    } catch {
      // No se subió: se vuelve a la imagen anterior para no mostrar una foto
      // que en realidad no está en el servidor (y no saldría en el PDF).
      setPreview(previous);
      alert("No se pudo subir la imagen. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  /** Foto de la cámara: se le imprime cliente, fecha/hora, dirección y coordenadas. */
  // Las fotos de la cámara se procesan una por una (sello + subida) para que no se mezclen entre sí.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const paths = useRef(new Map<File, string>());
  const pending = useRef(new Map<File, "trash" | "delete">());
  function discardShot(file: File, mode: "trash" | "delete") {
    const p = paths.current.get(file);
    if (p) { paths.current.delete(file); onDiscard?.(p, mode); } else pending.current.set(file, mode);
  }
  function handleCamera(file: File, known?: Place | null) {
    const when = new Date();
    const lines0 = known !== undefined ? stampLines(cliente, known, when) : null;   // el texto se fija al disparar
    queue.current = queue.current.then(() => processCamera(file, known, when, lines0)).catch(() => undefined);
    return queue.current;
  }
  async function processCamera(file: File, known: Place | null | undefined, when: Date, lines0: string[] | null) {
    if (!file.type.startsWith("image/")) return;
    setStamping(true);
    // Vista previa inmediata con la foto recién tomada; el sello y la subida siguen por detrás.
    const quick = URL.createObjectURL(file);
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = quick;
    setPreview(quick);
    try {
      const place = known !== undefined ? known : await getPlaceFast();
      const lines = lines0 ?? stampLines(cliente, place, when);
      const stamped = await stampImage(file, lines);
      setStamping(false);
      // la foto limpia (sin sello) sube a la vez que la sellada
      const rawUp = onStampRaw
        ? (async () => {
            const form = new FormData();
            form.append("file", await compressForUpload(file));
            const { data } = await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
            return { path: data.path as string, url: data.url as string };
          })().catch(() => null)
        : null;
      const up = await handleFile(stamped);
      if (rawUp && onStampRaw) {
        const raw = await rawUp;   // sin la foto limpia no se podrá mover el sello, pero la foto ya quedó
        if (raw) onStampRaw(raw, lines);
      }
      if (up) {
        paths.current.set(file, up);
        const mode = pending.current.get(file);   // la quitaron desde el visor de la cámara antes de que terminara de subir
        if (mode) { pending.current.delete(file); onDiscard?.(up, mode); }
      }
    } catch {
      setStamping(false);
      await handleFile(file); // si falla el sello, se sube la foto tal cual
    }
  }

  function clear() {
    setPreview(null);
    onUploaded("", "");
    if (inputRef.current) inputRef.current.value = "";
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) handleFile(file);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      className={`flex items-center gap-2 ${compact ? "" : "flex-col items-start"}`}
      onPaste={handlePaste}
      tabIndex={0}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2">
        <div
          className={`rounded-lg border-2 border-dashed flex items-center justify-center overflow-hidden bg-slate-50 transition-colors ${
            dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300"
          } ${compact ? "w-12 h-12" : "w-20 h-20"}`}
          title="Puedes pegar (Ctrl+V) o arrastrar una imagen aquí"
        >
          {preview ? (
            <img src={preview} alt="" className="object-cover w-full h-full" />
          ) : (
            <span className="text-slate-300 text-[10px] text-center px-1">arrastra o pega</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="btn-secondary cursor-pointer text-xs">
            {loading ? "Subiendo..." : label}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple={multiple}
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                // permite volver a elegir el mismo archivo después
                e.target.value = "";
                void (async () => { for (const f of multiple ? list : list.slice(0, 1)) await handleFile(f); })();
              }}
            />
          </label>
          {camera && (
            <>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={stamping || loading}
                onClick={() => setCameraOpen(true)}
                title="Toma la foto y le agrega fecha, hora, dirección y coordenadas"
              >
                {stamping ? "Ubicando..." : "Tomar foto"}
              </button>
              {/* Plan B: la cámara del propio teléfono */}
              <input
                ref={nativeRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleCamera(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {preview && (
            <button type="button" onClick={clear} className="text-xs text-red-500 hover:underline">
              quitar
            </button>
          )}
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          cliente={cliente}
          multi={multiple}
          onDiscard={discardShot}
          onCapture={(f, place) => {
            if (!multiple) setCameraOpen(false);
            void handleCamera(f, place);
          }}
          onNative={() => {
            setCameraOpen(false);
            nativeRef.current?.click();
          }}
        />
      )}
    </div>
  );
}

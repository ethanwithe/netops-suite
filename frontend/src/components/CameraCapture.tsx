import { useCallback, useEffect, useRef, useState } from "react";
import {
  STAMP_ARROW,
  STAMP_ORDER,
  getStampPos,
  prefetchPlace,
  setStampPos,
  stampLines,
  watchPlace,
} from "../utils/photoStamp";
import type { Place, StampPos } from "../utils/photoStamp";

/**
 * Cámara propia (pantalla completa) pensada para fotos de equipos:
 *  - enfoque continuo y toque en pantalla para volver a enfocar,
 *  - foto de máxima resolución (ImageCapture.takePhoto cuando existe),
 *  - linterna para gabinetes oscuros.
 * Lo que enfoque realmente depende del teléfono; si no te sirve, hay un
 * botón para usar la cámara del propio teléfono.
 */

type FocusCaps = MediaTrackCapabilities & {
  focusMode?: string[];
  torch?: boolean;
};

interface Props {
  /** Cliente que se imprime en el sello. */
  cliente?: string;
  /** Recibe la foto y la ubicación que se veía en pantalla al disparar. */
  onCapture: (file: File, place: Place | null) => void;
  onClose: () => void;
  /** Abre la cámara nativa del teléfono (plan B). */
  onNative: () => void;
}

export default function CameraCapture({ cliente = "", onCapture, onClose, onNative }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const capsRef = useRef<FocusCaps>({});

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);

  // Vista previa en vivo del sello (para ver si taparía la serie del equipo)
  const [place, setPlace] = useState<Place | null>(null);
  const placeRef = useRef<Place | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [pos, setPos] = useState<StampPos>(() => getStampPos());
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    prefetchPlace(); // ubicación y dirección se buscan mientras apuntas

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara aquí (se necesita https).");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 4032 },
            height: { ideal: 3024 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;

        const caps = (track.getCapabilities?.() ?? {}) as FocusCaps;
        capsRef.current = caps;
        setHasTorch(!!caps.torch);

        // Enfoque continuo: la cámara sigue enfocando mientras apuntas.
        if (caps.focusMode?.includes("continuous")) {
          await track
            .applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
            .catch(() => undefined);
        }

        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "No diste permiso para usar la cámara. Actívalo en los permisos del navegador."
            : "No se pudo abrir la cámara."
        );
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  // Coordenadas en tiempo real
  useEffect(() => {
    return watchPlace((p) => {
      placeRef.current = p;
      setPlace(p);
    });
  }, []);

  // Reloj del sello
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Zona que ocupa realmente el video dentro de la pantalla (el sello se dibuja encima)
  useEffect(() => {
    const area = areaRef.current;
    const video = videoRef.current;
    if (!area || !video) return;
    const measure = () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      const cw = video.clientWidth, ch = video.clientHeight;
      if (!cw || !ch) return;
      const k = Math.min(cw / vw, ch / vh);
      const w = vw * k, h = vh * k;
      setBox({ x: video.offsetLeft + (cw - w) / 2, y: video.offsetTop + (ch - h) / 2, w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    ro.observe(video);
    video.addEventListener("loadedmetadata", measure);
    video.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("resize", measure);
    };
  }, [ready]);

  function cyclePos() {
    const next = STAMP_ORDER[(STAMP_ORDER.indexOf(pos) + 1) % STAMP_ORDER.length];
    setPos(next);
    setStampPos(next);
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      /* el teléfono no la deja encender */
    }
  }

  /** Toque en pantalla: fuerza un nuevo enfoque y vuelve al continuo. */
  async function refocus(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setRing({ x, y });
    window.setTimeout(() => setRing(null), 900);

    const track = trackRef.current;
    const modes = capsRef.current.focusMode ?? [];
    if (!track) return;
    try {
      const point = { x: x / rect.width, y: y / rect.height };
      if (modes.includes("single-shot")) {
        await track.applyConstraints({
          advanced: [{ focusMode: "single-shot", pointsOfInterest: [point] } as MediaTrackConstraintSet],
        });
        window.setTimeout(() => {
          if (modes.includes("continuous")) {
            track
              .applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
              .catch(() => undefined);
          }
        }, 1200);
      }
    } catch {
      /* sin control de enfoque: la cámara sigue en automático */
    }
  }

  async function shoot() {
    const track = trackRef.current;
    const video = videoRef.current;
    if (!track || !video || busy) return;
    setBusy(true);

    try {
      let blob: Blob | null = null;

      const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: (o?: object) => Promise<Blob> } }).ImageCapture;
      if (IC) {
        try {
          // Resolución por defecto del teléfono: nítida y mucho más rápida que pedir la máxima.
          blob = await new IC(track).takePhoto();
        } catch {
          blob = null; // se usa el cuadro de video
        }
      }

      if (!blob) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")?.drawImage(video, 0, 0);
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.95));
      }

      if (blob) {
        stop();
        onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" }), placeRef.current);
      } else {
        setError("No se pudo tomar la foto. Inténtalo otra vez.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="Cámara">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={onClose}>✕ Cerrar</button>
        <button
          className="rounded-lg px-3 py-2 text-sm hover:bg-white/10"
          onClick={cyclePos}
          title="Cambiar la esquina del sello para que no tape la serie del equipo"
        >
          {STAMP_ARROW[pos]} Mover sello
        </button>
        {hasTorch && (
          <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={toggleTorch}>
            {torch ? "🔦 Linterna: sí" : "🔦 Linterna: no"}
          </button>
        )}
      </div>

      <div ref={areaRef} className="relative flex-1 overflow-hidden" onClick={refocus}>
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        {box && ready && (
          <div
            className="pointer-events-none absolute overflow-hidden"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            aria-hidden="true"
          >
            <div
              className="absolute flex max-w-full flex-col"
              style={{
                [pos === "br" || pos === "bl" ? "bottom" : "top"]: Math.max(4, Math.min(box.w, box.h) * 0.015),
                [pos === "br" || pos === "tr" ? "right" : "left"]: Math.max(4, Math.min(box.w, box.h) * 0.015),
                alignItems: pos === "br" || pos === "tr" ? "flex-end" : "flex-start",
                textAlign: pos === "br" || pos === "tr" ? "right" : "left",
                fontFamily: '"Dancing Script", "Segoe Script", "Brush Script MT", cursive',
                fontWeight: 600,
                fontSize: Math.max(11, Math.min(box.w, box.h) * 0.05),
                lineHeight: 1.18,
                color: "#fff",
                textShadow: "1px 1px 3px rgba(0,0,0,0.95)",
              }}
            >
              {stampLines(cliente, place, now).map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          </div>
        )}
        {ring && (
          <span
            className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300"
            style={{ left: ring.x, top: ring.y }}
          />
        )}
        {!ready && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Abriendo cámara...</p>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
            <p>{error}</p>
            <button className="btn-secondary" onClick={onNative}>Usar la cámara del teléfono</button>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 px-4 pb-6 pt-3">
        <p className="text-[11px] text-white/60">El texto blanco es el sello tal como saldrá. Si tapa la serie, usa «Mover sello». Toca la pantalla para enfocar.</p>
        <div className="flex w-full items-center justify-between">
          <button className="w-28 text-left text-xs text-white/70 underline" onClick={onNative}>Cámara del teléfono</button>
          <button
            aria-label="Tomar foto"
            disabled={!ready || busy}
            onClick={shoot}
            className="h-16 w-16 rounded-full border-4 border-white bg-white/90 active:scale-95 disabled:opacity-40"
          />
          <span className="w-28" />
        </div>
      </div>
    </div>
  );
}

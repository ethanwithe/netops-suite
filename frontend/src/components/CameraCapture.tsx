import { useCallback, useEffect, useRef, useState } from "react";
import {
  STAMP_ORDER,
  getStampStyle,
  setStampStyle,
  setStampText,
  posH,
  posV,
  fontOf,
  shadowFor,
  STAMP_FONTS,
  STAMP_COLORS,
  prefetchPlace,
  stampLines,
  watchPlace,
} from "../utils/photoStamp";
import type { Place, StampStyle } from "../utils/photoStamp";

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
  zoom?: { min: number; max: number; step?: number };
};

interface Props {
  /** Cliente que se imprime en el sello. */
  cliente?: string;
  /** Recibe la foto y la ubicación que se veía en pantalla al disparar. */
  onCapture: (file: File, place: Place | null) => void;
  onClose: () => void;
  /** Abre la cámara nativa del teléfono (plan B). */
  onNative: () => void;
  /** Varias fotos seguidas, como la cámara del teléfono: no se cierra al disparar y muestra la miniatura de lo tomado. */
  multi?: boolean;
}

const GLASS = "grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition active:scale-90";

export default function CameraCapture({ cliente = "", onCapture, onClose, onNative, multi = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const capsRef = useRef<FocusCaps>({});

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [hq, setHq] = useState(() => { try { return localStorage.getItem("netops.camHQ") === "1"; } catch { return false; } });
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);

  // Vista previa en vivo del sello (para ver si taparía la serie del equipo)
  const [place, setPlace] = useState<Place | null>(null);
  const placeRef = useRef<Place | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [sty, setSty] = useState<StampStyle>(() => getStampStyle());
  const [panel, setPanel] = useState(false);
  const [shots, setShots] = useState<{ url: string }[]>([]);
  const [view, setView] = useState<number | null>(null);
  const shotsRef = useRef<{ url: string }[]>([]);
  useEffect(() => () => { shotsRef.current.forEach((x) => URL.revokeObjectURL(x.url)); }, []);
  const [custom, setCustom] = useState<string | null>(null);   // texto escrito a mano (null = automático)
  useEffect(() => { setStampText(null); }, []);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; aw: number; ah: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  // Acercar / alejar la cámara: pellizco con dos dedos o rueda del mouse (zoom real si el teléfono lo tiene; si no, digital).
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [hwZoom, setHwZoom] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const lastPinch = useRef(0);
  const setZ = useCallback((next: number) => {
    const hw = capsRef.current.zoom;
    const lo = hw ? hw.min : 1, hi = hw ? Math.min(hw.max, 10) : 5;
    const z = Math.max(lo, Math.min(hi, next));
    zoomRef.current = z;
    setZoom(z);
    if (hw) trackRef.current?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).catch(() => undefined);
  }, []);

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
            width: { ideal: 1920 },   // el sello se hace a 1600 px: pedir más solo retrasa la cámara
            height: { ideal: 1440 },
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
        setHwZoom(!!caps.zoom);
        if (caps.zoom) { zoomRef.current = caps.zoom.min <= 1 ? 1 : caps.zoom.min; setZoom(zoomRef.current); }

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
      setBox({ x: video.offsetLeft + (cw - w) / 2, y: video.offsetTop + (ch - h) / 2, w, h, aw: area.clientWidth, ah: area.clientHeight });
    };
    // Al girar el teléfono el video cambia de tamaño un poco después: se vuelve a medir varias veces.
    const later = () => { measure(); window.setTimeout(measure, 150); window.setTimeout(measure, 500); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    ro.observe(video);
    video.addEventListener("loadedmetadata", measure);
    video.addEventListener("resize", measure);
    window.addEventListener("resize", later);
    window.addEventListener("orientationchange", later);
    screen.orientation?.addEventListener?.("change", later);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("resize", measure);
      window.removeEventListener("resize", later);
      window.removeEventListener("orientationchange", later);
      screen.orientation?.removeEventListener?.("change", later);
    };
  }, [ready]);

  function patchSty(p: Partial<StampStyle>) {
    const n = { ...sty, ...p };
    setSty(n);
    setStampStyle(n);
  }
  function editText(v: string | null) {
    setCustom(v);
    setStampText(v == null ? null : v.split("\n").filter((l) => l.trim()));
  }

  // Rueda del mouse / touchpad: acerca o aleja la cámara.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setZ(zoomRef.current * Math.exp(-e.deltaY * 0.002)); };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [setZ]);

  function onPtrDown(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoomRef.current };
      lastPinch.current = Date.now();
    }
  }
  function onPtrMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      setZ(pinch.current.z0 * ((Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.current.d0));
      lastPinch.current = Date.now();
    }
  }
  function onPtrUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
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
    if (Date.now() - lastPinch.current < 400) return; // el pellizco no es un toque para enfocar
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

  function toggleHq() {
    const n = !hq;
    setHq(n);
    try { localStorage.setItem("netops.camHQ", n ? "1" : "0"); } catch { /* ignorar */ }
  }

  /** Disparo instantáneo: se toma el cuadro que ya está en pantalla (≈0,1 s). «Alta calidad» usa el sensor completo (más lento). */
  async function shoot() {
    const track = trackRef.current;
    const video = videoRef.current;
    if (!track || !video || busy || !video.videoWidth) return;
    setBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
    try { navigator.vibrate?.(25); } catch { /* sin vibración */ }

    try {
      let blob: Blob | null = null;

      const digital = !hwZoom && zoomRef.current > 1.01 ? zoomRef.current : 1;
      if (hq && digital === 1) {
        const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: (o?: object) => Promise<Blob> } }).ImageCapture;
        if (IC) {
          try { blob = await new IC(track).takePhoto(); } catch { blob = null; }
        }
      }

      if (!blob) {
        const MAX = 1600; // el sello también se hace a este tamaño
        // Con zoom digital se recorta el centro del cuadro, igual que se ve en pantalla.
        const sw = video.videoWidth / digital, sh = video.videoHeight / digital;
        const sx = (video.videoWidth - sw) / 2, sy = (video.videoHeight - sh) / 2;
        const k = Math.min(1, MAX / Math.max(sw, sh));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(sw * k);
        canvas.height = Math.round(sh * k);
        canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      }

      if (blob) {
        const file = new File([blob], `foto-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
        const where = placeRef.current;
        onCapture(file, where);   // el sello y la subida siguen por detrás
        if (multi) {
          const sh = { url: URL.createObjectURL(file) };
          shotsRef.current = [...shotsRef.current, sh];
          setShots(shotsRef.current);
        } else {
          stop();   // una sola foto: se cierra la cámara ya
        }
      } else {
        setError("No se pudo tomar la foto. Inténtalo otra vez.");
      }
    } finally {
      setBusy(false);
    }
  }

  // Atajos: Espacio / Enter / tecla de volumen (en algunos teléfonos) disparan; Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter" || e.key === "AudioVolumeUp" || e.key === "AudioVolumeDown") { e.preventDefault(); void shoot(); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="Cámara" style={{ touchAction: "none", overscrollBehavior: "contain" }}>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white">
        {shots.length ? (
          <button className="h-10 rounded-full bg-white px-4 text-sm font-semibold text-black active:scale-95" onClick={onClose}>Listo ({shots.length})</button>
        ) : (
          <button className={GLASS} onClick={onClose} aria-label="Cerrar la cámara">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button className={`${GLASS} ${torch ? "!bg-yellow-300 !text-black" : ""}`} onClick={toggleTorch} aria-label={torch ? "Apagar linterna" : "Encender linterna"} aria-pressed={torch}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill={torch ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" /></svg>
            </button>
          )}
          <button className={`${GLASS} ${panel ? "!bg-white !text-black" : ""}`} onClick={() => setPanel((v) => !v)} aria-label="Sello: posición, letra, color y texto" aria-pressed={panel} title="Sello">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
          </button>
        </div>
      </div>

      <div ref={areaRef} className="relative flex-1 overflow-hidden" style={{ touchAction: "none" }} onClick={refocus}
        onPointerDown={onPtrDown} onPointerMove={onPtrMove} onPointerUp={onPtrUp} onPointerCancel={onPtrUp}>
        <div className={`pointer-events-none absolute inset-0 z-10 bg-white transition-opacity ${flash ? "opacity-80 duration-75" : "opacity-0 duration-200"}`} aria-hidden="true" />
        {/* Con zoom digital el video se agranda dentro del cuadro de la imagen (sin invadir las franjas negras) */}
        <div className="absolute inset-0" style={box ? { clipPath: `inset(${box.y}px ${Math.max(0, box.aw - box.x - box.w)}px ${Math.max(0, box.ah - box.y - box.h)}px ${box.x}px)` } : undefined}>
          <video ref={videoRef} playsInline muted className="h-full w-full object-contain"
            style={!hwZoom && zoom > 1 ? { transform: `scale(${zoom})`, transformOrigin: "center" } : undefined} />
        </div>
        {(zoom > 1.02 || hwZoom) && ready && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setZ(hwZoom ? (capsRef.current.zoom?.min ?? 1) : 1); }}
            className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">
            {zoom.toFixed(1)}× {zoom > 1.02 ? "· toca para volver a 1×" : ""}
          </button>
        )}
        {box && ready && (
          <div
            className="pointer-events-none absolute overflow-hidden"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            aria-hidden="true"
          >
            <div
              className="absolute inset-0 flex"
              style={{
                padding: Math.max(4, Math.min(box.w, box.h) * 0.015),
                justifyContent: posH(sty.pos) === "r" ? "flex-end" : posH(sty.pos) === "c" ? "center" : "flex-start",
                alignItems: posV(sty.pos) === "b" ? "flex-end" : posV(sty.pos) === "m" ? "center" : "flex-start",
              }}
            >
              <div
                className="flex max-w-full flex-col"
                style={{
                  alignItems: posH(sty.pos) === "r" ? "flex-end" : posH(sty.pos) === "c" ? "center" : "flex-start",
                  textAlign: posH(sty.pos) === "r" ? "right" : posH(sty.pos) === "c" ? "center" : "left",
                  fontFamily: fontOf(sty.font).family,
                  fontWeight: fontOf(sty.font).weight,
                  fontSize: Math.max(10, Math.min(box.w, box.h) * 0.05 * sty.scale),
                  lineHeight: 1.18,
                  color: sty.color,
                  textShadow: `1px 1px 3px ${shadowFor(sty.color)}`,
                }}
              >
                {(custom != null ? custom.split("\n").filter((l) => l.trim()) : stampLines(cliente, place, now)).map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
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

      <div className="flex flex-col items-center gap-3 px-4 pt-3" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        {panel && (
          <div className="w-full max-w-md space-y-2 rounded-3xl border border-white/15 bg-white/15 p-3 text-white shadow-2xl backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid shrink-0 grid-cols-3 gap-1" aria-label="Posición del sello">
                {STAMP_ORDER.map((p) => (
                  <button key={p} type="button" aria-label={`Posición ${p}`} onClick={() => patchSty({ pos: p })}
                    className={`h-7 w-7 rounded border text-[10px] ${sty.pos === p ? "border-yellow-300 bg-yellow-300/80 text-black" : "border-white/40 bg-white/10"}`}>
                    {sty.pos === p ? "■" : "□"}
                  </button>
                ))}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {STAMP_FONTS.map((f) => (
                    <button key={f.id} type="button" onClick={() => patchSty({ font: f.id })}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${sty.font === f.id ? "border-yellow-300 bg-yellow-300/80 text-black" : "border-white/40"}`}
                      style={{ fontFamily: f.family }}>{f.label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {STAMP_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => patchSty({ color: c })}
                      className={`h-6 w-6 rounded-full border-2 ${sty.color === c ? "border-yellow-300" : "border-white/40"}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11px]">Tamaño
              <input type="range" min={0.5} max={2.5} step={0.05} value={sty.scale} className="flex-1" onChange={(e) => patchSty({ scale: Number(e.target.value) })} />
            </label>
            <textarea rows={3} className="w-full rounded-lg border border-white/30 bg-black/40 p-2 text-[12px] text-white" aria-label="Texto del sello"
              value={custom ?? stampLines(cliente, place, now).join("\n")}
              onChange={(e) => editText(e.target.value)} />
            {custom != null && <button type="button" className="text-[11px] underline" onClick={() => editText(null)}>Volver al texto automático (fecha, lugar y cliente)</button>}
          </div>
        )}
        <div className="flex w-full max-w-md items-center justify-between">
          <div className="flex w-20 justify-start">
            {shots.length ? (
              <button type="button" aria-label="Ver las fotos tomadas" onClick={() => setView(shots.length - 1)} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border-2 border-white/90 bg-black shadow-lg active:scale-95">
                <img src={shots[shots.length - 1].url} alt="" className="h-full w-full object-cover" />
                <span className="absolute -right-0 -top-0 min-w-[18px] rounded-bl-lg bg-white px-1 text-center text-[11px] font-bold text-black">{shots.length}</span>
              </button>
            ) : (
              <button className={GLASS} onClick={onNative} aria-label="Usar la cámara del teléfono" title="Cámara del teléfono">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </button>
            )}
          </div>
          <button
            aria-label="Tomar foto"
            disabled={!ready || busy}
            onClick={shoot}
            className="grid h-[78px] w-[78px] place-items-center rounded-full border-[4px] border-white bg-transparent transition-transform active:scale-90 disabled:opacity-40"
          >
            <span className={`block h-[62px] w-[62px] rounded-full bg-white transition-transform ${busy ? "scale-75" : ""}`} />
          </button>
          <div className="flex w-20 justify-end">
            <button className={`h-9 rounded-full px-3 text-xs font-semibold backdrop-blur ${hq ? "bg-yellow-300 text-black" : "bg-white/15 text-white"}`} onClick={toggleHq} aria-pressed={hq}
              title="Rápida: toma el cuadro que ves (instantánea). Alta calidad: usa el sensor completo y tarda más.">
              {hq ? "HQ" : "Rápida"}
            </button>
          </div>
        </div>
      </div>
      {view != null && shots[view] && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black" role="dialog" aria-label="Fotos tomadas">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={() => setView(null)}>← Cámara</button>
            <span className="text-xs text-white/70">{view + 1} de {shots.length}</span>
            <button className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black" onClick={onClose}>Listo</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <img src={shots[view].url} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            {shots.map((x, i) => (
              <button key={x.url} type="button" onClick={() => setView(i)} aria-label={`Foto ${i + 1}`}
                ref={(el) => { if (el && i === view) el.scrollIntoView({ inline: "center", block: "nearest" }); }}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${i === view ? "border-yellow-300" : "border-white/30"}`}>
                <img src={x.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

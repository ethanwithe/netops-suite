import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { installDownloadGuard } from "./utils/saveFile";

installDownloadGuard();

/** App de escritorio: la consola y el saturador viven dentro del programa; la página recibe sus códigos sola. */
async function desktopSetup() {
  if (!import.meta.env.VITE_DESKTOP) return;
  try {
    const r = await fetch("/api/local/info", { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (!d?.desktop) return;
    const put = (k: string, v: string) => { if (v) localStorage.setItem("netops.ui.v1." + k, JSON.stringify({ v, d: false })); };
    put("puente.codigo", d.puente_code);
    put("saturador.codigo", d.saturador_code);
  } catch { /* sin datos: se pueden escribir a mano */ }
}

void desktopSetup().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});

// Modo ligero automático: pantalla táctil/estrecha o equipo con poca memoria/núcleos (quita desenfoques y animaciones de fondo)
try {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 820;
  if (weak || phone) document.documentElement.dataset.lite = "1";
} catch { /* sin datos: modo normal */ }

// Rendimiento: con la pestaña oculta o mientras se desplaza la página se pausan las animaciones de fondo
{
  const root = document.documentElement;
  const sync = () => { if (document.hidden) root.dataset.paused = "1"; else delete root.dataset.paused; };
  document.addEventListener("visibilitychange", sync);
  let t = 0;
  window.addEventListener("scroll", () => {
    root.dataset.scrolling = "1";
    window.clearTimeout(t);
    t = window.setTimeout(() => { delete root.dataset.scrolling; }, 140);
  }, { passive: true, capture: true });
}

// Funciona sin conexión: el service worker guarda el programa y sirve las fotos pendientes de subir.
if (import.meta.env.PROD && "serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
}

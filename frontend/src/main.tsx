import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

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

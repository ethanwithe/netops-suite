import { useEffect, useMemo, useRef, useState } from "react";
import { lineHtml } from "../utils/vt";
import { sendRaw, useTerminal, vt } from "../store/terminal";
import { shellInit, shellKey } from "../store/localShell";

/** Convierte una tecla del navegador en lo que enviaría una terminal real. */
export function keyToSeq(e: React.KeyboardEvent): string | null {
  if (e.key.length === 1 && e.getModifierState("AltGraph")) return e.key;
  if (e.ctrlKey && e.shiftKey) return null;
  if (e.ctrlKey && !e.altKey && e.key.length === 1) {
    const k = e.key.toUpperCase();
    if (k === "V") return null;
    if (k >= "A" && k <= "Z") return String.fromCharCode(k.charCodeAt(0) - 64);
    if (k === "[") return "\x1b";
    if (k === "\\") return "\x1c";
    return null;
  }
  if (e.metaKey) return null;
  if (e.altKey && e.key.length === 1) return "\x1b" + e.key;
  if (e.altKey) return null;
  switch (e.key) {
    case "Enter": return "\r";
    case "Tab": return "\t";
    case "Backspace": return "\x7f";
    case "Escape": return "\x1b";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x01";
    case "End": return "\x05";
    case "Delete": return "\x1b[3~";
    case "PageUp": return "\x1b[5~";
    case "PageDown": return "\x1b[6~";
  }
  return e.key.length === 1 ? e.key : null;
}

export const THEMES: Record<string, { bg: string; fg: string }> = {
  Oscuro: { bg: "#0b0f14", fg: "#d7e3d3" },
  Clásico: { bg: "#000000", fg: "#c0c0c0" },
  Verde: { bg: "#000000", fg: "#33ff66" },
  Ámbar: { bg: "#120a00", fg: "#ffb000" },
  Claro: { bg: "#fbfbf8", fg: "#1f2937" },
};

/** Pantalla de la terminal: se escribe directo (sin cuadro de texto), como MobaXterm/PuTTY. */
export default function TerminalView({ connected, theme, fontSize, hl, onSearchKey }: {
  connected: boolean; theme: string; fontSize: number; hl?: number; onSearchKey?: () => void;
}) {
  const t = useTerminal();
  const box = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(false);
  const stick = useRef(true);
  const th = THEMES[theme] ?? THEMES.Oscuro;

  // ancho en columnas según lo que cabe en pantalla (afecta a lo que se escriba a partir de ahora)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const probe = document.createElement("span");
    probe.textContent = "M".repeat(10);
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${fontSize}px ui-monospace,monospace`;
    el.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 10 || 7;
    probe.remove();
    const ro = new ResizeObserver(() => { vt.cols = Math.max(60, Math.min(250, Math.floor((el.clientWidth - 16) / cw))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fontSize]);

  // al abrir la terminal sin conexión aparece el indicador de comandos y el cursor ya está dentro de la pantalla
  useEffect(() => { shellInit(); box.current?.focus(); }, []);

  const html = useMemo(() => {
    const out: string[] = [];
    for (let y = 0; y < vt.lines.length; y++) {
      const cur = connected && y === vt.cy ? vt.cx : -1;
      out.push(`<div data-y="${y}"${y === hl ? ' style="background:rgba(250,204,21,.25)"' : ""}>${lineHtml(vt.lines[y], cur)}</div>`);
    }
    return out.join("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.rev, connected, hl]);

  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [html]);
  useEffect(() => {
    if (hl == null) return;
    box.current?.querySelector(`[data-y="${hl}"]`)?.scrollIntoView({ block: "center" });
  }, [hl]);

  const paste = async () => {
    try { const txt = await navigator.clipboard.readText(); if (txt) { if (connected) sendRaw(txt.replace(/\r?\n/g, "\r")); else shellKey(txt.split(/\r?\n/)[0]); } } catch { /* sin permiso */ }
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      className={`vt-scroll min-h-0 flex-1 overflow-auto whitespace-pre p-2 font-mono leading-snug outline-none ${focus ? "vt-focus" : ""}`}
      style={{ background: th.bg, color: th.fg, fontSize }}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); onSearchKey?.(); return; }
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") return; // copiar del navegador
        if (e.ctrlKey && e.key.toLowerCase() === "c" && String(window.getSelection()).length > 0) return; // con texto marcado, Ctrl+C copia
        if (e.ctrlKey && e.key === "Insert") return;
        if (e.shiftKey && e.key === "Insert") { e.preventDefault(); void paste(); return; }
        const seq = keyToSeq(e);
        if (seq == null) return;
        e.preventDefault();
        stick.current = true;
        if (connected) sendRaw(seq); else shellKey(seq);
      }}
      onPaste={(e) => { e.preventDefault(); const tx = e.clipboardData.getData("text").replace(/\r?\n/g, "\r"); if (connected) sendRaw(tx); else shellKey(tx.split("\r")[0]); }}
      // clic derecho: copia lo marcado o, si no hay nada marcado, pega (como PuTTY/MobaXterm)
      onContextMenu={(e) => {
        e.preventDefault();
        const sel = String(window.getSelection());
        if (sel) { void navigator.clipboard?.writeText(sel).catch(() => undefined); window.getSelection()?.removeAllRanges(); } else void paste();
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

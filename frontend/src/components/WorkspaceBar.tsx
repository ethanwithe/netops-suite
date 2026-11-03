import type { WsApi } from "../store/workspaces";

/** Aviso y estado del guardado automático por SOT (ver store/workspaces.ts). */
export default function WorkspaceBar({ ws }: { ws: WsApi }) {
  if (ws.conflict) {
    const when = ws.conflict.updated_at ? new Date(ws.conflict.updated_at + (ws.conflict.updated_at.endsWith("Z") ? "" : "Z")).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "";
    return (
      <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm text-amber-900" role="alert">
        <p>
          <b>Hay datos guardados de la SOT {ws.conflict.sot} en esta ventana</b>{when ? ` (${when})` : ""}: fotos, textos y opciones. ¿Quieres traerlos para seguir editando?
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-xs" onClick={ws.load}>Cargar lo guardado</button>
          <button type="button" className="btn-secondary text-xs" onClick={ws.keepMine} title="Lo que tienes en pantalla reemplazará lo guardado para esta SOT">Seguir con lo que tengo</button>
        </div>
      </div>
    );
  }
  const txt = !ws.hasSot
    ? "Escribe la SOT y todo lo de esta ventana se guarda solo en «Datos de cliente» (fotos, textos y PDF)."
    : ws.status?.kind === "saving" ? "Guardando…"
    : ws.status?.kind === "saved" ? `Guardado automático en Datos de cliente · ${ws.status.at}`
    : ws.status?.kind === "error" ? "No se pudo guardar (sin conexión). Se reintenta con el próximo cambio."
    : "Guardado automático activado para esta SOT.";
  return <p className={`text-[11px] ${ws.status?.kind === "error" ? "text-red-600" : "text-slate-500"}`} aria-live="polite">☁ {txt}</p>;
}

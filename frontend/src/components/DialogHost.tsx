import { useEffect } from "react";
import { useDialog } from "../store/dialog";

/** Cuadro de confirmación global (ver store/dialog.ts). */
export default function DialogHost() {
  const d = useDialog();
  useEffect(() => {
    if (!d) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); d.resolve(""); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [d]);
  if (!d) return null;
  const cls = (k?: string) => (k === "primary" ? "btn-primary" : k === "danger" ? "btn-secondary !border-red-300 !text-red-600" : "btn-secondary");
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-3 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) d.resolve(""); }}>
      <div role="dialog" aria-modal="true" aria-label={d.title} className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-xl">
        <h3 className="text-base font-semibold text-slate-800">{d.title}</h3>
        <p className="whitespace-pre-line text-sm text-slate-600">{d.message}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {d.choices.map((c) => (
            <button key={c.id} type="button" autoFocus={c.kind === "primary"} className={`${cls(c.kind)} text-sm`} onClick={() => d.resolve(c.id)}>{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

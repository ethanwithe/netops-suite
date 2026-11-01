import { useState } from "react";
import LogoPicker from "./LogoPicker";
import { apiErrorMessage } from "../api/client";
import { NO_LOGO } from "../logo";
import type { LogoSel } from "../logo";
import type { PhotoWindow, WindowInput } from "../store/photoWindows";

const BASES = [
  { value: "fibra", label: "Copiar los ítems de Fibra convencional" },
  { value: "gpon_ont", label: "Copiar los ítems de GPON con ONT" },
  { value: "gpon_modulo", label: "Copiar los ítems de GPON con módulo" },
  { value: "", label: "Empezar sin ítems (los agrego yo)" },
];

const toSel = (v?: { id: string | null }): LogoSel => (v?.id ? { id: v.id, path: "", url: "" } : NO_LOGO);

interface Props {
  /** Si viene, se edita esa ventana; si no, se crea una nueva. */
  initial?: PhotoWindow;
  onSave: (input: WindowInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}

/** Formulario para crear o configurar una ventana: nombre y valores por defecto. */
export default function WindowEditor({ initial, onSave, onCancel, onDelete }: Props) {
  const c = initial?.config ?? {};
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [proy, setProy] = useState(c.proy ?? "");
  const [cliente, setCliente] = useState(c.cliente ?? "");
  const [sot, setSot] = useState(c.sot ?? "");
  const [cid, setCid] = useState(c.cid ?? "");
  const [contrata, setContrata] = useState(c.contrata ?? "");
  const [logoIzq, setLogoIzq] = useState<LogoSel>(toSel(c.logoIzq));
  const [logoDer, setLogoDer] = useState<LogoSel>(toSel(c.logoDer));
  const [base, setBase] = useState("fibra");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!nombre.trim()) {
      setError("Escribe un nombre para la ventana.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        nombre: nombre.trim(),
        config: { proy, cliente, sot, cid, contrata, logoIzq: { id: logoIzq.id }, logoDer: { id: logoDer.id } },
        copiar_de: initial ? undefined : base,
      });
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo guardar la ventana."));
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, cls = "") => (
    <label className={`block text-sm ${cls}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input className="input w-full" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8">
      <div className="card w-full max-w-2xl space-y-3">
        <h3 className="text-lg font-semibold text-slate-800">
          {initial ? "Configurar ventana" : "Nueva ventana de reporte"}
        </h3>
        <p className="text-xs text-slate-500">
          Lo que escribas en los campos se pondrá solo cada vez que empieces un reporte en esta ventana; después
          puedes cambiarlo. Los ítems y las opciones del título también se editan dentro de la ventana.
        </p>

        {field("Nombre de la ventana", nombre, setNombre)}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("PROY (por defecto)", proy, setProy)}
          {field("CLIENTE (por defecto)", cliente, setCliente)}
          {field("SOT (por defecto)", sot, setSot)}
          {field("CID (por defecto)", cid, setCid)}
          {field("CONTRATA (por defecto)", contrata, setContrata, "sm:col-span-2")}
        </div>

        <LogoPicker posicion="izq" label="Logo izquierda (por defecto)" value={logoIzq} onChange={setLogoIzq} />
        <LogoPicker posicion="der" label="Logo derecha (por defecto)" value={logoDer} onChange={setLogoDer} />

        {!initial && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Ítems iniciales</span>
            <select className="input w-full" value={base} onChange={(e) => setBase(e.target.value)}>
              {BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              className="text-sm text-red-500 hover:underline"
              disabled={busy}
              onClick={async () => {
                if (confirm("¿Borrar esta ventana y sus ítems? No se puede deshacer.")) {
                  setBusy(true);
                  try {
                    await onDelete();
                  } catch (e) {
                    setError(apiErrorMessage(e, "No se pudo borrar."));
                    setBusy(false);
                  }
                }
              }}
            >
              Borrar ventana
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? "Guardando..." : initial ? "Guardar" : "Crear ventana"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

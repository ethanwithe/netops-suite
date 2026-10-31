import { useState } from "react";
import { apiErrorMessage } from "../api/client";
import { useChecklistTypes } from "../store/checklistTypes";

/** Crea otra opción de CheckList copiando una existente (o vacía). */
export default function NewChecklistModal({
  onCreate, onCancel,
}: {
  onCreate: (input: { nombre: string; copiar_de?: string; data?: object }) => Promise<void>;
  onCancel: () => void;
}) {
  const { list } = useChecklistTypes();
  const [nombre, setNombre] = useState("");
  const [base, setBase] = useState(list[0]?.id ?? "");
  const [servicio, setServicio] = useState("internet");
  const [vendor, setVendor] = useState("huawei");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!nombre.trim()) { setError("Escribe un nombre."); return; }
    setBusy(true);
    setError(null);
    try {
      await onCreate(base ? { nombre: nombre.trim(), copiar_de: base } : { nombre: nombre.trim(), data: { servicio, vendor, setup: [], params: [], sections: [] } });
    } catch (e) {
      setError(apiErrorMessage(e, "No se pudo crear."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8">
      <div className="card w-full max-w-lg space-y-3">
        <h3 className="text-lg font-semibold text-slate-800">Nueva opción de CheckList</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Nombre (ej. Internet Huawei con HA)</span>
          <input className="input w-full" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Empezar copiando</span>
          <select className="input w-full" value={base} onChange={(e) => setBase(e.target.value)}>
            {list.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            <option value="">— Vacío (lo armo yo) —</option>
          </select>
        </label>
        {!base && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Servicio</span>
              <select className="input w-full" value={servicio} onChange={(e) => setServicio(e.target.value)}>
                <option value="internet">Internet</option>
                <option value="rpv">RPV</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Marca</span>
              <select className="input w-full" value={vendor} onChange={(e) => setVendor(e.target.value)}>
                <option value="huawei">Huawei</option>
                <option value="cisco">Cisco</option>
                <option value="fortinet">Fortinet</option>
                <option value="otro">Otra</option>
              </select>
            </label>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? "Creando..." : "Crear"}</button>
        </div>
      </div>
    </div>
  );
}

import { LOOK_DEFAULTS, SCENES, resetLook, setLook, useLook } from "../store/look";

const RAINBOW = "linear-gradient(90deg,#ff4d4d,#ffb347,#f7e93a,#4ade80,#22d3ee,#3b82f6,#8b5cf6,#ec4899,#ff4d4d)";

function HueRow({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
        <span className="font-semibold">{label}</span>
        <button type="button" onClick={() => onChange(null)} className={`rounded-md px-1.5 py-0.5 ${value == null ? "bg-slate-100 font-semibold text-slate-700" : "text-brand-700 hover:bg-slate-100"}`}>
          {value == null ? "Del tema" : "Restablecer"}
        </button>
      </div>
      <input
        type="range" min={0} max={360} value={value ?? 210} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="hue-range h-2.5 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: RAINBOW, opacity: value == null ? 0.45 : 1 }}
      />
    </div>
  );
}

/** Personalización: escena 3D de fondo, gotas, colores y efecto cristal. */
export default function LookPanel({ onBack }: { onBack: () => void }) {
  const look = useLook();
  return (
    <div className="space-y-3 p-2 text-slate-700">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-slate-100">← Temas</button>
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Personalizar</span>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">Fondo 3D</div>
        <div className="grid grid-cols-3 gap-1.5">
          {SCENES.map((s) => (
            <button key={s.id} type="button" onClick={() => setLook({ scene: s.id })}
              className={`rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${look.scene === s.id ? "border-cyan2-500 bg-brand-50 text-brand-700" : "border-slate-200 hover:bg-slate-100"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between text-[12px]">
        <span className="font-semibold">Gotas de agua</span>
        <input type="checkbox" checked={look.drops} onChange={(e) => setLook({ drops: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-[12px]">
        <span className="font-semibold">Efecto cristal líquido al pasar el cursor</span>
        <input type="checkbox" checked={look.glass} onChange={(e) => setLook({ glass: e.target.checked })} />
      </label>

      <HueRow label="Color del fondo" value={look.bgHue} onChange={(v) => setLook({ bgHue: v })} />
      <HueRow label="Color de las gotas" value={look.dropHue} onChange={(v) => setLook({ dropHue: v })} />
      <HueRow label="Color de botones y acentos" value={look.accentHue} onChange={(v) => setLook({ accentHue: v })} />

      <div>
        <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-600"><span>Intensidad del fondo</span><span>{Math.round(look.intensity * 100)}%</span></div>
        <input type="range" min={0.3} max={1.5} step={0.05} value={look.intensity} aria-label="Intensidad del fondo" onChange={(e) => setLook({ intensity: Number(e.target.value) })} className="w-full cursor-pointer" />
      </div>

      <button type="button" onClick={resetLook} disabled={JSON.stringify(look) === JSON.stringify(LOOK_DEFAULTS)} className="btn-secondary w-full py-1.5 text-xs">Restablecer todo</button>
    </div>
  );
}

/** Ventana gráfica: por ahora solo la pantalla base (se completa más adelante). */
export default function GraficaPage() {
  const bars = [38, 62, 48, 80, 56, 92, 70];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">Gráfica</h2>
        <p className="text-sm text-slate-500">Esta ventana ya está creada; el contenido llega pronto.</p>
      </div>
      <div className="card flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex h-24 items-end gap-2" aria-hidden="true">
          {bars.map((h, i) => (
            <span key={i} className="w-5 rounded-t-lg bg-brand-500/30" style={{ height: `${h}%`, animation: `rise .6s ${i * 60}ms both` }} />
          ))}
        </div>
        <p className="font-display text-lg font-semibold text-slate-800">En construcción</p>
        <p className="max-w-sm text-sm text-slate-500">Aquí irán los gráficos. Dime cómo los quieres y los armo.</p>
      </div>
    </div>
  );
}

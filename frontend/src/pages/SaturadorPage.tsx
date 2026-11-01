import SaturadorPanel from "../components/SaturadorPanel";

/** Saturador bidireccional: se controla desde aquí, pero corre en tu laptop (agente local). */
export default function SaturadorPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">Saturador bidireccional</h2>
        <p className="text-sm text-slate-500">
          Sube y baja tráfico <b>al mismo tiempo</b> (como iperf) hacia una IP que conteste ping, sin servidor al otro lado.
          La página lo controla, pero el tráfico sale de <b>tu laptop</b> (la nube no puede saturar el enlace del cliente).
        </p>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Instalación (una sola vez por laptop)</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <a className="font-medium text-brand-600 hover:underline" href="/api/tools/saturador.py" download>Descarga saturador.py</a>{" "}
            (necesita Python 3; no instala nada más).
          </li>
          <li>
            Abre una terminal en esa carpeta y ejecuta <code className="rounded bg-slate-100 px-1">python saturador.py --agente</code>.
            En Linux/Mac usa <code className="rounded bg-slate-100 px-1">sudo</code>; en Windows no hace falta administrador.
          </li>
          <li>Copia el <b>código</b> que muestra y pégalo abajo. Déjalo abierto mientras haces el CheckList.</li>
        </ol>
      </div>

      <div className="card">
        <SaturadorPanel />
      </div>

      <div className="card text-xs text-slate-500">
        También puedes usarlo sin la página: <code className="rounded bg-slate-100 px-1">python saturador.py 8.8.8.8 --mbps 100 --seg 60</code>.
        Si el resumen muestra 0 respuestas, ese destino no contesta ping: prueba con la gateway o el siguiente salto.
        Úsalo solo en enlaces que tengas autorizados.
      </div>
    </div>
  );
}

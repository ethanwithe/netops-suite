import { useMemo } from "react";
import { usePersistentState } from "../store/persistentState";

/** Prepara el comando del saturador bidireccional (se ejecuta en la laptop del técnico). */
export default function SaturadorPage() {
  const [modo, setModo] = usePersistentState<"internet" | "rpv">("saturador.modo", "internet");
  const [destino, setDestino] = usePersistentState("saturador.destino", "8.8.8.8");
  const [destinoRpv, setDestinoRpv] = usePersistentState("saturador.destinoRpv", "");
  const [mbps, setMbps] = usePersistentState("saturador.mbps", "100");
  const [seg, setSeg] = usePersistentState("saturador.seg", "60");
  const [tam, setTam] = usePersistentState("saturador.tam", "1400");

  const dest = modo === "internet" ? destino : destinoRpv;
  const cmd = useMemo(
    () => `python saturador.py ${dest.trim() || "<IP>"} --mbps ${Number(mbps) || 0} --seg ${Number(seg) || 0}${Number(tam) !== 1400 ? ` --tam ${Number(tam)}` : ""}`,
    [dest, mbps, seg, tam]
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Saturador bidireccional</h2>
        <p className="text-sm text-slate-500">
          Sube y baja tráfico <b>al mismo tiempo</b> (como iperf) hacia una IP que conteste ping, sin necesitar un servidor
          al otro lado. Te dice en vivo cuántos Mbps salen y cuántos regresan.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          <button className={modo === "internet" ? "btn-primary" : "btn-secondary"} onClick={() => setModo("internet")}>Internet</button>
          <button className={modo === "rpv" ? "btn-primary" : "btn-secondary"} onClick={() => setModo("rpv")}>RPV</button>
        </div>

        {modo === "internet" ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">IP de destino (Internet)</span>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[160px]" value={destino} onChange={(e) => setDestino(e.target.value)} />
              {["8.8.8.8", "1.1.1.1", "9.9.9.9"].map((ip) => (
                <button key={ip} type="button" className="btn-secondary text-xs" onClick={() => setDestino(ip)}>{ip}</button>
              ))}
            </div>
          </label>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              IP de destino en la RPV: su gateway, el siguiente salto o una IP de cabecera del cliente
            </span>
            <input className="input w-full" value={destinoRpv} placeholder="ej. 10.31.242.25" onChange={(e) => setDestinoRpv(e.target.value)} />
          </label>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Mbps a saturar (por cada sentido)</span>
            <input className="input w-full" inputMode="decimal" value={mbps} onChange={(e) => setMbps(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Duración (segundos, 0 = hasta Ctrl+C)</span>
            <input className="input w-full" inputMode="numeric" value={seg} onChange={(e) => setSeg(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tamaño del paquete (bytes)</span>
            <input className="input w-full" inputMode="numeric" value={tam} onChange={(e) => setTam(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Ejemplo: <b>{Number(mbps) || 0} Mbps</b> = {Number(mbps) || 0} Mbps de subida + {Number(mbps) || 0} Mbps de bajada a la vez. Para
          enlaces de 500 Mbps o más usa paquetes de 8000 bytes (se fragmentan y gastan menos CPU).
        </p>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Cómo usarlo</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <a className="font-medium text-brand-600 hover:underline" href="/api/tools/saturador.py" download>⬇ Descarga saturador.py</a>{" "}
            en la laptop que está conectada al servicio del cliente (necesita Python 3, no instala nada más).
          </li>
          <li>Abre una terminal en esa carpeta y ejecuta (en Linux/Mac con <code>sudo</code>; en Windows no hace falta administrador):</li>
        </ol>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-green-300 select-all">{cmd}</pre>
        <button className="btn-secondary text-xs" onClick={() => navigator.clipboard?.writeText(cmd)}>📋 Copiar comando</button>
        <ol start={3} className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Mientras satura, en el equipo ejecuta <b>display interface</b> / <b>show interfaces</b> de la WAN y toma la captura (ítem «Pruebas de saturación» del checklist).</li>
          <li>Termina solo al cumplirse el tiempo, o con Ctrl+C. Toma captura de su resumen final para el ítem «Captura software para saturar».</li>
        </ol>
        <p className="text-xs text-slate-500">
          Si el resumen muestra 0 respuestas, ese destino no contesta ping: prueba con la gateway o el siguiente salto. Úsalo solo en enlaces
          que tengas autorizados.
        </p>
      </div>
    </div>
  );
}

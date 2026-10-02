import { useEffect, useState } from "react";
import { api } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import ImageAnnotator from "../components/ImageAnnotator";

type Lado = "site" | "pdi" | "pop" | "cliente";
type Tipo = "gpon_ont" | "gpon_modulo" | "fibra";

const STORAGE = "rf_v3";

export default function FotograficoPage() {
  const [tipo, setTipo] = useState<Tipo | null>(null);

  if (!tipo) {
    return (
      <div className="p-4 flex justify-center">
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold">Tipo de instalación</h2>

          <select
            className="input"
            onChange={(e) => setTipo(e.target.value as Tipo)}
          >
            <option value="">Seleccionar</option>
            <option value="gpon_ont">GPON CON ONT</option>
            <option value="gpon_modulo">GPON CON MÓDULO</option>
            <option value="fibra">FIBRA CONVENCIONAL</option>
          </select>
        </div>
      </div>
    );
  }

  return <RunTab tipo={tipo} />;
}

function RunTab({ tipo }: { tipo: Tipo }) {
  const saved = JSON.parse(localStorage.getItem(STORAGE) || "{}");

  const [proy, setProy] = useState(saved.proy || "");
  const [sot, setSot] = useState(saved.sot || "");
  const [cid, setCid] = useState(saved.cid || "");
  const [cliente, setCliente] = useState(saved.cliente || "");
  const [fecha, setFecha] = useState(saved.fecha || "");
  const [logoIzq, setLogoIzq] = useState(saved.logoIzq || "");
  const [logoDer, setLogoDer] = useState(saved.logoDer || "");

  const [loading, setLoading] = useState(false);
  const [pdf, setPdf] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({
        proy,
        sot,
        cid,
        cliente,
        fecha,
        logoIzq,
        logoDer,
      })
    );
  }, [proy, sot, cid, cliente, fecha, logoIzq, logoDer]);

  function parsePaste(text: string) {
    const parts = text.replace(/\n/g, " ").split(" ").filter(Boolean);

    if (parts.length >= 4) {
      setProy(parts[0]);
      setSot(parts[1]);
      setCid(parts[2]);
      setCliente(parts.slice(3).join(" "));
    }
  }

  async function generate() {
    setLoading(true);

    try {
      const { data } = await api.post("/photos/pdf", {
        proy,
        sot,
        cid,
        cliente,
        fecha,
        logo_izq_path: logoIzq,
        logo_der_path: logoDer,
        items: [],
      });

      setPdf(data.url);
    } catch {
      alert("Error generando PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-3 space-y-4">

      {/* PEGADO AUTOMATICO */}
      <textarea
        className="input"
        placeholder="Pega PROY SOT CID CLIENTE"
        onBlur={(e) => parsePaste(e.target.value)}
      />

      <input className="input" value={proy} onChange={(e)=>setProy(e.target.value)} placeholder="PROY"/>
      <input className="input" value={sot} onChange={(e)=>setSot(e.target.value)} placeholder="SOT"/>
      <input className="input" value={cid} onChange={(e)=>setCid(e.target.value)} placeholder="CID"/>
      <input className="input" value={cliente} onChange={(e)=>setCliente(e.target.value)} placeholder="CLIENTE"/>

      {/* FECHA */}
      <input
        type="date"
        className="input"
        value={fecha}
        onChange={(e)=>setFecha(e.target.value)}
      />

      {/* LOGOS */}
      <div>
        <p className="label">Logo Izquierdo</p>
        <ImageUpload onUploaded={(p)=>setLogoIzq(p)} />
      </div>

      <div>
        <p className="label">Logo Derecho</p>
        <ImageUpload onUploaded={(p)=>setLogoDer(p)} />
      </div>

      {/* BOTON */}
      <button
        className="btn-primary w-full"
        onClick={generate}
        disabled={loading}
      >
        {loading ? "Generando PDF..." : "Generar PDF"}
      </button>

      {/* RESULTADO */}
      {pdf && (
        <div className="card space-y-2">
          <a className="btn-primary w-full" href={pdf} target="_blank">
            Descargar PDF
          </a>

          <button
            className="btn-secondary w-full"
            onClick={()=>setPdf(null)}
          >
            Volver a generar
          </button>
        </div>
      )}
    </div>
  );
}

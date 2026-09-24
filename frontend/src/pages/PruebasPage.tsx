import { useEffect, useState } from "react";
import { api, runStreaming } from "../api/client";
import ConnectionPanel from "../components/ConnectionPanel";
import ImageUpload from "../components/ImageUpload";
import LiveLog from "../components/LiveLog";
import type { Connection, Vendor } from "../types";

export default function PruebasPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorKey, setVendorKey] = useState("huawei");
  const [deviceType, setDeviceType] = useState<"switch" | "router">("switch");
  const [connection, setConnection] = useState<Connection>({ mode: "ssh", host: "", port: 22, user: "", password: "" });

  const [deviceId, setDeviceId] = useState("");
  const [sede, setSede] = useState("");
  const [fecha, setFecha] = useState(new Date().toLocaleDateString("es-PE"));
  const [uplink, setUplink] = useState("");
  const [ping, setPing] = useState("");

  const [logoIzq, setLogoIzq] = useState("");
  const [logoDer, setLogoDer] = useState("");

  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ config_text: string; results: any[] } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
  }, []);

  function runTests() {
    setLogs([]);
    setResult(null);
    setPdfUrl(null);
    setRunning(true);
    runStreaming("/tests/run", {
      connection, vendor_key: vendorKey, device_type: deviceType, uplink, ping,
    }, (ev) => {
      if (ev.type === "log") setLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setResult(ev.result); setRunning(false); }
      else if (ev.type === "error") { setLogs((l) => [...l, "✖ ERROR: " + ev.message]); setRunning(false); }
    });
  }

  async function generatePdf() {
    if (!result) return;
    const vendorLabel = vendors.find((v) => v.key === vendorKey)?.label || vendorKey;
    const ip = connection.mode === "ssh" ? connection.host : connection.com_port;
    const { data } = await api.post("/tests/pdf", {
      device_id: deviceId, ip, vendor_label: vendorLabel, sede, fecha,
      logo_izq_path: logoIzq || null, logo_der_path: logoDer || null,
      config_text: result.config_text, results: result.results,
    });
    setPdfUrl(data.url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Pruebas automáticas</h2>
        <p className="text-slate-500 text-sm">Conecta al equipo, ejecuta las pruebas de la marca elegida, y arma el PDF de evidencia.</p>
      </div>

      <ConnectionPanel
        vendors={vendors} vendorKey={vendorKey} onVendorChange={setVendorKey}
        deviceType={deviceType} onDeviceTypeChange={setDeviceType}
        connection={connection} onConnectionChange={setConnection}
      />

      <div className="card grid grid-cols-3 gap-3">
        <div><label className="label">ID del equipo</label><input className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></div>
        <div><label className="label">Sede</label><input className="input" value={sede} onChange={(e) => setSede(e.target.value)} /></div>
        <div><label className="label">Fecha</label><input className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div><label className="label">Interfaz Uplink (opc.)</label><input className="input" value={uplink} onChange={(e) => setUplink(e.target.value)} /></div>
        <div><label className="label">IP para ping (opc.)</label><input className="input" value={ping} onChange={(e) => setPing(e.target.value)} /></div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Logos para el PDF</h3>
        <div className="flex gap-8">
          <div><p className="label">Izquierda (empresa)</p><ImageUpload onUploaded={(p) => setLogoIzq(p)} /></div>
          <div><p className="label">Derecha (Claro)</p><ImageUpload onUploaded={(p) => setLogoDer(p)} /></div>
        </div>
      </div>

      <div className="flex gap-3">
        <button className="btn-primary" disabled={running} onClick={runTests}>
          {running ? "Ejecutando..." : "① Ejecutar pruebas"}
        </button>
        <button className="btn-secondary" disabled={!result} onClick={generatePdf}>
          ② Generar PDF
        </button>
      </div>

      <LiveLog lines={logs} />

      {pdfUrl && (
        <div className="card bg-green-50 border-green-200">
          <p className="text-sm text-green-700 mb-2">PDF generado correctamente.</p>
          <a className="btn-primary" href={pdfUrl} target="_blank" rel="noreferrer">Descargar PDF</a>
        </div>
      )}
    </div>
  );
}

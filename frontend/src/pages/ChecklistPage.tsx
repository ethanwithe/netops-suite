import { useEffect, useState } from "react";
import { api, runStreaming } from "../api/client";
import ConnectionPanel from "../components/ConnectionPanel";
import ImageUpload from "../components/ImageUpload";
import LiveLog from "../components/LiveLog";
import type { ChecklistItem, Connection, Service, Vendor } from "../types";

type RowState = {
  item: ChecklistItem;
  incluir: boolean;
  modo: "auto" | "manual";
  param: string;
  images: string[];
  output: string | null;
};

export default function ChecklistPage() {
  const [tab, setTab] = useState<"run" | "tools" | "items">("run");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [connection, setConnection] = useState<Connection>({ mode: "ssh", host: "", port: 22, user: "", password: "" });

  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
    reloadServices();
  }, []);

  function reloadServices() {
    api.get("/services").then((r) => setServices(r.data));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">CheckList (estilo Claro)</h2>
        <p className="text-slate-500 text-sm">Cada servicio tiene su propio checklist. Cada ítem puede ser automático o manual.</p>
      </div>
      <div className="flex gap-2">
        <button className={tab === "run" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("run")}>Ejecutar / Generar PDF</button>
        <button className={tab === "tools" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("tools")}>🛠 Herramientas (Speedtest / Ostinato)</button>
        <button className={tab === "items" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("items")}>Ítems (editar)</button>
      </div>
      {tab === "run" && <RunTab vendors={vendors} services={services} rows={rows} setRows={setRows} connection={connection} setConnection={setConnection} />}
      {tab === "tools" && <ToolsTab rows={rows} connection={connection} />}
      {tab === "items" && <ItemsTab services={services} onServiceCreated={reloadServices} />}
    </div>
  );
}

function RunTab({ vendors, services, rows, setRows, connection, setConnection }: {
  vendors: Vendor[]; services: Service[]; rows: RowState[]; setRows: (r: RowState[]) => void;
  connection: Connection; setConnection: (c: Connection) => void;
}) {
  const [servicio, setServicio] = useState("");
  const [titulo, setTitulo] = useState("CheckList de Claro");
  const [sot, setSot] = useState("");
  const [cid, setCid] = useState("");
  const [fecha, setFecha] = useState(new Date().toLocaleDateString("es-PE").toUpperCase());
  const [deviceId, setDeviceId] = useState("");
  const [logo, setLogo] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => { if (services.length && !servicio) setServicio(services[0].clave); }, [services]);
  useEffect(() => { if (servicio) reloadItems(); }, [servicio]);

  async function reloadItems() {
    const { data } = await api.get("/checklist/items", { params: { servicio } });
    setRows(data.map((item: ChecklistItem) => ({
      item, incluir: true, modo: item.modo, param: "", images: [], output: null,
    })));
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows(rows.map((r) => r.item.id === id ? { ...r, ...patch } : r));
  }

  const sections = Array.from(new Set(rows.map((r) => r.item.seccion)));

  function allChecked(sec?: string) {
    const subset = sec ? rows.filter((r) => r.item.seccion === sec) : rows;
    return subset.length > 0 && subset.every((r) => r.incluir);
  }
  function toggleAll(sec: string | undefined, value: boolean) {
    setRows(rows.map((r) => (!sec || r.item.seccion === sec) ? { ...r, incluir: value } : r));
  }

  async function runAuto() {
    const autoItems = rows.filter((r) => r.incluir && r.modo === "auto");
    if (autoItems.length === 0) { alert("No hay ítems automáticos incluidos."); return; }
    setLogs([]);
    setRunning(true);
    runStreaming("/checklist/run", {
      connection,
      items: autoItems.map((r) => ({ item_id: r.item.id, param: r.param })),
    }, (ev) => {
      if (ev.type === "log") setLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") {
        const byId: Record<string, string> = {};
        for (const res of ev.result.results) byId[res.item_id] = res.output;
        setRows(rows.map((r) => byId[r.item.id] !== undefined ? { ...r, output: byId[r.item.id] } : r));
        setRunning(false);
      } else if (ev.type === "error") { setLogs((l) => [...l, "✖ ERROR: " + ev.message]); setRunning(false); }
    });
  }

  async function generatePdf() {
    const included = rows.filter((r) => r.incluir);
    if (included.length === 0) { alert("Marca al menos un ítem."); return; }
    const items = included.map((r) => ({
      nombre: r.item.nombre, seccion: r.item.seccion, modo: r.modo,
      cmd: r.modo === "auto" ? r.item.comando.replace("{PARAM}", r.param) : "",
      output: r.modo === "auto" ? (r.output ?? "(sin ejecutar todavía)") : "",
      image_paths: r.modo === "manual" ? r.images : [],
    }));
    const { data } = await api.post("/checklist/pdf", {
      titulo, servicio_label: services.find((s) => s.clave === servicio)?.etiqueta || servicio,
      sot, cid, fecha, device_id: deviceId, logo_path: logo || null, items,
    });
    setPdfUrl(data.url);
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-2 gap-3">
        <div>
          <label className="label">Servicio</label>
          <select className="input" value={servicio} onChange={(e) => setServicio(e.target.value)}>
            {services.map((s) => <option key={s.clave} value={s.clave}>{s.etiqueta}</option>)}
          </select>
        </div>
        <div><label className="label">Título</label><input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div><label className="label">SOT</label><input className="input" value={sot} onChange={(e) => setSot(e.target.value)} /></div>
        <div><label className="label">CID</label><input className="input" value={cid} onChange={(e) => setCid(e.target.value)} /></div>
        <div><label className="label">Fecha</label><input className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div><label className="label">ID equipo (prompt)</label><input className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} /></div>
        <div><p className="label">Logo (esquina derecha)</p><ImageUpload onUploaded={(p) => setLogo(p)} /></div>
      </div>

      <ConnectionPanel vendors={vendors} vendorKey="cisco_ios" onVendorChange={() => {}}
        connection={connection} onConnectionChange={setConnection} showDeviceType={false} />

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={allChecked()} onChange={(e) => toggleAll(undefined, e.target.checked)} />
        Seleccionar todo
      </label>

      <div className="space-y-4">
        {sections.map((sec) => (
          <div key={sec} className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-brand-700">{sec}</h3>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={allChecked(sec)} onChange={(e) => toggleAll(sec, e.target.checked)} />
                Seleccionar sección
              </label>
            </div>
            <div className="space-y-3">
              {rows.filter((r) => r.item.seccion === sec).map((r) => (
                <div key={r.item.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <input type="checkbox" checked={r.incluir} onChange={(e) => updateRow(r.item.id, { incluir: e.target.checked })} />
                    <span className="text-sm font-medium flex-1 min-w-[220px]">{r.item.nombre}</span>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="radio" checked={r.modo === "auto"} onChange={() => updateRow(r.item.id, { modo: "auto" })} /> Automático
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="radio" checked={r.modo === "manual"} onChange={() => updateRow(r.item.id, { modo: "manual" })} /> Manual
                    </label>
                  </div>
                  {r.modo === "auto" ? (
                    <div className="mt-2 pl-7 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                      Comando: <code className="bg-slate-100 px-1 rounded">{r.item.comando}</code>
                      {r.item.comando.includes("{PARAM}") && (
                        <input className="input w-40 py-1" placeholder="parámetro" value={r.param}
                          onChange={(e) => updateRow(r.item.id, { param: e.target.value })} />
                      )}
                      {r.output && <span className="text-green-600">✔ ejecutado</span>}
                    </div>
                  ) : (
                    <div className="mt-2 pl-7 flex flex-wrap gap-2 items-center">
                      {r.images.map((img, i) => (
                        <span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded">imagen {i + 1} ✔</span>
                      ))}
                      <ImageUpload compact onUploaded={(p) => p && updateRow(r.item.id, { images: [...r.images, p] })} label="+ agregar imagen" />
                      <span className="text-[11px] text-slate-400">(pega con Ctrl+V o arrastra la imagen aquí también)</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button className="btn-primary" disabled={running} onClick={runAuto}>
          {running ? "Ejecutando..." : "① Ejecutar ítems automáticos"}
        </button>
        <button className="btn-secondary" onClick={generatePdf}>② Generar PDF</button>
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

function ToolsTab({ rows, connection }: { rows: RowState[]; connection: Connection }) {
  const [stUrl, setStUrl] = useState("https://fast.com");
  const [stWait, setStWait] = useState(25);
  const [stLogs, setStLogs] = useState<string[]>([]);
  const [stRunning, setStRunning] = useState(false);
  const [stResult, setStResult] = useState<{ path: string; url: string } | null>(null);
  const [stTargetItemId, setStTargetItemId] = useState("");

  const manualItems = rows.filter((r) => r.modo === "manual");

  function runSpeedtest() {
    setStLogs([]); setStRunning(true); setStResult(null);
    runStreaming("/tools/speedtest", { url: stUrl, wait_seconds: stWait }, (ev) => {
      if (ev.type === "log") setStLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setStResult(ev.result); setStRunning(false); }
      else if (ev.type === "error") { setStLogs((l) => [...l, "✖ ERROR: " + ev.message]); setStRunning(false); }
    });
  }

  function attachSpeedtestToItem() {
    if (!stResult || !stTargetItemId) return;
    const row = rows.find((r) => r.item.id === stTargetItemId);
    if (row) row.images = [...row.images, stResult.path];
    alert("Captura asignada al ítem. Ve a 'Ejecutar / Generar PDF' para verla.");
  }

  const [osCmd, setOsCmd] = useState("");
  const [osWait, setOsWait] = useState(60);
  const [osWanCmd, setOsWanCmd] = useState("show policy-map interface GigabitEthernet0/0/0");
  const [osSupCmd, setOsSupCmd] = useState("");
  const [osLogs, setOsLogs] = useState<string[]>([]);
  const [osRunning, setOsRunning] = useState(false);
  const [osResult, setOsResult] = useState<{ wan_output: string; sup_output: string | null } | null>(null);
  const [osWanItemId, setOsWanItemId] = useState("");
  const [osSupItemId, setOsSupItemId] = useState("");

  function runOstinato() {
    if (!osCmd || !osWanCmd) { alert("Completa al menos el comando de Ostinato y el comando WAN."); return; }
    setOsLogs([]); setOsRunning(true); setOsResult(null);
    runStreaming("/tools/ostinato-saturacion", {
      connection, ostinato_start_cmd: osCmd, wait_seconds: osWait,
      wan_cmd: osWanCmd, sup_cmd: osSupCmd || null,
    }, (ev) => {
      if (ev.type === "log") setOsLogs((l) => [...l, ev.message]);
      else if (ev.type === "done") { setOsResult(ev.result); setOsRunning(false); }
      else if (ev.type === "error") { setOsLogs((l) => [...l, "✖ ERROR: " + ev.message]); setOsRunning(false); }
    });
  }

  function attachOstinatoResults() {
    if (osResult && osWanItemId) {
      const row = rows.find((r) => r.item.id === osWanItemId);
      if (row) row.output = osResult.wan_output;
    }
    if (osResult?.sup_output && osSupItemId) {
      const row = rows.find((r) => r.item.id === osSupItemId);
      if (row) row.output = osResult.sup_output;
    }
    alert("Resultados asignados a los ítems automáticos elegidos. Ve a 'Ejecutar / Generar PDF' para verlos (marca esos ítems como Automático).");
  }

  return (
    <div className="space-y-8">
      <div className="card space-y-3">
        <h3 className="font-semibold text-slate-800">🚀 Speedtest automático (Chrome en segundo plano)</h3>
        <p className="text-xs text-slate-500">
          El backend abre un Chrome headless, corre el test en una página real, espera a que termine, y devuelve
          la captura de pantalla del resultado — lista para usarla como evidencia de saturación / velocidad.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">URL del speedtest</label><input className="input" value={stUrl} onChange={(e) => setStUrl(e.target.value)} /></div>
          <div><label className="label">Segundos de espera</label><input className="input" type="number" value={stWait} onChange={(e) => setStWait(Number(e.target.value))} /></div>
        </div>
        <button className="btn-primary" disabled={stRunning} onClick={runSpeedtest}>
          {stRunning ? "Ejecutando..." : "Ejecutar speedtest"}
        </button>
        <LiveLog lines={stLogs} />
        {stResult && (
          <div className="flex items-center gap-3">
            <img src={stResult.url} alt="resultado" className="w-40 rounded border border-slate-200" />
            <div className="flex-1 flex items-center gap-2">
              <select className="input" value={stTargetItemId} onChange={(e) => setStTargetItemId(e.target.value)}>
                <option value="">-- asignar a ítem manual... --</option>
                {manualItems.map((r) => <option key={r.item.id} value={r.item.id}>{r.item.nombre}</option>)}
              </select>
              <button className="btn-secondary" onClick={attachSpeedtestToItem}>Asignar</button>
            </div>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-slate-800">📡 Ostinato + captura de saturación (con espera)</h3>
        <p className="text-xs text-slate-500">
          Arranca el tráfico de Ostinato, espera el tiempo que definas (para que la saturación suba hasta el
          ancho de banda del servicio), y recién entonces captura en el router — WAN y, si quieres, SUP debajo.
          La conexión al equipo usa la que configuraste en la pestaña "Ejecutar".
        </p>
        <div>
          <label className="label">Comando que arranca el tráfico de Ostinato (en el servidor del backend)</label>
          <input className="input" placeholder="ej. python3 /ruta/mi_stream_ostinato.py" value={osCmd} onChange={(e) => setOsCmd(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Segundos de espera</label><input className="input" type="number" value={osWait} onChange={(e) => setOsWait(Number(e.target.value))} /></div>
          <div><label className="label">Comando de captura WAN</label><input className="input" value={osWanCmd} onChange={(e) => setOsWanCmd(e.target.value)} /></div>
          <div><label className="label">Comando de captura SUP (opcional)</label><input className="input" value={osSupCmd} onChange={(e) => setOsSupCmd(e.target.value)} /></div>
        </div>
        <button className="btn-primary" disabled={osRunning} onClick={runOstinato}>
          {osRunning ? "Ejecutando..." : "Iniciar Ostinato + esperar + capturar"}
        </button>
        <LiveLog lines={osLogs} />
        {osResult && (
          <div className="space-y-2">
            <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap">{osResult.wan_output}</pre>
            {osResult.sup_output && (
              <pre className="bg-slate-900 text-slate-200 text-xs p-3 rounded-lg whitespace-pre-wrap">{osResult.sup_output}</pre>
            )}
            <div className="flex gap-2 items-center flex-wrap">
              <select className="input" value={osWanItemId} onChange={(e) => setOsWanItemId(e.target.value)}>
                <option value="">-- ítem para la captura WAN --</option>
                {rows.map((r) => <option key={r.item.id} value={r.item.id}>{r.item.nombre}</option>)}
              </select>
              {osResult.sup_output && (
                <select className="input" value={osSupItemId} onChange={(e) => setOsSupItemId(e.target.value)}>
                  <option value="">-- ítem para la captura SUP --</option>
                  {rows.map((r) => <option key={r.item.id} value={r.item.id}>{r.item.nombre}</option>)}
                </select>
              )}
              <button className="btn-secondary" onClick={attachOstinatoResults}>Asignar resultados</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemsTab({ services, onServiceCreated }: { services: Service[]; onServiceCreated: () => void }) {
  const [servicio, setServicio] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [selected, setSelected] = useState<ChecklistItem | null>(null);

  const [seccion, setSeccion] = useState("");
  const [nombre, setNombre] = useState("");
  const [orden, setOrden] = useState(10);
  const [modo, setModo] = useState<"auto" | "manual">("auto");
  const [comando, setComando] = useState("");

  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => { if (services.length && !servicio) setServicio(services[0].clave); }, [services]);
  useEffect(() => { if (servicio) reload(); }, [servicio]);

  function reload() {
    api.get("/checklist/items", { params: { servicio } }).then((r) => setItems(r.data));
  }

  function select(it: ChecklistItem) {
    setSelected(it); setSeccion(it.seccion); setNombre(it.nombre);
    setOrden(it.orden); setModo(it.modo); setComando(it.comando);
  }

  function clear() {
    setSelected(null); setSeccion(""); setNombre(""); setOrden(10); setModo("auto"); setComando("");
  }

  async function save() {
    if (!seccion || !nombre) { alert("Completa sección y nombre."); return; }
    const payload = { servicio, seccion, nombre, orden, modo, comando: modo === "auto" ? comando : "" };
    if (selected) await api.put(`/checklist/items/${selected.id}`, payload);
    else await api.post("/checklist/items", payload);
    reload();
    alert("Ítem guardado.");
  }

  async function del(it: ChecklistItem) {
    if (!confirm(`¿Eliminar '${it.nombre}'?`)) return;
    await api.delete(`/checklist/items/${it.id}`);
    clear(); reload();
  }

  async function createService() {
    if (!newKey.trim() || !newLabel.trim()) return;
    await api.post("/services", { clave: newKey.trim().toLowerCase(), etiqueta: newLabel.trim() });
    setNewKey(""); setNewLabel("");
    onServiceCreated();
  }

  return (
    <div className="space-y-4">
      <div className="card flex gap-3 items-end">
        <div>
          <label className="label">Nuevo servicio — clave</label>
          <input className="input" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        </div>
        <div>
          <label className="label">Etiqueta</label>
          <input className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={createService}>+ crear servicio</button>
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-6">
        <div className="space-y-3">
          <select className="input" value={servicio} onChange={(e) => setServicio(e.target.value)}>
            {services.map((s) => <option key={s.clave} value={s.clave}>{s.etiqueta}</option>)}
          </select>
          <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {items.map((it) => (
              <button key={it.id} onClick={() => select(it)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${selected?.id === it.id ? "bg-brand-50" : ""}`}>
                <div className="font-medium text-slate-700">{it.nombre}</div>
                <div className="text-xs text-slate-400">[{it.seccion.slice(0, 24)}] orden {it.orden}</div>
              </button>
            ))}
          </div>
          <button className="btn-secondary w-full" onClick={clear}>+ Nuevo ítem</button>
        </div>

        <div className="card space-y-4">
          <div><label className="label">Sección</label><input className="input" value={seccion} onChange={(e) => setSeccion(e.target.value)} /></div>
          <div><label className="label">Nombre del ítem</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className="label">Orden</label><input className="input" type="number" value={orden} onChange={(e) => setOrden(Number(e.target.value))} /></div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={modo === "auto"} onChange={() => setModo("auto")} /> Automático</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={modo === "manual"} onChange={() => setModo("manual")} /> Manual</label>
          </div>
          {modo === "auto" && (
            <div>
              <label className="label">Comando (usa {"{PARAM}"} para un dato variable)</label>
              <input className="input" value={comando} onChange={(e) => setComando(e.target.value)} />
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>💾 Guardar</button>
            {selected && <button className="btn-danger" onClick={() => del(selected)}>🗑 Eliminar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

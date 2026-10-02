import { useEffect, useState } from "react";
import { api } from "../api/client";
import ImageUpload from "../components/ImageUpload";
import ImageAnnotator from "../components/ImageAnnotator";
import type { PhotoItem } from "../types";

type Lado = "site" | "pdi" | "pop" | "cliente";
type TipoInstalacion = "gpon_ont" | "gpon_modulo" | "fibra_convencional";

type RowState = {
  item: PhotoItem;
  incluir: boolean;
  descripcion: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
};

type SavedRowState = {
  id: string;
  incluir: boolean;
  descripcion: string;
  imagePath: string;
  imageUrl: string;
  lado: Lado;
};

type DraftState = {
  titulo: string;
  proy: string;
  cliente: string;
  sot: string;
  fecha: string;
  cid: string;
  contrata: string;
  rows: SavedRowState[];
};

type LogoState = {
  logoIzq: string;
  logoIzqUrl: string;
  logoDer: string;
  logoDerUrl: string;
};

const LOGOS_STORAGE_KEY = "fotografico_logos_v1";

function draftStorageKey(tipo: TipoInstalacion) {
  return `fotografico_draft_v1_${tipo}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getTipoLabel(tipo: TipoInstalacion) {
  if (tipo === "gpon_ont") return "GPON CON ONT";
  if (tipo === "gpon_modulo") return "GPON CON MÓDULO";
  return "FIBRA CONVENCIONAL";
}

function defaultTitle() {
  return "REPORTE FOTOGRAFICO INSTALACION DE FIBRA";
}

export default function FotograficoPage() {
  const [tab, setTab] = useState<"run" | "items">("run");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [tipoInstalacion, setTipoInstalacion] =
    useState<TipoInstalacion | "">("");

  useEffect(() => {
    api.get("/photos/items").then((r) => setItems(r.data));
  }, []);

  if (!tipoInstalacion) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card space-y-5">
          <h2 className="text-2xl font-bold text-slate-800">
            Reporte Fotográfico
          </h2>

          <select
            className="input"
            onChange={(e) =>
              setTipoInstalacion(e.target.value as TipoInstalacion)
            }
          >
            <option value="">Seleccionar...</option>
            <option value="gpon_ont">GPON CON ONT</option>
            <option value="gpon_modulo">GPON CON MÓDULO</option>
            <option value="fibra_convencional">FIBRA CONVENCIONAL</option>
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h2 className="text-2xl font-bold">Reporte Fotográfico</h2>

        <button
          className="btn-secondary"
          onClick={() => setTipoInstalacion("")}
        >
          Cambiar tipo
        </button>
      </div>

      <div className="flex gap-2">
        <button
          className={tab === "run" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("run")}
        >
          Generar
        </button>

        <button
          className={tab === "items" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("items")}
        >
          Editar
        </button>
      </div>

      {tab === "run" ? (
        <RunTab items={items} tipoInstalacion={tipoInstalacion} />
      ) : (
        <ItemsTab items={items} onChange={() => {}} />
      )}
    </div>
  );
}

/* ============================================================
   RUN TAB (PERSISTENCIA COMPLETA)
============================================================ */

function RunTab({
  items,
  tipoInstalacion,
}: {
  items: PhotoItem[];
  tipoInstalacion: TipoInstalacion;
}) {
  const draftKey = draftStorageKey(tipoInstalacion);

  const savedDraft = readJson<DraftState>(draftKey, {
    titulo: defaultTitle(),
    proy: "",
    cliente: "",
    sot: "",
    fecha: "",
    cid: "",
    contrata: "",
    rows: [],
  });

  const savedLogos = readJson<LogoState>(LOGOS_STORAGE_KEY, {
    logoIzq: "",
    logoIzqUrl: "",
    logoDer: "",
    logoDerUrl: "",
  });

  const [hydrated, setHydrated] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [rowsReady, setRowsReady] = useState(false);

  const [titulo, setTitulo] = useState(savedDraft.titulo);
  const [proy, setProy] = useState(savedDraft.proy);
  const [cliente, setCliente] = useState(savedDraft.cliente);
  const [sot, setSot] = useState(savedDraft.sot);
  const [fecha, setFecha] = useState(savedDraft.fecha);
  const [cid, setCid] = useState(savedDraft.cid);
  const [contrata, setContrata] = useState(savedDraft.contrata);

  const [logoIzq, setLogoIzq] = useState(savedLogos.logoIzq);
  const [logoIzqUrl, setLogoIzqUrl] = useState(savedLogos.logoIzqUrl);
  const [logoDer, setLogoDer] = useState(savedLogos.logoDer);
  const [logoDerUrl, setLogoDerUrl] = useState(savedLogos.logoDerUrl);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  /* =============================
     HYDRATE ROWS (NO RESET)
  ============================== */

  useEffect(() => {
    if (!items.length) return;

    const map = new Map(
      savedDraft.rows.map((r) => [r.id, r])
    );

    const initial = items.map((item) => {
      const s = map.get(item.id);

      return {
        item,
        incluir: s?.incluir ?? false,
        descripcion: s?.descripcion ?? item.nombre,
        imagePath: s?.imagePath ?? "",
        imageUrl: s?.imageUrl ?? "",
        lado: s?.lado ?? "cliente",
      };
    });

    setRows(initial);
    setRowsReady(true);
    setHydrated(true);
  }, [items, tipoInstalacion]);

  /* =============================
     AUTO SAVE
  ============================== */

  useEffect(() => {
    if (!rowsReady || !hydrated) return;

    const data: DraftState = {
      titulo,
      proy,
      cliente,
      sot,
      fecha,
      cid,
      contrata,
      rows: rows.map((r) => ({
        id: r.item.id,
        incluir: r.incluir,
        descripcion: r.descripcion,
        imagePath: r.imagePath,
        imageUrl: r.imageUrl,
        lado: r.lado,
      })),
    };

    localStorage.setItem(draftKey, JSON.stringify(data));
  }, [
    hydrated,
    rowsReady,
    rows,
    titulo,
    proy,
    cliente,
    sot,
    fecha,
    cid,
    contrata,
  ]);

  /* =============================
     LOGOS SAVE
  ============================== */

  useEffect(() => {
    localStorage.setItem(
      LOGOS_STORAGE_KEY,
      JSON.stringify({
        logoIzq,
        logoIzqUrl,
        logoDer,
        logoDerUrl,
      })
    );
  }, [logoIzq, logoIzqUrl, logoDer, logoDerUrl]);

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) =>
        r.item.id === id ? { ...r, ...patch } : r
      )
    );
  }

  async function generate() {
    const selected = rows.filter((r) => r.incluir);

    if (!selected.length) {
      alert("Selecciona al menos una foto");
      return;
    }

    const payload = selected.map((r, i) => ({
      numero: i + 1,
      descripcion: r.descripcion,
      image_path: r.imagePath || null,
      lado: r.lado,
    }));

    const { data } = await api.post("/photos/pdf", {
      titulo,
      proy,
      cliente,
      sot,
      fecha,
      cid,
      contrata,
      logo_izq_path: logoIzq || null,
      logo_der_path: logoDer || null,
      items: payload,
    });

    setPdfUrl(data.url);
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          className="input"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />

        <input className="input" value={proy} onChange={(e) => setProy(e.target.value)} />
        <input className="input" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        <input className="input" value={sot} onChange={(e) => setSot(e.target.value)} />
      </div>

      <button className="btn-primary" onClick={generate}>
        Generar PDF
      </button>

      {pdfUrl && (
        <a className="btn-secondary" href={pdfUrl} target="_blank">
          Descargar PDF
        </a>
      )}
    </div>
  );
}

/* ============================================================
   ITEMS TAB (SE MANTIENE IGUAL)
============================================================ */

function ItemsTab({
  items,
}: {
  items: PhotoItem[];
  onChange: () => void;
}) {
  return (
    <div className="card">
      <p>Editor de items (sin cambios)</p>
    </div>
  );
}

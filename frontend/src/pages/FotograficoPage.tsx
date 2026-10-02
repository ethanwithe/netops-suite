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

function defaultTitle() {
  return "REPORTE FOTOGRAFICO INSTALACION DE FIBRA";
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

export default function FotograficoPage() {
  const [tab, setTab] = useState<"run" | "items">("run");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [tipoInstalacion, setTipoInstalacion] =
    useState<TipoInstalacion | "">("");

  useEffect(() => {
    reload();
  }, []);

  function reload() {
    api.get("/photos/items").then((r) => setItems(r.data));
  }

  if (!tipoInstalacion) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              Reporte Fotográfico
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Selecciona primero el tipo de instalación.
            </p>
          </div>

          <div>
            <label className="label">Tipo de instalación</label>
            <select
              className="input"
              defaultValue=""
              onChange={(e) =>
                setTipoInstalacion(e.target.value as TipoInstalacion)
              }
            >
              <option value="" disabled>
                Seleccionar...
              </option>
              <option value="gpon_ont">GPON CON ONT</option>
              <option value="gpon_modulo">GPON CON MÓDULO</option>
              <option value="fibra_convencional">FIBRA CONVENCIONAL</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Reporte Fotográfico
          </h2>

          <p className="text-slate-500 text-sm">
            EQUIPOS INSTALADOS ACCESO, ETIQUETADO, RECORRIDO EN ACCESO, VISTA
            GENERAL UBICACION DE EQUIPOS, EQUIPOS LADO CLIENTE, ETIQUETADO
            CLIENTE, VISTA INSTALACION EN GABINETE, RECORRIDO CLIENTE, VISTA
            INSTALACION DE EQUIPOS, MULTIMETRO, QR.
          </p>

          <p className="mt-2 text-xs font-semibold text-brand-700">
            Tipo: {getTipoLabel(tipoInstalacion)}
          </p>
        </div>

        <button
          className="btn-secondary shrink-0"
          onClick={() => setTipoInstalacion("")}
        >
          Cambiar tipo
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          className={tab === "run" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("run")}
        >
          Generar reporte
        </button>

        <button
          className={tab === "items" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("items")}
        >
          Descripciones (editar)
        </button>
      </div>

      {tab === "run" ? (
        <RunTab items={items} tipoInstalacion={tipoInstalacion} />
      ) : (
        <ItemsTab items={items} onChange={reload} />
      )}
    </div>
  );
}

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
    fecha: new Date().toLocaleDateString("es-PE"),
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

  const [rows, setRows] = useState<RowState[]>([]);
  const [rowsReady, setRowsReady] = useState(false);

  const [titulo, setTitulo] = useState(savedDraft.titulo || defaultTitle());
  const [proy, setProy] = useState(savedDraft.proy || "");
  const [cliente, setCliente] = useState(savedDraft.cliente || "");
  const [sot, setSot] = useState(savedDraft.sot || "");
  const [fecha, setFecha] = useState(
    savedDraft.fecha || new Date().toLocaleDateString("es-PE")
  );
  const [cid, setCid] = useState(savedDraft.cid || "");
  const [contrata, setContrata] = useState(savedDraft.contrata || "");

  const [logoIzq, setLogoIzq] = useState(savedLogos.logoIzq || "");
  const [logoIzqUrl, setLogoIzqUrl] = useState(savedLogos.logoIzqUrl || "");
  const [logoDer, setLogoDer] = useState(savedLogos.logoDer || "");
  const [logoDerUrl, setLogoDerUrl] = useState(savedLogos.logoDerUrl || "");

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<RowState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    if (items.length === 0) return;

    const savedRows = new Map(
      savedDraft.rows.map((row) => [row.id, row])
    );

    setRows(
      items.map((item) => {
        const saved = savedRows.get(item.id);

        return {
          item,
          incluir: saved?.incluir ?? false,
          descripcion: saved?.descripcion ?? item.nombre,
          imagePath: saved?.imagePath ?? "",
          imageUrl: saved?.imageUrl ?? "",
          lado: saved?.lado ?? "cliente",
        };
      })
    );

    setRowsReady(true);
  }, [items, tipoInstalacion]);

  useEffect(() => {
    if (!rowsReady) return;

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
    rowsReady,
    draftKey,
    titulo,
    proy,
    cliente,
    sot,
    fecha,
    cid,
    contrata,
    rows,
  ]);

  useEffect(() => {
    const data: LogoState = {
      logoIzq,
      logoIzqUrl,
      logoDer,
      logoDerUrl,
    };

    localStorage.setItem(LOGOS_STORAGE_KEY, JSON.stringify(data));
  }, [logoIzq, logoIzqUrl, logoDer, logoDerUrl]);

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) =>
        r.item.id === id
          ? { ...r, ...patch }
          : r
      )
    );
  }

  const categorias = Array.from(
    new Set(rows.map((r) => r.item.categoria))
  );

  function allChecked(cat?: string) {
    const subset = cat
      ? rows.filter((r) => r.item.categoria === cat)
      : rows;

    return (
      subset.length > 0 &&
      subset.every((r) => r.incluir)
    );
  }

  function toggleAll(
    cat: string | undefined,
    value: boolean
  ) {
    setRows((prev) =>
      prev.map((r) =>
        !cat || r.item.categoria === cat
          ? { ...r, incluir: value }
          : r
      )
    );
  }

  function onDragStart(id: string) {
    setDragId(id);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(
    targetId: string,
    cat: string
  ) {
    if (!dragId || dragId === targetId) return;

    setRows((prev) => {
      const catRows = prev.filter(
        (r) => r.item.categoria === cat
      );

      const others = prev.filter(
        (r) => r.item.categoria !== cat
      );

      const fromIdx = catRows.findIndex(
        (r) => r.item.id === dragId
      );

      const toIdx = catRows.findIndex(
        (r) => r.item.id === targetId
      );

      if (fromIdx === -1 || toIdx === -1) {
        return prev;
      }

      const reordered = [...catRows];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      reordered.forEach((r, i) => {
        const nuevoOrden = (i + 1) * 10;

        if (nuevoOrden !== r.item.orden) {
          api
            .put(`/photos/items/${r.item.id}`, {
              categoria: r.item.categoria,
              nombre: r.item.nombre,
              orden: nuevoOrden,
            })
            .catch(() => {});

          r.item.orden = nuevoOrden;
        }
      });

      return [
        ...others,
        ...reordered,
      ].sort((a, b) =>
        a.item.categoria === b.item.categoria
          ? a.item.orden - b.item.orden
          : 0
      );
    });

    setDragId(null);
  }

  async function generate() {
    const selected = rows.filter(
      (r) => r.incluir
    );

    if (selected.length === 0) {
      alert("Marca al menos un ítem.");
      return;
    }

    const sinImagen = selected.filter(
      (r) => !r.imagePath
    );

    if (
      sinImagen.length > 0 &&
      !confirm(
        `${sinImagen.length} ítem(s) sin foto todavía. ¿Generar de todas formas?`
      )
    ) {
      return;
    }

    const payloadItems = selected.map(
      (r, i) => ({
        numero: i + 1,
        descripcion: r.descripcion,
        image_path: r.imagePath || null,
        lado: r.lado,
      })
    );

    const { data } = await api.post(
      "/photos/pdf",
      {
        titulo,
        proy,
        cliente,
        sot,
        fecha,
        cid,
        contrata,
        logo_izq_path: logoIzq || null,
        logo_der_path: logoDer || null,
        items: payloadItems,
      }
    );

    setPdfUrl(data.url);
  }

  function clearDraft() {
    if (
      !confirm(
        "¿Limpiar los datos, selecciones y fotografías guardadas de este tipo de reporte?"
      )
    ) {
      return;
    }

    localStorage.removeItem(draftKey);
    window.location.reload();
  }

  return (
    <div className="space-y-6">
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">
            Título
          </label>

          <input
            className="input"
            value={titulo}
            onChange={(e) =>
              setTitulo(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            PROY
          </label>

          <input
            className="input"
            value={proy}
            onChange={(e) =>
              setProy(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            CLIENTE
          </label>

          <input
            className="input"
            value={cliente}
            onChange={(e) =>
              setCliente(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            SOT
          </label>

          <input
            className="input"
            value={sot}
            onChange={(e) =>
              setSot(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            FECHA
          </label>

          <input
            className="input"
            value={fecha}
            onChange={(e) =>
              setFecha(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            CID
          </label>

          <input
            className="input"
            value={cid}
            onChange={(e) =>
              setCid(e.target.value)
            }
          />
        </div>

        <div>
          <label className="label">
            CONTRATA
          </label>

          <input
            className="input"
            value={contrata}
            onChange={(e) =>
              setContrata(e.target.value)
            }
          />
        </div>

        <div className="space-y-2">
          <p className="label">
            Logo izquierda (empresa)
          </p>

          <ImageUpload
            initialUrl={logoIzqUrl}
            onUploaded={(p, u) => {
              setLogoIzq(p);
              setLogoIzqUrl(u || "");
            }}
          />

          {logoIzq && (
            <button
              type="button"
              className="btn-danger w-full sm:w-auto"
              onClick={() => {
                setLogoIzq("");
                setLogoIzqUrl("");
              }}
            >
              Quitar logo
            </button>
          )}
        </div>

        <div className="space-y-2">
          <p className="label">
            Logo derecha (Claro)
          </p>

          <ImageUpload
            initialUrl={logoDerUrl}
            onUploaded={(p, u) => {
              setLogoDer(p);
              setLogoDerUrl(u || "");
            }}
          />

          {logoDer && (
            <button
              type="button"
              className="btn-danger w-full sm:w-auto"
              onClick={() => {
                setLogoDer("");
                setLogoDerUrl("");
              }}
            >
              Quitar logo
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={allChecked()}
            onChange={(e) =>
              toggleAll(
                undefined,
                e.target.checked
              )
            }
          />

          Seleccionar todo
        </label>

        <button
          type="button"
          className="btn-danger w-full sm:w-auto"
          onClick={clearDraft}
        >
          Limpiar reporte actual
        </button>
      </div>

      <div className="space-y-4">
        {categorias.map((cat) => (
          <div
            key={cat}
            className="card"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-brand-700 uppercase">
                {cat}
              </h3>

              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={allChecked(cat)}
                  onChange={(e) =>
                    toggleAll(
                      cat,
                      e.target.checked
                    )
                  }
                />

                Seleccionar sección
              </label>
            </div>

            <div className="space-y-2">
              {rows
                .filter(
                  (r) =>
                    r.item.categoria === cat
                )
                .map((r) => (
                  <div
                    key={r.item.id}
                    draggable
                    onDragStart={() =>
                      onDragStart(
                        r.item.id
                      )
                    }
                    onDragOver={onDragOver}
                    onDrop={() =>
                      onDrop(
                        r.item.id,
                        cat
                      )
                    }
                    className={`border rounded-lg p-3 grid grid-cols-[auto_1fr] sm:flex sm:items-center gap-3 cursor-move transition-colors ${
                      dragId === r.item.id
                        ? "opacity-50"
                        : "border-slate-100"
                    }`}
                  >
                    <span
                      className="text-slate-300 select-none"
                      title="Arrastra para reordenar"
                    >
                      ⠿
                    </span>

                    <input
                      type="checkbox"
                      checked={r.incluir}
                      onChange={(e) =>
                        updateRow(
                          r.item.id,
                          {
                            incluir:
                              e.target.checked,
                          }
                        )
                      }
                    />

                    <input
                      className="input col-span-2 sm:flex-1 sm:min-w-[220px]"
                      value={r.descripcion}
                      onChange={(e) =>
                        updateRow(
                          r.item.id,
                          {
                            descripcion:
                              e.target.value,
                          }
                        )
                      }
                    />

                    <select
                      className="input col-span-2 sm:w-32"
                      value={r.lado}
                      onChange={(e) =>
                        updateRow(
                          r.item.id,
                          {
                            lado:
                              e.target
                                .value as Lado,
                          }
                        )
                      }
                    >
                      <option value="site">
                        SITE
                      </option>

                      <option value="pdi">
                        PDI
                      </option>

                      <option value="pop">
                        POP
                      </option>

                      <option value="cliente">
                        CLIENTE
                      </option>
                    </select>

                    <div className="col-span-2 sm:col-span-1 min-w-0">
                      <ImageUpload
                        compact
                        initialUrl={r.imageUrl}
                        onUploaded={(
                          p,
                          u
                        ) =>
                          updateRow(
                            r.item.id,
                            {
                              imagePath: p,
                              imageUrl: u,
                            }
                          )
                        }
                      />
                    </div>

                    {r.imagePath && (
                      <button
                        className="btn-secondary text-xs col-span-2 sm:col-span-1"
                        onClick={() =>
                          setEditing(r)
                        }
                      >
                        ✏️ Editar (líneas punteadas)
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-primary w-full sm:w-auto"
        onClick={generate}
      >
        Generar PDF
      </button>

      {pdfUrl && (
        <div className="card bg-green-50 border-green-200">
          <p className="text-sm text-green-700 mb-2">
            PDF generado correctamente.
          </p>

          <a
            className="btn-primary w-full sm:w-auto"
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
          >
            Descargar PDF
          </a>
        </div>
      )}

      {editing && (
        <ImageAnnotator
          imageUrl={editing.imageUrl}
          onClose={() =>
            setEditing(null)
          }
          onSaved={(p, u) =>
            updateRow(
              editing.item.id,
              {
                imagePath: p,
                imageUrl: u,
              }
            )
          }
        />
      )}
    </div>
  );
}

function ItemsTab({
  items,
  onChange,
}: {
  items: PhotoItem[];
  onChange: () => void;
}) {
  const [selected, setSelected] =
    useState<PhotoItem | null>(null);

  const [categoria, setCategoria] =
    useState("");

  const [nombre, setNombre] =
    useState("");

  const [orden, setOrden] =
    useState(10);

  function select(it: PhotoItem) {
    setSelected(it);
    setCategoria(it.categoria);
    setNombre(it.nombre);
    setOrden(it.orden);
  }

  function clear() {
    setSelected(null);
    setCategoria("");
    setNombre("");
    setOrden(10);
  }

  async function save() {
    if (!nombre.trim()) {
      alert(
        "Escribe la descripción."
      );
      return;
    }

    if (!categoria.trim()) {
      alert(
        "Escribe la categoría."
      );
      return;
    }

    const payload = {
      categoria: categoria.trim(),
      nombre: nombre.trim(),
      orden: Number(orden),
    };

    if (selected) {
      await api.put(
        `/photos/items/${selected.id}`,
        payload
      );
    } else {
      await api.post(
        "/photos/items",
        payload
      );
    }

    clear();
    onChange();
  }

  async function del(it: PhotoItem) {
    if (
      !confirm(
        `¿Eliminar '${it.nombre}'?`
      )
    ) {
      return;
    }

    await api.delete(
      `/photos/items/${it.id}`
    );

    clear();
    onChange();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="space-y-3">

        <div className="card p-0 divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() =>
                select(it)
              }
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                selected?.id === it.id
                  ? "bg-brand-50"
                  : ""
              }`}
            >
              <div className="font-medium text-slate-700">
                {it.nombre}
              </div>

              <div className="text-xs text-slate-400">
                [{it.categoria}] orden{" "}
                {it.orden}
              </div>
            </button>
          ))}
        </div>

        <button
          className="btn-secondary w-full"
          onClick={clear}
        >
          + Nueva descripción
        </button>
      </div>

      <div className="card space-y-4">

        <div>
          <label className="label">
            Categoría
          </label>

          <input
            className="input"
            value={categoria}
            onChange={(e) =>
              setCategoria(
                e.target.value
              )
            }
            list="categorias-list"
          />

          {/* CATEGORÍAS NUEVAS */}
          <datalist id="categorias-list">
            <option value="EQUIPOS INSTALADOS ACCESO" />
            <option value="ETIQUETADO" />
            <option value="RECORRIDO EN ACCESO" />
            <option value="VISTA GENERAL UBICACION DE EQUIPOS" />
            <option value="EQUIPOS LADO CLIENTE" />
            <option value="ETIQUETADO CLIENTE" />
            <option value="VISTA INSTALACION EN GABINETE" />
            <option value="RECORRIDO CLIENTE" />
            <option value="VISTA INSTALACION DE EQUIPOS" />
            <option value="MULTIMETRO" />
            <option value="QR" />
          </datalist>
        </div>

        <div>
          <label className="label">
            Descripción
          </label>

          <input
            className="input"
            value={nombre}
            onChange={(e) =>
              setNombre(
                e.target.value
              )
            }
          />
        </div>

        <div>
          <label className="label">
            Orden
          </label>

          <input
            className="input"
            type="number"
            value={orden}
            onChange={(e) =>
              setOrden(
                Number(e.target.value)
              )
            }
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            className="btn-primary"
            onClick={save}
          >
            💾 Guardar
          </button>

          {selected && (
            <button
              className="btn-danger"
              onClick={() =>
                del(selected)
              }
            >
              🗑 Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

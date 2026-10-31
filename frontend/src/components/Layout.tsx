import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import WindowEditor from "./WindowEditor";
import { createWindow, usePhotoWindows, windowRoute } from "../store/photoWindows";
import { createYear, listYears } from "../store/clients";
import NewChecklistModal from "./NewChecklistModal";
import { checklistRoute, createChecklistType, useChecklistTypes } from "../store/checklistTypes";
import { usePersistentState } from "../store/persistentState";

const NAV = [
  { to: "/pruebas", label: "Pruebas", icon: "🔌", desc: "SSH/Serial + PDF" },
  { to: "/plantillas", label: "Plantillas", icon: "📝", desc: "Crear y aplicar" },
];

const FOTO_SUB = [
  { to: "/fotografico/gpon-ont", label: "GPON con ONT" },
  { to: "/fotografico/gpon-modulo", label: "GPON con módulo" },
  { to: "/fotografico/fibra", label: "Fibra convencional" },
  { to: "/fotografico/poder-judicial", label: "RF Poder Judicial" },
];

const TITLES: Record<string, string> = {
  "/pruebas": "Pruebas",
  "/plantillas": "Plantillas",
  "/checklist": "CheckList",
  ...Object.fromEntries(FOTO_SUB.map((o) => [o.to, o.label])),
};

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { list: custom } = usePhotoWindows();
  const [creating, setCreating] = useState(false);
  const { list: ckTypes } = useChecklistTypes();
  const [creatingCk, setCreatingCk] = useState(false);
  const inCl = pathname.startsWith("/clientes");
  const [clOpen, setClOpen] = useState(inCl);
  const clShown = clOpen || inCl;
  const [years, setYears] = useState<{ year: number; total: number }[]>([{ year: new Date().getFullYear(), total: 0 }]);
  const loadYears = () => listYears().then((y) => setYears([...y].sort((a, b) => b.year - a.year))).catch(() => {});
  useEffect(() => { void loadYears(); }, [pathname]);
  async function newYear() {
    const txt = prompt("¿Qué año quieres crear? (se crean solos sus 12 meses)", String(Math.max(...years.map((y) => y.year)) + 1));
    const y = Number(txt);
    if (!txt || !Number.isInteger(y)) return;
    try {
      await createYear(y);
      await loadYears();
      navigate(`/clientes/${y}`);
    } catch {
      alert("No se pudo crear el año (debe estar entre 2000 y 2100).");
    }
  }
  const inCk = pathname.startsWith("/checklist");
  const [ckOpen, setCkOpen] = useState(inCk);
  const ckShown = ckOpen || inCk;
  const ckSub = [
    ...ckTypes.map((t) => ({ to: checklistRoute(t.id), label: t.nombre })),
    { to: "/checklist/saturador", label: "🚀 Saturador" },
  ];
  const fotoSub = [
    ...FOTO_SUB,
    ...custom.map((w) => ({ to: windowRoute(w.id), label: w.nombre })),
  ];
  const titles: Record<string, string> = { ...TITLES, "/clientes": "Datos de clientes", ...Object.fromEntries(years.map((y) => [`/clientes/${y.year}`, `Clientes ${y.year}`])), ...Object.fromEntries(ckSub.map((o) => [o.to, o.label])), "/checklist": "CheckList", ...Object.fromEntries(custom.map((w) => [windowRoute(w.id), w.nombre])) };
  const inFoto = pathname.startsWith("/fotografico");
  const [fotoOpen, setFotoOpen] = useState(inFoto);
  const fotoShown = fotoOpen || inFoto;

  // Menú: en celular es un panel que se oculta al elegir una opción;
  // en pantalla grande se puede ocultar/mostrar con el botón ☰.
  const [open, setOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = usePersistentState("layout.sidebar", true);

  // Al cambiar de pantalla se cierra el panel (modo celular).
  useEffect(() => setOpen(false), [pathname]);

  // Escape cierra el panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) setDesktopOpen(!desktopOpen);
    else setOpen(!open);
  };

  const link = (isActive: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${
      isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
    }`;

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* Fondo oscuro detrás del panel (solo celular) */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] bg-slate-900 text-slate-300 flex flex-col
          transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:shrink-0
          ${open ? "translate-x-0" : "-translate-x-full"}
          ${desktopOpen ? "lg:translate-x-0" : "lg:hidden"}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h1 className="text-white font-bold text-lg">NetOps Suite</h1>
            <p className="text-xs text-slate-500">Panel de operaciones LAN</p>
          </div>
          <button
            className="lg:hidden rounded-md p-2 text-slate-400 hover:bg-slate-800"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => link(isActive)}>
              <span className="text-lg">{item.icon}</span>
              <span>
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] opacity-70">{item.desc}</span>
              </span>
            </NavLink>
          ))}

          <div>
            <button
              type="button"
              aria-expanded={clShown}
              onClick={() => setClOpen(!clShown)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-left transition-colors ${
                inCl ? "bg-slate-800 text-white" : "hover:bg-slate-800 text-slate-300"
              }`}
            >
              <span className="text-lg">👥</span>
              <span className="flex-1">
                <span className="block font-medium">Datos de cliente</span>
                <span className="block text-[11px] opacity-70">Por SOT · año y mes</span>
              </span>
              <span className="text-xs">{clShown ? "▾" : "▸"}</span>
            </button>
            {clShown && (
              <div className="mt-1 ml-5 space-y-1 border-l border-slate-700 pl-3">
                {[{ to: "/clientes", label: "Todos los clientes", end: true }, ...years.map((y) => ({ to: `/clientes/${y.year}`, label: `${y.year}  (${y.total})`, end: false }))].map((o) => (
                  <NavLink
                    key={o.to}
                    to={o.to}
                    end
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2.5 text-sm transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
                      }`
                    }
                  >
                    {o.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  onClick={newYear}
                  className="block w-full rounded-md px-3 py-2.5 text-left text-sm text-brand-100 hover:bg-slate-800"
                >
                  ➕ Nuevo año
                </button>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              aria-expanded={ckShown}
              onClick={() => setCkOpen(!ckShown)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-left transition-colors ${
                inCk ? "bg-slate-800 text-white" : "hover:bg-slate-800 text-slate-300"
              }`}
            >
              <span className="text-lg">☑️</span>
              <span className="flex-1">
                <span className="block font-medium">CheckList</span>
                <span className="block text-[11px] opacity-70">{ckTypes.length} tipos · Estilo Claro</span>
              </span>
              <span className="text-xs">{ckShown ? "▾" : "▸"}</span>
            </button>
            {ckShown && (
              <div className="mt-1 ml-5 space-y-1 border-l border-slate-700 pl-3">
                {ckSub.map((o) => (
                  <NavLink
                    key={o.to}
                    to={o.to}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2.5 text-sm transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
                      }`
                    }
                  >
                    {o.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  onClick={() => setCreatingCk(true)}
                  className="block w-full rounded-md px-3 py-2.5 text-left text-sm text-brand-100 hover:bg-slate-800"
                >
                  ➕ Nueva opción
                </button>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              aria-expanded={fotoShown}
              onClick={() => setFotoOpen(!fotoShown)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-left transition-colors ${
                inFoto ? "bg-slate-800 text-white" : "hover:bg-slate-800 text-slate-300"
              }`}
            >
              <span className="text-lg">📷</span>
              <span className="flex-1">
                <span className="block font-medium">Reporte fotográfico</span>
                <span className="block text-[11px] opacity-70">{fotoSub.length} formatos</span>
              </span>
              <span className="text-xs">{fotoShown ? "▾" : "▸"}</span>
            </button>
            {fotoShown && (
              <div className="mt-1 ml-5 space-y-1 border-l border-slate-700 pl-3">
                {fotoSub.map((o) => (
                  <NavLink
                    key={o.to}
                    to={o.to}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-2.5 text-sm transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 text-slate-300"
                      }`
                    }
                  >
                    {o.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="block w-full rounded-md px-3 py-2.5 text-left text-sm text-brand-100 hover:bg-slate-800"
                >
                  ➕ Nueva ventana
                </button>
              </div>
            )}
          </div>
        </nav>
        <div className="px-5 py-3 text-[11px] text-slate-600 border-t border-slate-800">
          NetOps Suite v1.0
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior con el botón de menú */}
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
          <button
            className="rounded-lg p-2 text-xl leading-none text-slate-700 hover:bg-slate-100"
            onClick={toggle}
            aria-label="Mostrar u ocultar el menú"
          >
            ☰
          </button>
          <span className="truncate text-sm font-semibold text-slate-700">
            {titles[pathname] ?? "NetOps Suite"}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-100">
          <div className="mx-auto max-w-5xl p-3 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
      {creatingCk && (
        <NewChecklistModal
          onCancel={() => setCreatingCk(false)}
          onCreate={async (input) => {
            const t = await createChecklistType(input);
            setCreatingCk(false);
            navigate(checklistRoute(t.id));
          }}
        />
      )}
      {creating && (
        <WindowEditor
          onCancel={() => setCreating(false)}
          onSave={async (input) => {
            const w = await createWindow(input);
            setCreating(false);
            navigate(windowRoute(w.id));
          }}
        />
      )}
    </div>
  );
}

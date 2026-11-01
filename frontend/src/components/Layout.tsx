import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import WindowEditor from "./WindowEditor";
import { createWindow, usePhotoWindows, windowRoute } from "../store/photoWindows";
import { createYear, listYears } from "../store/clients";
import NewChecklistModal from "./NewChecklistModal";
import { checklistRoute, createChecklistType, useChecklistTypes } from "../store/checklistTypes";
import { usePersistentState } from "../store/persistentState";
import ThemeSwitcher from "./ThemeSwitcher";
import Mascot from "../mascot/Mascot";
import WaterDrops, { Drop } from "./WaterDrops";

const NAV = [
  { to: "/pruebas", label: "Pruebas", desc: "SSH / Serial + PDF" },
  { to: "/plantillas", label: "Plantillas", desc: "Crear y aplicar" },
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
    { to: "/checklist/saturador", label: "Saturador" },
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
  const mainRef = useRef<HTMLElement>(null);
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

  const link = (isActive: boolean) => `side-item ${isActive ? "active" : ""}`;
  const sub = (isActive: boolean) => `side-item ${isActive ? "active" : ""}`;
  const Chev = ({ openState }: { openState: boolean }) => (
    <svg width="14" height="14" viewBox="0 0 20 20" className={`shrink-0 transition-transform duration-200 ${openState ? "rotate-90" : ""}`} aria-hidden="true">
      <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const group = (inside: boolean) => `side-item ${inside ? "active" : ""}`;

  const Group = ({ inside, shown, onToggle, title, desc, children }: { inside: boolean; shown: boolean; onToggle: () => void; title: string; desc: string; children: React.ReactNode }) => (
    <div>
      <button type="button" aria-expanded={shown} onClick={onToggle} className={group(inside)}>
        <span className="flex-1">
          <span className="block">{title}</span>
          <span className="block text-[11px] font-normal opacity-60">{desc}</span>
        </span>
        <Chev openState={shown} />
      </button>
      {shown && <div className="side-sub animate-rise">{children}</div>}
    </div>
  );
  const subLink = (o: { to: string; label: string }, end = false) => (
    <NavLink key={o.to} to={o.to} end={end} className={({ isActive }) => sub(isActive)}>{o.label}</NavLink>
  );
  const addBtn = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="side-item side-add">{label}</button>
  );

  return (
    <div className="relative flex h-[100dvh] overflow-hidden">
      <WaterDrops />
      {open && <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        className={`side z-40 fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col transition-transform duration-200 lg:relative lg:z-auto lg:w-64 lg:max-w-none lg:shrink-0
          ${open ? "translate-x-0" : "-translate-x-full"} ${desktopOpen ? "lg:translate-x-0" : "lg:hidden"}`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <img src="/logo.png" alt="" width={40} height={40} className="h-10 w-10 rounded-xl shadow-glow" />
          <div className="flex-1 leading-none">
            <h1 className="font-display text-[19px] font-extrabold tracking-tight text-white">NetOps</h1>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[.32em] text-cyan2-400">Suite</p>
          </div>
          <button className="rounded-md px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)}>Cerrar</button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          <div className="side-group">Operación</div>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => link(isActive)}>
              <span>
                <span className="block">{item.label}</span>
                <span className="block text-[11px] font-normal opacity-60">{item.desc}</span>
              </span>
            </NavLink>
          ))}
          <Group inside={inCk} shown={ckShown} onToggle={() => setCkOpen(!ckShown)} title="CheckList" desc={`${ckTypes.length} tipos · estilo Claro`}>
            {ckSub.map((o) => subLink(o))}
            {addBtn("+ Nueva opción", () => setCreatingCk(true))}
          </Group>

          <div className="side-group">Documentación</div>
          <Group inside={inFoto} shown={fotoShown} onToggle={() => setFotoOpen(!fotoShown)} title="Reporte fotográfico" desc={`${fotoSub.length} formatos`}>
            {fotoSub.map((o) => subLink(o))}
            {addBtn("+ Nueva ventana", () => setCreating(true))}
          </Group>
          <Group inside={inCl} shown={clShown} onToggle={() => setClOpen(!clShown)} title="Datos de cliente" desc="Por SOT · año y mes">
            {subLink({ to: "/clientes", label: "Todos los clientes" }, true)}
            {years.map((y) => subLink({ to: `/clientes/${y.year}`, label: `${y.year}  (${y.total})` }, true))}
            {addBtn("+ Nuevo año", newYear)}
          </Group>
        </nav>
        <div className="side-drop" style={{ right: -14, bottom: 34, ["--dur" as any]: "11s" }}><Drop size={74} kind="bead" /></div>
        <div className="side-drop" style={{ left: 18, bottom: 54, ["--dur" as any]: "9s", ["--delay" as any]: "-3s" }}><Drop size={30} kind="tear" /></div>
        <div className="relative flex items-center justify-between border-t border-white/10 px-5 py-3 text-[11px] text-slate-400">
          <span>NetOps Suite v1.0</span>
          <span className="h-1.5 w-1.5 rounded-full bg-cyan2-400 shadow-[0_0_8px_#38d0f7]" />
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="glass relative z-20 flex shrink-0 items-center gap-3 px-3 py-2" style={{ borderWidth: "0 0 1px" }}>
          <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-cyan2-500 hover:bg-slate-50" onClick={toggle} aria-label="Mostrar u ocultar el menú">
            Menú
          </button>
          <span className="truncate font-display text-sm font-semibold text-slate-800">{titles[pathname] ?? "NetOps Suite"}</span>
          <div className="flex-1" />
          <ThemeSwitcher />
        </header>

        <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div key={pathname} className="view-enter mx-auto max-w-5xl p-3 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
      <Mascot />
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

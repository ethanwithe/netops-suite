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
import { Drop } from "./WaterDrops";
import Backdrop from "./Backdrop";
import TabBar, { TabGroup } from "./TabBar";
import { initLiquid } from "../liquid";
import { can, displayName, logout, useAuth } from "../store/auth";
import { Avatar } from "../pages/ProfilePage";
import { getActingClient, setActingClient } from "../api/client";

const NAV = [
  { to: "/grafica", label: "Gráfica", desc: "Próximamente", feature: "grafica" },
  { to: "/plantillas", label: "Plantillas", desc: "Crear y aplicar", feature: "plantillas" },
];

const FOTO_SUB = [
  { to: "/fotografico/gpon-ont", label: "GPON con ONT" },
  { to: "/fotografico/gpon-modulo", label: "GPON con módulo" },
  { to: "/fotografico/fibra", label: "Fibra convencional" },
  { to: "/fotografico/poder-judicial", label: "RF Poder Judicial" },
];

const TITLES: Record<string, string> = {
  "/panel": "Panel",
  "/perfil": "Mi perfil",
  "/admin/usuarios": "Usuarios",
  "/admin/clientes": "Clientes de todos",
  "/admin/actividad": "Actividad",
  "/grafica": "Gráfica",
  "/plantillas": "Plantillas",
  "/checklist": "CheckList",
  ...Object.fromEntries(FOTO_SUB.map((o) => [o.to, o.label])),
};

export default function Layout() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const [acting, setActing] = useState(getActingClient());
  useEffect(() => setActing(getActingClient()), [pathname]);
  const [userMenu, setUserMenu] = useState(false);
  const okFoto = can(me, "fotografico");
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
    ...FOTO_SUB.filter((o) => (o.to.endsWith("poder-judicial") ? can(me, "poder_judicial") : okFoto)),
    ...(okFoto ? custom.map((w) => ({ to: windowRoute(w.id), label: w.nombre })) : []),
  ];
  const titles: Record<string, string> = { ...TITLES, "/clientes": "Mis clientes", ...Object.fromEntries(years.map((y) => [`/clientes/${y.year}`, `Clientes ${y.year}`])), ...Object.fromEntries(ckSub.map((o) => [o.to, o.label])), "/checklist": "CheckList", ...Object.fromEntries(custom.map((w) => [windowRoute(w.id), w.nombre])) };
  const inFoto = pathname.startsWith("/fotografico");
  const [fotoOpen, setFotoOpen] = useState(inFoto);
  const fotoShown = fotoOpen || inFoto;

  // Menú: en celular es un panel que se oculta al elegir una opción;
  // en pantalla grande se puede ocultar/mostrar con el botón ☰.
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [desktopOpen, setDesktopOpen] = usePersistentState("layout.sidebar", true);

  useEffect(() => initLiquid(), []);

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

  const tabGroups: TabGroup[] = [
    { id: "pn", label: "Panel", prefixes: ["/panel", "/perfil"], items: [{ to: "/panel", label: "Panel" }, { to: "/perfil", label: "Mi perfil" }] },
    ...(can(me, "grafica") ? [{ id: "gr", label: "Gráfica", prefixes: ["/grafica"], items: [{ to: "/grafica", label: "Gráfica" }] }] : []),
    ...(can(me, "plantillas") ? [{ id: "tl", label: "Plantillas", prefixes: ["/plantillas"], items: [{ to: "/plantillas", label: "Plantillas" }] }] : []),
    ...(can(me, "checklist") ? [{ id: "ck", label: "CheckList", prefixes: ["/checklist"], items: ckSub }] : []),
    ...(okFoto || can(me, "poder_judicial") ? [{ id: "ft", label: "Fotos", prefixes: ["/fotografico"], items: fotoSub }] : []),
    { id: "cl", label: "Clientes", prefixes: ["/clientes"], items: [{ to: "/clientes", label: "Mis clientes" }, ...years.map((y) => ({ to: `/clientes/${y.year}`, label: `Clientes ${y.year}` }))] },
    ...(me?.is_admin ? [{ id: "ad", label: "Admin", prefixes: ["/admin"], items: [{ to: "/admin/usuarios", label: "Usuarios" }, { to: "/admin/clientes", label: "Clientes de todos" }, { to: "/admin/actividad", label: "Actividad" }] }] : []),
  ];
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
      <Backdrop />
      {open && <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        className={`side z-40 fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col transition-transform duration-200 lg:relative lg:z-auto lg:w-[clamp(15rem,17vw,20rem)] lg:max-w-none lg:shrink-0
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

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-28 lg:pb-3">
          <div className="side-group">Mi cuenta</div>
          <NavLink to="/panel" className={({ isActive }) => link(isActive)}>
            <span><span className="block">Panel</span><span className="block text-[11px] font-normal opacity-60">Mis puntos y clientes</span></span>
          </NavLink>
          <NavLink to="/perfil" className={({ isActive }) => link(isActive)}>
            <span><span className="block">Mi perfil</span><span className="block text-[11px] font-normal opacity-60">Datos, foto y contraseña</span></span>
          </NavLink>
          {me?.is_admin && (
            <>
              <div className="side-group">Administración</div>
              <NavLink to="/admin/usuarios" className={({ isActive }) => link(isActive)}><span className="block">Usuarios</span></NavLink>
              <NavLink to="/admin/clientes" className={({ isActive }) => link(isActive)}><span className="block">Clientes de todos</span></NavLink>
              <NavLink to="/admin/actividad" className={({ isActive }) => link(isActive)}><span className="block">Actividad</span></NavLink>
            </>
          )}
          <div className="side-group">Operación</div>
          {NAV.filter((n) => can(me, n.feature)).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => link(isActive)}>
              <span>
                <span className="block">{item.label}</span>
                <span className="block text-[11px] font-normal opacity-60">{item.desc}</span>
              </span>
            </NavLink>
          ))}
          {can(me, "checklist") && <Group inside={inCk} shown={ckShown} onToggle={() => setCkOpen(!ckShown)} title="CheckList" desc={`${ckTypes.length} tipos · estilo Claro`}>
            {ckSub.map((o) => subLink(o))}
            {can(me, "editar_catalogos") && addBtn("+ Nueva opción", () => setCreatingCk(true))}
          </Group>}

          <div className="side-group">Documentación</div>
          {fotoSub.length > 0 && <Group inside={inFoto} shown={fotoShown} onToggle={() => setFotoOpen(!fotoShown)} title="Reporte fotográfico" desc={`${fotoSub.length} formatos`}>
            {fotoSub.map((o) => subLink(o))}
            {can(me, "editar_catalogos") && okFoto && addBtn("+ Nueva ventana", () => setCreating(true))}
          </Group>}
          <Group inside={inCl} shown={clShown} onToggle={() => setClOpen(!clShown)} title="Mis clientes" desc="Por SOT · año y mes">
            {subLink({ to: "/clientes", label: "Todos mis clientes" }, true)}
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
        <header className="glass relative z-20 flex shrink-0 items-center gap-3 px-3 py-2" style={{ borderWidth: "0 0 1px", paddingTop: "max(.5rem, env(safe-area-inset-top))" }}>
          <button className="lg rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-cyan2-500 hover:bg-slate-50" onClick={toggle} aria-label="Mostrar u ocultar el menú">
            Menú
          </button>
          <span className="truncate font-display text-sm font-semibold text-slate-800">{titles[pathname] ?? "NetOps Suite"}</span>
          <div className="flex-1" />
          <ThemeSwitcher />
          {me && (
            <div className="relative">
              <button type="button" className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-slate-100/60" onClick={() => setUserMenu(!userMenu)} aria-expanded={userMenu} aria-label="Mi cuenta">
                <Avatar me={me} size={30} />
                <span className="hidden max-w-[10rem] truncate text-xs font-semibold text-slate-700 sm:block">{displayName(me)}</span>
              </button>
              {userMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setUserMenu(false)} aria-hidden="true" />
                  <div className="card absolute right-0 z-40 mt-1 w-56 space-y-1 p-2">
                    <p className="truncate px-2 py-1 text-xs text-slate-500">@{me.username}</p>
                    <button className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => { setUserMenu(false); navigate("/perfil"); }}>Mi perfil</button>
                    <button className="block w-full rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => void logout()}>Cerrar sesión</button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        {acting && (
          <div className="flex flex-wrap items-center gap-2 bg-amber-100 px-3 py-1.5 text-xs text-amber-900" role="status">
            Estás editando la SOT {acting.sot} de otro usuario.
            <button className="font-semibold underline" onClick={() => { setActingClient(null); setActing(null); }}>Salir de este modo</button>
          </div>
        )}
        <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div key={pathname} className="view-enter page-pad w-full max-lg:pb-28">
            <Outlet />
          </div>
        </main>
      </div>
      <TabBar groups={tabGroups} menuOpen={open} onMenu={() => setOpen((o) => !o)} />
      {can(me, "asistente") && <Mascot />}
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

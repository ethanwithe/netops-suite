import { lazy, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Spinner from "./components/Spinner";
import { TEMPLATES } from "./diagram/templates";
import LoginPage, { ForcePassword } from "./pages/LoginPage";
import { can, loadMe, useAuth } from "./store/auth";

// Cada pantalla se descarga solo cuando la abres (antes todo se bajaba de golpe al entrar)
const GraficaPage = lazy(() => import("./pages/GraficaPage"));
const DiagramIconsPage = lazy(() => import("./pages/DiagramIconsPage"));
const PlantillasPage = lazy(() => import("./pages/PlantillasPage"));
const ChecklistTypePage = lazy(() => import("./pages/ChecklistTypePage"));
const ChecklistHome = lazy(() => import("./pages/ChecklistHome"));
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const SaturadorPage = lazy(() => import("./pages/SaturadorPage"));
const FotograficoPage = lazy(() => import("./pages/FotograficoPage"));
const CustomFotograficoPage = lazy(() => import("./pages/CustomFotograficoPage"));
const PoderJudicialPage = lazy(() => import("./pages/PoderJudicialPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const AgendaPage = lazy(() => import("./pages/AgendaPage"));
const BitReportsPage = lazy(() => import("./pages/BitReportsPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const AdminSystemPage = lazy(() => import("./pages/AdminSystemPage"));

/** Muestra la página solo si el usuario tiene esa función (o es administrador). */
function Need({ feature, admin, children }: { feature?: string; admin?: boolean; children: JSX.Element }) {
  const { me } = useAuth();
  if (admin ? !me?.is_admin : feature ? !can(me, feature) : false) {
    return <div className="card text-sm text-slate-600">No tienes permiso para ver esta pantalla. Pídeselo al administrador.</div>;
  }
  return children;
}

export default function App() {
  const { me, loading } = useAuth();
  useEffect(() => { void loadMe(); }, []);
  // Con la sesión iniciada y el navegador libre, se adelantan las pantallas más usadas para que abran al instante
  useEffect(() => {
    if (!me) return;
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    ric(() => { void import("./pages/ChecklistTypePage"); void import("./pages/FotograficoPage"); void import("./pages/ClientsPage"); void import("./pages/GraficaPage"); });
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="flex min-h-[100dvh] items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  }
  if (!me) return <LoginPage />;
  if (me.must_change_password) return <ForcePassword me={me} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/panel" replace />} />
        <Route path="/panel" element={<DashboardPage />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/grafica" element={<Navigate to={`/grafica/${TEMPLATES[0].id}`} replace />} />
        <Route path="/grafica/iconos" element={<Need feature="grafica"><DiagramIconsPage /></Need>} />
        {TEMPLATES.map((t) => <Route key={t.id} path={`/grafica/${t.id}`} element={<Need feature="grafica"><GraficaPage key={t.id} tplId={t.id} /></Need>} />)}
        <Route path="/pruebas" element={<Navigate to="/grafica" replace />} />
        <Route path="/plantillas" element={<Need feature="plantillas"><PlantillasPage /></Need>} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/clientes/:year" element={<ClientsPage />} />
        <Route path="/checklist" element={<Need feature="checklist"><ChecklistHome /></Need>} />
        <Route path="/checklist/t/:id" element={<Need feature="checklist"><ChecklistTypePage /></Need>} />
        <Route path="/checklist/saturador" element={<Need feature="checklist"><SaturadorPage /></Need>} />
        <Route path="/fotografico" element={<Navigate to="/fotografico/fibra" replace />} />
        <Route path="/fotografico/gpon-ont" element={<Need feature="fotografico"><FotograficoPage key="gpon_ont" tipo="gpon_ont" /></Need>} />
        <Route path="/fotografico/gpon-modulo" element={<Need feature="fotografico"><FotograficoPage key="gpon_modulo" tipo="gpon_modulo" /></Need>} />
        <Route path="/fotografico/fibra" element={<Need feature="fotografico"><FotograficoPage key="fibra" tipo="fibra" /></Need>} />
        <Route path="/fotografico/v/:id" element={<Need feature="fotografico"><CustomFotograficoPage /></Need>} />
        <Route path="/fotografico/poder-judicial" element={<Need feature="poder_judicial"><PoderJudicialPage /></Need>} />
        <Route path="/admin/usuarios" element={<Need admin><AdminUsersPage /></Need>} />
        <Route path="/admin/clientes" element={<Need admin><ClientsPage all /></Need>} />
        <Route path="/admin/actividad" element={<Need admin><ActivityPage /></Need>} />
        <Route path="/admin/sistema" element={me.role === "superadmin" ? <AdminSystemPage /> : <div className="card text-sm text-slate-600">Solo el superadmin puede ver esta pantalla.</div>} />
        <Route path="/admin/reportes" element={<Need admin><BitReportsPage /></Need>} />
        <Route path="*" element={<Navigate to="/panel" replace />} />
      </Route>
    </Routes>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import PruebasPage from "./pages/PruebasPage";
import PlantillasPage from "./pages/PlantillasPage";
import ChecklistTypePage from "./pages/ChecklistTypePage";
import ChecklistHome from "./pages/ChecklistHome";
import ClientsPage from "./pages/ClientsPage";
import SaturadorPage from "./pages/SaturadorPage";
import FotograficoPage from "./pages/FotograficoPage";
import CustomFotograficoPage from "./pages/CustomFotograficoPage";
import PoderJudicialPage from "./pages/PoderJudicialPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/pruebas" replace />} />
        <Route path="/pruebas" element={<PruebasPage />} />
        <Route path="/plantillas" element={<PlantillasPage />} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/clientes/:year" element={<ClientsPage />} />
        <Route path="/checklist" element={<ChecklistHome />} />
        <Route path="/checklist/t/:id" element={<ChecklistTypePage />} />
        <Route path="/checklist/saturador" element={<SaturadorPage />} />
        <Route path="/fotografico" element={<Navigate to="/fotografico/fibra" replace />} />
        <Route path="/fotografico/gpon-ont" element={<FotograficoPage key="gpon_ont" tipo="gpon_ont" />} />
        <Route path="/fotografico/gpon-modulo" element={<FotograficoPage key="gpon_modulo" tipo="gpon_modulo" />} />
        <Route path="/fotografico/fibra" element={<FotograficoPage key="fibra" tipo="fibra" />} />
        <Route path="/fotografico/v/:id" element={<CustomFotograficoPage />} />
        <Route path="/fotografico/poder-judicial" element={<PoderJudicialPage />} />
      </Route>
    </Routes>
  );
}

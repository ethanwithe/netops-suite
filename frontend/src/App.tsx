import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import PruebasPage from "./pages/PruebasPage";
import PlantillasPage from "./pages/PlantillasPage";
import ChecklistPage from "./pages/ChecklistPage";
import FotograficoPage from "./pages/FotograficoPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/pruebas" replace />} />
        <Route path="/pruebas" element={<PruebasPage />} />
        <Route path="/plantillas" element={<PlantillasPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route path="/fotografico" element={<FotograficoPage />} />
      </Route>
    </Routes>
  );
}

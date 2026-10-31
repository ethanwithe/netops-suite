import { Navigate } from "react-router-dom";
import Spinner from "../components/Spinner";
import { checklistRoute, useChecklistTypes } from "../store/checklistTypes";

/** /checklist: abre el primer tipo disponible. */
export default function ChecklistHome() {
  const { list, loaded, error } = useChecklistTypes();
  if (!loaded) return <Spinner />;
  if (list.length) return <Navigate to={checklistRoute(list[0].id)} replace />;
  return (
    <div className="card text-sm text-slate-600">
      {error ? "No se pudieron cargar los checklists. Recarga la página." : "Aún no hay checklists. Crea uno desde el menú: CheckList → ➕ Nueva opción."}
    </div>
  );
}

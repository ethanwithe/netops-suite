import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import FotograficoPage from "./FotograficoPage";
import WindowEditor from "../components/WindowEditor";
import Spinner from "../components/Spinner";
import { registerWindowDefaults } from "../store/photoReportStore";
import { deleteWindow, updateWindow, usePhotoWindows } from "../store/photoWindows";

/** Ventana de reporte creada por el usuario: misma pantalla que las demás, con su nombre y valores por defecto. */
export default function CustomFotograficoPage() {
  const { id = "" } = useParams();
  const { list, loaded } = usePhotoWindows();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const win = list.find((w) => w.id === id);

  if (!loaded) return <Spinner />;
  if (!win) return <Navigate to="/fotografico/fibra" replace />;

  // Antes de dibujar la pantalla hija, para que un reporte nuevo nazca con los valores por defecto.
  registerWindowDefaults(win.id, win.config);

  return (
    <>
      <FotograficoPage
        key={win.id}
        tipo={win.id}
        nombre={win.nombre}
        onConfigure={() => setEditing(true)}
      />
      {editing && (
        <WindowEditor
          initial={win}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await updateWindow(win.id, input);
            registerWindowDefaults(win.id, input.config);
            setEditing(false);
          }}
          onDelete={async () => {
            await deleteWindow(win.id);
            navigate("/fotografico/fibra", { replace: true });
          }}
        />
      )}
    </>
  );
}

"""
desktop_main.py — servidor local de la app de escritorio (Windows).

Lo lanza la ventana (Tauri) como proceso auxiliar: arranca la API en 127.0.0.1 con SQLite, sirve la
interfaz ya compilada y, dentro del mismo programa, deja activos la consola (SSH/serial) y el saturador.
Imprime «NETOPS_READY <puerto>» cuando está listo para que la ventana sepa a dónde conectarse.
"""
import os
import socket
import sys
import threading
import time
import traceback

_T0 = time.time()
_LOG = None


def _log(msg: str) -> None:
    """Registro en %LOCALAPPDATA%\\NetOpsSuite\\server.log (para saber qué tardó o falló al iniciar)."""
    try:
        if _LOG:
            with open(_LOG, "a", encoding="utf-8") as f:
                f.write("%7.2fs  %s\n" % (time.time() - _T0, msg))
    except OSError:
        pass


def _data_dir() -> str:
    d = os.getenv("NETOPS_DATA_DIR")
    if not d:
        base = os.getenv("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
        d = os.path.join(base, "NetOpsSuite")
    os.makedirs(d, exist_ok=True)
    return d


def _free_port(preferred: int = 0) -> int:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", preferred))
        except OSError:
            s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    # Sin consola (ventana de Windows) stdout/stderr no existen: se evita que print() falle.
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
        else:
            try:  # la consola de Windows usa otra codificación: se fuerza UTF-8 y nunca falla por un carácter
                getattr(sys, name).reconfigure(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                pass

    global _LOG
    data = _data_dir()
    _LOG = os.path.join(data, "server.log")
    try:
        open(_LOG, "w").close()
    except OSError:
        pass
    _log("inicio")
    os.environ.setdefault("NETOPS_LOCAL", "1")
    os.environ.setdefault("NETOPS_DATA_DIR", data)
    os.environ.setdefault("UPLOADS_DIR", os.path.join(data, "uploads"))
    os.environ.setdefault("OUTPUTS_DIR", os.path.join(data, "outputs"))
    os.environ["NETOPS_DESKTOP"] = "1"
    os.environ.setdefault("NETOPS_CLOUD_URL", "https://netopssuite.up.railway.app")
    if getattr(sys, "frozen", False):
        os.environ.setdefault("FRONTEND_DIST", os.path.join(sys._MEIPASS, "static_frontend"))  # type: ignore[attr-defined]

    from app.routers import local_tools
    from app.static_tools import puente, saturador
    _log("consola y saturador cargados")

    # Consola y saturador locales: códigos propios, la página los recibe sola (no hay que pegar nada).
    local_tools.CODES["puente"] = puente.stored_code()
    sat_code = os.urandom(3).hex().upper()
    local_tools.CODES["saturador"] = sat_code
    threading.Thread(target=puente.run, args=(8766, local_tools.CODES["puente"]), daemon=True).start()
    threading.Thread(target=saturador.run_agent, args=(8765, sat_code), daemon=True).start()

    from app.services import cloud_sync
    cloud_sync.start_agent()   # sincroniza en segundo plano con la nube cuando hay Internet y sesión

    import uvicorn
    from app.main import app
    _log("aplicación importada")

    port = _free_port(int(os.getenv("NETOPS_PORT", "0") or 0))
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    def _announce():
        while not server.started:
            threading.Event().wait(0.1)
        _log("listo en el puerto %d" % port)
        print("NETOPS_READY %d" % port, flush=True)

    threading.Thread(target=_announce, daemon=True).start()
    try:
        server.run()
    except BaseException:  # noqa: BLE001
        _log("ERROR:\n" + traceback.format_exc())
        raise


if __name__ == "__main__":
    try:
        main()
    except BaseException:  # noqa: BLE001
        _log("ERROR:\n" + traceback.format_exc())
        raise

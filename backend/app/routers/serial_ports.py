from fastapi import APIRouter

from app.services.serial_executor import list_serial_ports

router = APIRouter(prefix="/api/serial", tags=["serial"])


@router.get("/ports")
def get_ports():
    """
    OJO: esto lista los puertos COM/tty del SERVIDOR donde corre el backend,
    no los de la PC del navegador. El modo Serial solo tiene sentido cuando
    el backend corre en la misma máquina que tiene el cable de consola
    conectado (ej. ejecución local en la laptop del técnico).
    """
    try:
        return {"ports": list_serial_ports()}
    except Exception:
        return {"ports": []}

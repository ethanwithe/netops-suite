"""
device_link.py
Unifica SSH y Serial bajo una misma interfaz, para que el resto del
programa (pruebas automáticas y aplicación de plantillas) no tenga que
preocuparse de cuál transporte está usando.

conn = {
    "mode": "ssh",
    "host": "10.50.1.2", "port": 22, "user": "admin", "password": "***",
}
o
conn = {
    "mode": "serial",
    "com_port": "COM3", "baudrate": 9600,
}
"""

from app.services.ssh_executor import run_automatic_session, send_raw_lines_ssh
from app.services.serial_executor import run_automatic_session_serial, send_raw_lines_serial, list_serial_ports


def run_tests(conn, disable_paging_cmds, config_test, tests, save_cmds=None, progress_cb=None):
    if conn["mode"] == "ssh":
        return run_automatic_session(
            host=conn["host"], user=conn["user"], password=conn["password"], port=conn["port"],
            disable_paging_cmds=disable_paging_cmds, config_test=config_test,
            tests=tests, save_cmds=save_cmds, progress_cb=progress_cb,
        )
    elif conn["mode"] == "serial":
        return run_automatic_session_serial(
            com_port=conn["com_port"], baudrate=conn["baudrate"],
            disable_paging_cmds=disable_paging_cmds, config_test=config_test,
            tests=tests, save_cmds=save_cmds, progress_cb=progress_cb,
        )
    else:
        raise ValueError(f"Modo de conexión desconocido: {conn.get('mode')}")


def apply_raw_lines(conn, lines, progress_cb=None):
    if conn["mode"] == "ssh":
        return send_raw_lines_ssh(
            host=conn["host"], user=conn["user"], password=conn["password"], port=conn["port"],
            lines=lines, progress_cb=progress_cb,
        )
    elif conn["mode"] == "serial":
        return send_raw_lines_serial(
            com_port=conn["com_port"], baudrate=conn["baudrate"],
            lines=lines, progress_cb=progress_cb,
        )
    else:
        raise ValueError(f"Modo de conexión desconocido: {conn.get('mode')}")

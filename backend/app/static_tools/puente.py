#!/usr/bin/env python3
"""
PUENTE LOCAL  (NetOps Suite)

La página del CheckList corre en la nube (Railway): desde allí no se ve el cable de
consola de tu laptop ni la red de tu casa/oficina/cliente. Este programa corre EN TU
LAPTOP y presta esas dos cosas a la página:

  - Consola por cable (USB/COM): detecta solo los puertos y abre la consola.
  - SSH: la conexión sale desde tu laptop, así que llega a equipos de tu red local
    (192.168.x.x, 10.x.x.x…) y a los que veas por VPN/cable, aunque la página esté en Railway.

Uso:
    python puente.py
  Déjalo abierto. La primera vez te muestra un CÓDIGO: pégalo en la página (se recuerda).

Requisitos: Python 3.8+. La primera vez instala solo «pyserial» y «paramiko» (necesita internet).
La página solo habla con 127.0.0.1 (tu propia laptop); la contraseña del equipo nunca pasa por la nube.
Úsalo solo en equipos que tengas autorizados.
"""

import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "1.0"
MAX_BUF = 4_000_000  # tope de texto guardado por sesión


def _need(mod, pkg):
    try:
        return __import__(mod)
    except ImportError:
        print(" Instalando %s (solo la primera vez)…" % pkg)
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", pkg])
            return __import__(mod)
        except Exception as e:  # sin internet, sin pip, etc.
            print(" No se pudo instalar %s: %s\n   Instálalo a mano:  %s -m pip install %s" % (pkg, e, sys.executable, pkg))
            return None


serial = _need("serial", "pyserial")
paramiko = _need("paramiko", "paramiko")


class Session:
    """Una conexión abierta (serial o SSH): acumula lo que llega y deja escribir."""

    def __init__(self, kind):
        self.kind = kind
        self.buf = ""
        self.base = 0  # caracteres ya descartados por el tope
        self.open = True
        self.error = ""
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.last_use = time.time()

    def feed(self, text):
        with self.cond:
            self.buf += text
            if len(self.buf) > MAX_BUF:
                cut = len(self.buf) - MAX_BUF
                self.buf, self.base = self.buf[cut:], self.base + cut
            self.cond.notify_all()

    def read(self, since, wait=0.0):
        end = time.time() + wait
        with self.cond:
            while self.open and self.base + len(self.buf) <= since and time.time() < end:
                self.cond.wait(max(0.0, end - time.time()))
            start = max(0, since - self.base)
            n = self.base + len(self.buf)
            return self.buf[start:], n, self.open

    def close(self):
        with self.cond:
            self.open = False
            self.cond.notify_all()


class SerialSession(Session):
    def __init__(self, port, baud):
        super().__init__("serial")
        self.ser = serial.Serial(port, baudrate=baud, bytesize=8, parity="N", stopbits=1, timeout=0.2)
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        try:
            while self.open:
                data = self.ser.read(self.ser.in_waiting or 1)
                if data:
                    self.feed(data.decode("utf-8", "replace"))
        except Exception as e:
            self.error = str(e)
        finally:
            self.close()

    def write(self, text):
        self.ser.write(text.encode("utf-8"))

    def close(self):
        super().close()
        try:
            self.ser.close()
        except Exception:
            pass


class SshSession(Session):
    def __init__(self, host, port, user, password):
        super().__init__("ssh")
        self.cli = paramiko.SSHClient()
        self.cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.cli.connect(host, port=port, username=user, password=password, timeout=15, banner_timeout=20,
                         auth_timeout=20, look_for_keys=False, allow_agent=False)
        self.chan = self.cli.invoke_shell(term="vt100", width=200, height=50)
        self.chan.settimeout(0.3)
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        try:
            while self.open:
                try:
                    data = self.chan.recv(4096)
                except Exception as e:  # timeout normal
                    if "timed out" in str(e).lower():
                        if self.chan.closed or self.chan.exit_status_ready():
                            break
                        continue
                    raise
                if not data:
                    break
                self.feed(data.decode("utf-8", "replace"))
        except Exception as e:
            self.error = str(e)
        finally:
            self.close()

    def write(self, text):
        self.chan.send(text)

    def close(self):
        super().close()
        try:
            self.cli.close()
        except Exception:
            pass


SESSIONS = {}


def list_ports():
    if serial is None:
        return []
    from serial.tools import list_ports as lp
    out = []
    for p in sorted(lp.comports(), key=lambda x: x.device):
        out.append({"device": p.device, "desc": p.description or "", "hwid": p.hwid or "",
                    "usb": bool(p.vid), "fabricante": p.manufacturer or ""})
    return out


def sweep():
    """Cierra las sesiones que la página dejó abiertas sin usar (más de 15 min)."""
    while True:
        time.sleep(60)
        for sid, s in list(SESSIONS.items()):
            if not s.open or time.time() - s.last_use > 900:
                s.close()
                SESSIONS.pop(sid, None)


def run(port, token):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "content-type, x-token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

        def _send(self, code, obj):
            raw = json.dumps(obj).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def _auth(self):
            if not secrets.compare_digest(self.headers.get("X-Token", ""), token):
                self._send(401, {"error": "código incorrecto"})
                return False
            return True

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/hola":  # sin código: solo dice que existe
                return self._send(200, {"puente": True, "version": VERSION, "serial": serial is not None, "ssh": paramiko is not None})
            if not self._auth():
                return
            q = parse_qs(u.query)
            if u.path == "/puertos":
                return self._send(200, {"ports": list_ports(), "serial": serial is not None})
            if u.path == "/leer":
                s = SESSIONS.get(q.get("sid", [""])[0])
                if not s:
                    return self._send(404, {"error": "sesión inexistente", "abierto": False})
                s.last_use = time.time()
                d, n, op = s.read(int(q.get("desde", ["0"])[0]), wait=0.8)
                return self._send(200, {"d": d, "n": n, "abierto": op, "error": s.error})
            self._send(404, {"error": "no existe"})

        def do_POST(self):
            if not self._auth():
                return
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0") or 0)) or b"{}")
            except Exception:
                return self._send(400, {"error": "datos inválidos"})
            p = urlparse(self.path).path
            try:
                if p == "/abrir":
                    if body.get("kind") == "serial":
                        if serial is None:
                            return self._send(500, {"error": "Falta pyserial: ejecuta  python -m pip install pyserial"})
                        s = SerialSession(str(body["port"]), int(body.get("baud", 9600)))
                    elif body.get("kind") == "ssh":
                        if paramiko is None:
                            return self._send(500, {"error": "Falta paramiko: ejecuta  python -m pip install paramiko"})
                        s = SshSession(str(body["host"]).strip(), int(body.get("port", 22)), str(body.get("user", "")), str(body.get("password", "")))
                    else:
                        return self._send(400, {"error": "tipo desconocido"})
                    sid = secrets.token_hex(8)
                    SESSIONS[sid] = s
                    return self._send(200, {"sid": sid})
                s = SESSIONS.get(str(body.get("sid", "")))
                if p == "/escribir":
                    if not s or not s.open:
                        return self._send(409, {"error": "la conexión está cerrada"})
                    s.last_use = time.time()
                    s.write(str(body.get("d", "")))
                    return self._send(200, {"ok": True})
                if p == "/cerrar":
                    if s:
                        s.close()
                        SESSIONS.pop(str(body.get("sid", "")), None)
                    return self._send(200, {"ok": True})
            except Exception as e:
                msg = str(e) or e.__class__.__name__
                if "Authentication" in msg:
                    msg = "Usuario o contraseña incorrectos."
                return self._send(400, {"error": msg})
            self._send(404, {"error": "no existe"})

    threading.Thread(target=sweep, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print("\n ============================================")
    print("  PUENTE LOCAL activo en http://127.0.0.1:%d" % port)
    print("  CÓDIGO PARA LA PÁGINA:  %s" % token)
    print("  Puertos detectados ahora: %s" % (", ".join(p["device"] for p in list_ports()) or "ninguno"))
    print(" ============================================")
    print("  Déjalo abierto mientras usas el CheckList. Ctrl+C para cerrar.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n Cerrado.")


def stored_code():
    """El código se recuerda entre ejecuciones para no tener que pegarlo cada vez en la página."""
    path = os.path.join(os.path.expanduser("~"), ".netops_puente")
    try:
        with open(path) as f:
            c = f.read().strip()
            if len(c) >= 6:
                return c
    except OSError:
        pass
    c = secrets.token_hex(3).upper()
    try:
        with open(path, "w") as f:
            f.write(c)
        os.chmod(path, 0o600)
    except OSError:
        pass
    return c


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Puente local de consola y SSH para NetOps Suite")
    ap.add_argument("--puerto", type=int, default=8766)
    ap.add_argument("--codigo", default="")
    a = ap.parse_args()
    run(a.puerto, a.codigo or stored_code())

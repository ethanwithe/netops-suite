#!/usr/bin/env python3
"""
SATURADOR bidireccional por ICMP  (NetOps Suite)

Genera tráfico en AMBOS sentidos al mismo tiempo, como lo hace iperf, pero
sin necesitar un servidor en el otro extremo: cada "echo request" grande
sale hacia el destino (subida) y el destino responde con un "echo reply" del
mismo tamaño (bajada). Sirve contra cualquier IP que conteste ping:
  - Internet:  8.8.8.8, 1.1.1.1, ...
  - RPV:       la gateway del cliente, el siguiente salto o una IP de cabecera.

Uso (línea de comandos):
    python saturador.py 8.8.8.8 --mbps 100 --seg 60

Uso (controlado desde la página del CheckList, recomendado):
    python saturador.py --agente
  Deja abierto este programa, copia el CÓDIGO que muestra y pégalo en la página.
  Desde ahí inicias y detienes la saturación y ves los Mbps en vivo.

    --mbps   Mbps por CADA sentido (100 = 100 Mbps de subida + 100 de bajada).
    --seg    Duración en segundos (0 = hasta Ctrl+C).
    --tam    Bytes de datos por paquete (por defecto 1400; hasta 60000, los
             grandes se fragmentan y permiten más Mbps con menos CPU).
    --hilos  Hilos emisores (por defecto, automático).

Requisitos: Python 3.8+ sin instalar nada.
  - Windows: no necesita administrador.
  - Linux / macOS: ejecutar con sudo (usa socket ICMP "raw").
Para detener: Ctrl+C. Úsalo solo en equipos/enlaces que tengas autorizados.
"""
import argparse
import os
import socket
import struct
import sys
import threading
import time

IP_OVERHEAD = 28  # cabecera IPv4 (20) + ICMP (8)


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.tx_bytes = 0
        self.rx_bytes = 0
        self.tx_pkts = 0
        self.rx_pkts = 0

    def add_tx(self, n):
        with self.lock:
            self.tx_bytes += n
            self.tx_pkts += 1

    def add_rx(self, n):
        with self.lock:
            self.rx_bytes += n
            self.rx_pkts += 1

    def snap(self):
        with self.lock:
            return self.tx_bytes, self.rx_bytes, self.tx_pkts, self.rx_pkts


class Pacer:
    """Reparte el ritmo total (bytes/seg) entre los hilos con un 'cubo de fichas'."""

    def __init__(self, bytes_per_sec):
        self.rate = float(bytes_per_sec)
        self.lock = threading.Lock()
        self.next_t = time.perf_counter()

    def wait(self, nbytes):
        with self.lock:
            now = time.perf_counter()
            if self.next_t < now - 0.05:       # no acumular deuda: evita ráfagas
                self.next_t = now - 0.05
            self.next_t += nbytes / self.rate
            delay = self.next_t - now
        if delay > 0:
            time.sleep(delay)


def words_sum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\0"
    return sum(struct.unpack("!%dH" % (len(data) // 2), data))


def fold(s: int) -> int:
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    return ~s & 0xFFFF


def checksum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\0"
    s = sum(struct.unpack("!%dH" % (len(data) // 2), data))
    s = (s >> 16) + (s & 0xFFFF)
    s += s >> 16
    return ~s & 0xFFFF


# ---------------------------------------------------------------- Linux / macOS
def run_raw(dest, size, pacer, stats, stop, threads):
    try:
        rx = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        kind = "raw"
    except PermissionError:
        try:
            rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_ICMP)
            kind = "dgram"
        except Exception:
            raise RuntimeError("Sin permisos para enviar ICMP. Ejecuta con:  sudo python3 saturador.py ...")
    rx.settimeout(0.5)
    try:
        rx.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 * 1024 * 1024)
    except OSError:
        pass
    ident = os.getpid() & 0xFFFF
    payload = os.urandom(size)
    base = words_sum(payload) + 0x0800 + ident      # suma fija: solo cambia "seq" en cada paquete
    pack = struct.Struct("!BBHHH").pack

    def receiver():
        while not stop.is_set():
            try:
                data, _ = rx.recvfrom(70000)
            except socket.timeout:
                continue
            except OSError:
                break
            off = 20 if kind == "raw" else 0
            if len(data) > off + 8 and data[off] == 0:   # echo reply
                stats.add_rx(len(data) - off + (20 if kind == "dgram" else 0))

    def sender(idx):
        seq = idx * 1000
        pkt_bytes = size + IP_OVERHEAD
        rate = pacer.rate / threads          # bytes/seg que le toca a este hilo
        t0 = time.perf_counter()
        sent = 0.0
        while not stop.is_set():
            due = (time.perf_counter() - t0) * rate - sent
            n = int(due // pkt_bytes)
            if n <= 0:
                time.sleep(0.0005)
                continue
            if n > 400:                       # no acumular deuda (evita ráfagas enormes)
                sent += (n - 400) * pkt_bytes
                n = 400
            for _ in range(n):
                seq = (seq + 1) & 0xFFFF
                pkt = pack(8, 0, fold(base + seq), ident, seq) + payload
                try:
                    rx.sendto(pkt, (dest, 0))
                    stats.add_tx(pkt_bytes)
                except OSError:
                    time.sleep(0.005)
                    break
                sent += pkt_bytes

    ts = [threading.Thread(target=receiver, daemon=True)]
    ts += [threading.Thread(target=sender, args=(i,), daemon=True) for i in range(threads)]
    for t in ts:
        t.start()
    return rx


# ---------------------------------------------------------------- Windows
def run_windows(dest, size, pacer, stats, stop, threads):
    import ctypes
    from ctypes import wintypes

    ip = ctypes.windll.iphlpapi

    class ICMP_ECHO_REPLY(ctypes.Structure):
        _fields_ = [("Address", wintypes.ULONG), ("Status", wintypes.ULONG),
                    ("RoundTripTime", wintypes.ULONG), ("DataSize", wintypes.USHORT),
                    ("Reserved", wintypes.USHORT), ("Data", ctypes.c_void_p),
                    ("Options", ctypes.c_ubyte * 8)]

    ip.IcmpCreateFile.restype = wintypes.HANDLE
    addr = struct.unpack("<L", socket.inet_aton(dest))[0]
    payload = ctypes.create_string_buffer(os.urandom(size), size)
    pkt_bytes = size + IP_OVERHEAD

    def worker():
        h = ip.IcmpCreateFile()
        reply_size = ctypes.sizeof(ICMP_ECHO_REPLY) + size + 64
        reply = ctypes.create_string_buffer(reply_size)
        while not stop.is_set():
            pacer.wait(pkt_bytes)
            n = ip.IcmpSendEcho(h, addr, payload, size, None, reply, reply_size, 1000)
            stats.add_tx(pkt_bytes)
            if n:
                stats.add_rx(pkt_bytes)
        ip.IcmpCloseHandle(h)

    for _ in range(threads):
        threading.Thread(target=worker, daemon=True).start()


# ---------------------------------------------------------------- núcleo reutilizable
class Saturator:
    """Una saturación en curso: start() / stop() / status()."""

    def __init__(self):
        self.stop_ev = threading.Event()
        self.stats = None
        self.running = False
        self.dest = ""
        self.mbps = 0.0
        self.seg = 0
        self.size = 1400
        self.threads = 0
        self.t0 = 0.0
        self.tx = self.rx = 0.0
        self.peak_tx = self.peak_rx = 0.0
        self.loss = 0.0
        self.error = ""
        self._sock = None
        self._lock = threading.Lock()

    def start(self, dest, mbps, seg=60, size=1400, threads=0):
        with self._lock:
            if self.running:
                raise RuntimeError("Ya hay una saturación en curso.")
            if mbps <= 0:
                raise ValueError("Los Mbps deben ser mayores que 0.")
            size = max(16, min(int(size), 60000))
            try:
                ip = socket.gethostbyname(dest)
            except OSError:
                raise ValueError(f"No se pudo resolver {dest}")
            bps = mbps * 1e6 / 8
            pps = bps / (size + IP_OVERHEAD)
            windows = os.name == "nt"
            threads = threads or (max(8, min(128, int(pps / 250) + 8)) if windows
                                  else max(1, min(8, int(pps / 8000) + 1)))
            self.stop_ev = threading.Event()
            self.stats = Stats()
            pacer = Pacer(bps)
            self.error = ""
            if windows:
                run_windows(ip, size, pacer, self.stats, self.stop_ev, threads)
                self._sock = None
            else:
                self._sock = run_raw(ip, size, pacer, self.stats, self.stop_ev, threads)
            self.dest, self.mbps, self.seg, self.size, self.threads = ip, mbps, int(seg), size, threads
            self.t0 = time.time()
            self.tx = self.rx = self.peak_tx = self.peak_rx = self.loss = 0.0
            self.running = True
            threading.Thread(target=self._sampler, daemon=True).start()

    def _sampler(self):
        last_t = self.t0
        last = self.stats.snap()
        while not self.stop_ev.is_set():
            time.sleep(1)
            now = time.time()
            cur = self.stats.snap()
            dt = max(now - last_t, 1e-6)
            self.tx = (cur[0] - last[0]) * 8 / dt / 1e6
            self.rx = (cur[1] - last[1]) * 8 / dt / 1e6
            self.peak_tx, self.peak_rx = max(self.peak_tx, self.tx), max(self.peak_rx, self.rx)
            self.loss = max(0.0, 100.0 * (1 - cur[3] / cur[2])) if cur[2] else 0.0
            last, last_t = cur, now
            if self.seg and now - self.t0 >= self.seg:
                break
        self.stop()

    def stop(self):
        self.stop_ev.set()
        if self._sock is not None:
            time.sleep(0.2)
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        self.running = False

    def status(self):
        s = self.stats.snap() if self.stats else (0, 0, 0, 0)
        return {
            "corriendo": self.running, "destino": self.dest, "mbps": self.mbps,
            "tx_mbps": round(self.tx, 1), "rx_mbps": round(self.rx, 1),
            "pico_tx": round(self.peak_tx, 1), "pico_rx": round(self.peak_rx, 1),
            "perdida": round(self.loss, 1),
            "segundos": int(time.time() - self.t0) if self.running else 0,
            "duracion": self.seg, "paquetes_tx": s[2], "paquetes_rx": s[3],
        }


# ---------------------------------------------------------------- agente local (HTTP)
def can_send_icmp() -> bool:
    if os.name == "nt":
        return True
    try:
        socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP).close()
        return True
    except OSError:
        return False


def run_agent(port, token):
    """Servidor SOLO local (127.0.0.1) para que la página del CheckList controle la saturación."""
    import json
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    sat = Saturator()
    can = can_send_icmp()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type, x-token")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def _auth(self):
            if self.headers.get("X-Token", "") != token:
                self._send(401, {"error": "Código incorrecto."})
                return False
            return True

        def do_GET(self):
            if self.path.startswith("/estado"):
                if self.headers.get("X-Token", "") != token:
                    # sin código solo se sabe que el agente existe
                    return self._send(401, {"agente": True, "error": "Código incorrecto."})
                return self._send(200, {"agente": True, "icmp": can, "so": os.name, **sat.status()})
            self._send(404, {"error": "no existe"})

        def do_POST(self):
            if not self._auth():
                return
            n = int(self.headers.get("Content-Length") or 0)
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._send(400, {"error": "JSON inválido"})
            try:
                if self.path.startswith("/iniciar"):
                    if not can:
                        return self._send(403, {"error": "Sin permisos ICMP: abre el agente con sudo (Linux/Mac)."})
                    sat.start(str(data.get("destino", "")).strip(), float(data.get("mbps", 0)),
                              int(data.get("seg", 60) or 0), int(data.get("tam", 1400) or 1400))
                elif self.path.startswith("/detener"):
                    sat.stop()
                else:
                    return self._send(404, {"error": "no existe"})
            except (ValueError, RuntimeError) as e:
                return self._send(400, {"error": str(e)})
            self._send(200, {"agente": True, "icmp": can, "so": os.name, **sat.status()})

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print("=" * 60)
    print(" AGENTE DE SATURACIÓN activo en http://127.0.0.1:%d" % port)
    print(" CÓDIGO PARA LA PÁGINA:  %s" % token)
    if not can:
        print(" AVISO: sin permisos para ICMP. Cierra y vuelve a abrir con:  sudo python3 saturador.py --agente")
    print(" Déjalo abierto mientras hagas el CheckList. Ctrl+C para cerrar.")
    print("=" * 60)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    sat.stop()


# ---------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description="Saturador bidireccional por ICMP")
    ap.add_argument("destino", nargs="?", help="IP o nombre (8.8.8.8, gateway, siguiente salto...)")
    ap.add_argument("--mbps", type=float, help="Mbps por cada sentido")
    ap.add_argument("--seg", type=int, default=60, help="duración en segundos (0 = infinito)")
    ap.add_argument("--tam", type=int, default=1400, help="bytes de datos por paquete")
    ap.add_argument("--hilos", type=int, default=0, help="hilos emisores (0 = automático)")
    ap.add_argument("--agente", action="store_true", help="modo agente: se controla desde la página del CheckList")
    ap.add_argument("--puerto", type=int, default=8765, help="puerto del agente (por defecto 8765)")
    ap.add_argument("--codigo", default="", help="código fijo para el agente (por defecto, uno aleatorio)")
    a = ap.parse_args()

    if a.agente:
        import secrets
        run_agent(a.puerto, a.codigo or secrets.token_hex(3).upper())
        return
    if not a.destino or not a.mbps or a.mbps <= 0:
        ap.error("indica el destino y --mbps (o usa --agente)")

    sat = Saturator()
    try:
        sat.start(a.destino, a.mbps, a.seg, a.tam, a.hilos)
    except (ValueError, RuntimeError) as e:
        sys.exit(str(e))
    pps = a.mbps * 1e6 / 8 / (sat.size + IP_OVERHEAD)
    print(f"Saturando {sat.dest}: objetivo {a.mbps:g} Mbps ▲ subida + {a.mbps:g} Mbps ▼ bajada "
          f"(paquetes de {sat.size} B, ~{pps:,.0f} pps, {sat.threads} hilos). Ctrl+C para detener.")
    try:
        while sat.running:
            time.sleep(1)
            st = sat.status()
            print(f"[{st['segundos']:>4}s]  ▲ {st['tx_mbps']:8.1f} Mbps   ▼ {st['rx_mbps']:8.1f} Mbps   pérdida {st['perdida']:5.1f}%", flush=True)
    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
    sat.stop()
    st = sat.status()
    el = max(time.time() - sat.t0, 1e-6)
    tx_b, rx_b, tp, rp = sat.stats.snap()
    print(f"\nResumen: ▲ promedio {tx_b*8/el/1e6:.1f} Mbps (pico {st['pico_tx']:.1f})   "
          f"▼ promedio {rx_b*8/el/1e6:.1f} Mbps (pico {st['pico_rx']:.1f})   "
          f"paquetes {tp:,} enviados / {rp:,} respondidos")
    if rp == 0:
        print("AVISO: el destino no responde ping; prueba con otra IP (gateway, siguiente salto).")


if __name__ == "__main__":
    main()

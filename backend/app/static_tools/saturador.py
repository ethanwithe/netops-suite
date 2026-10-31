#!/usr/bin/env python3
"""
SATURADOR bidireccional por ICMP  (NetOps Suite)

Genera tráfico en AMBOS sentidos al mismo tiempo, como lo hace iperf, pero
sin necesitar un servidor en el otro extremo: cada "echo request" grande
sale hacia el destino (subida) y el destino responde con un "echo reply" del
mismo tamaño (bajada). Sirve contra cualquier IP que conteste ping:
  - Internet:  8.8.8.8, 1.1.1.1, ...
  - RPV:       la gateway del cliente, el siguiente salto o una IP de cabecera.

Uso:
    python saturador.py 8.8.8.8 --mbps 100 --seg 60

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
            sys.exit("Sin permisos para enviar ICMP. Ejecuta con:  sudo python3 saturador.py ...")
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


# ---------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description="Saturador bidireccional por ICMP")
    ap.add_argument("destino", help="IP o nombre (8.8.8.8, gateway, siguiente salto...)")
    ap.add_argument("--mbps", type=float, required=True, help="Mbps por cada sentido")
    ap.add_argument("--seg", type=int, default=60, help="duración en segundos (0 = infinito)")
    ap.add_argument("--tam", type=int, default=1400, help="bytes de datos por paquete")
    ap.add_argument("--hilos", type=int, default=0, help="hilos emisores (0 = automático)")
    a = ap.parse_args()

    if a.mbps <= 0:
        sys.exit("--mbps debe ser mayor que 0")
    size = max(16, min(a.tam, 60000))
    try:
        dest = socket.gethostbyname(a.destino)
    except OSError:
        sys.exit(f"No se pudo resolver {a.destino}")

    bytes_per_sec = a.mbps * 1e6 / 8
    pps = bytes_per_sec / (size + IP_OVERHEAD)
    windows = os.name == "nt"
    threads = a.hilos or (max(8, min(128, int(pps / 250) + 8)) if windows else max(1, min(8, int(pps / 8000) + 1)))
    stats, stop = Stats(), threading.Event()
    pacer = Pacer(bytes_per_sec)

    print(f"Saturando {dest}: objetivo {a.mbps:g} Mbps ▲ subida + {a.mbps:g} Mbps ▼ bajada "
          f"(paquetes de {size} B, ~{pps:,.0f} pps, {threads} hilos). Ctrl+C para detener.")
    sock = None
    if windows:
        run_windows(dest, size, pacer, stats, stop, threads)
    else:
        sock = run_raw(dest, size, pacer, stats, stop, threads)

    t0 = last_t = time.time()
    last = stats.snap()
    peak_tx = peak_rx = 0.0
    try:
        while a.seg == 0 or time.time() - t0 < a.seg:
            time.sleep(1)
            now = time.time()
            cur = stats.snap()
            dt = now - last_t
            tx = (cur[0] - last[0]) * 8 / dt / 1e6
            rx = (cur[1] - last[1]) * 8 / dt / 1e6
            peak_tx, peak_rx = max(peak_tx, tx), max(peak_rx, rx)
            lost = 100.0 * (1 - cur[3] / cur[2]) if cur[2] else 0.0
            print(f"[{int(now - t0):>4}s]  ▲ {tx:8.1f} Mbps   ▼ {rx:8.1f} Mbps   pérdida {max(lost,0):5.1f}%", flush=True)
            last, last_t = cur, now
    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
    stop.set()
    if sock:
        time.sleep(0.2)
        sock.close()
    tx_b, rx_b, tp, rp = stats.snap()
    el = max(time.time() - t0, 1e-6)
    print(f"\nResumen: ▲ promedio {tx_b*8/el/1e6:.1f} Mbps (pico {peak_tx:.1f})   "
          f"▼ promedio {rx_b*8/el/1e6:.1f} Mbps (pico {peak_rx:.1f})   "
          f"paquetes {tp:,} enviados / {rp:,} respondidos")
    if rp == 0:
        print("AVISO: el destino no responde ping; prueba con otra IP (gateway, siguiente salto).")


if __name__ == "__main__":
    main()

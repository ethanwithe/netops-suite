"""
trafficgen.py
Generador de tráfico por puerto (estilo Ostinato, pero bidireccional de verdad):
  1. Se elige el puerto (tarjeta de red) y se «configura» como bidireccional.
  2. Cada ítem es una trama Ethernet + IPv4 + ICMP (MAC/IP origen y destino, tamaño, ancho de banda).
  3. En modo bidireccional cada ítem genera A→B y B→A a la vez, cada sentido con su propio hilo y su propio ritmo,
     y se mide por separado: enviado, recibido, pérdida, latencia y jitter de cada sentido.

Solo escritorio. Envía tramas crudas: Windows necesita Npcap (modo «WinPcap compatible» o wpcap.dll), Linux usa
AF_PACKET (root). Para pruebas existe un backend en memoria (FakeBackend).
"""
import ctypes
import ctypes.util
import os
import platform
import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

MAGIC = b"NOPS"
MIN_FRAME = 64
MAX_FRAME = 9000          # jumbo
OVERHEAD = 20             # preámbulo + IFG: el ancho de banda se cuenta en la línea, como lo ve el equipo de red


# ---------------------------------------------------------------- tramas
def parse_mac(s: str) -> bytes:
    h = "".join(ch for ch in str(s) if ch in "0123456789abcdefABCDEF")
    if len(h) != 12:
        raise ValueError(f"MAC inválida: {s!r}")
    return bytes.fromhex(h)


def parse_ip(s: str) -> bytes:
    try:
        return socket.inet_aton(str(s).strip())
    except OSError as e:
        raise ValueError(f"IP inválida: {s!r}") from e


def checksum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\0"
    s = sum(struct.unpack("!%dH" % (len(data) // 2), data))
    while s >> 16:
        s = (s & 0xFFFF) + (s >> 16)
    return (~s) & 0xFFFF


def build_icmp_frame(src_mac, dst_mac, src_ip, dst_ip, size=128, ttl=64, ident=1, seq=0, flow=0,
                     icmp_type=8, tag_ts=True) -> bytes:
    """Trama Ethernet II + IPv4 + ICMP echo de `size` bytes en total (sin FCS). El payload lleva flujo/secuencia/hora."""
    size = max(MIN_FRAME - 4, min(int(size), MAX_FRAME))
    ip_len = size - 14
    icmp_len = ip_len - 20
    body_len = icmp_len - 8
    stamp = struct.pack("!4sHIQ", MAGIC, flow & 0xFFFF, seq & 0xFFFFFFFF, time.perf_counter_ns() if tag_ts else 0)
    payload = (stamp + bytes((i & 0xFF) for i in range(max(0, body_len - len(stamp)))))[:body_len]
    icmp = struct.pack("!BBHHH", icmp_type, 0, 0, ident & 0xFFFF, seq & 0xFFFF) + payload
    icmp = icmp[:2] + struct.pack("!H", checksum(icmp)) + icmp[4:]
    ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, ip_len, ident & 0xFFFF, 0, ttl & 0xFF, 1, 0, src_ip, dst_ip)
    ip = ip[:10] + struct.pack("!H", checksum(ip)) + ip[12:]
    return dst_mac + src_mac + b"\x08\x00" + ip + icmp


def parse_tag(frame: bytes):
    """-> (flow, seq, t_ns) si la trama es de este generador (ICMP con nuestra marca), si no None."""
    if len(frame) < 14 + 20 + 8 + 18 or frame[12:14] != b"\x08\x00":
        return None
    ihl = (frame[14] & 0x0F) * 4
    if frame[14 + 9] != 1:
        return None
    off = 14 + ihl + 8
    if frame[off:off + 4] != MAGIC:
        return None
    _m, flow, seq, t = struct.unpack("!4sHIQ", frame[off:off + 18])
    return flow, seq, t


def wire_bits(size: int) -> int:
    return (max(size, MIN_FRAME - 4) + 4 + OVERHEAD) * 8


# ---------------------------------------------------------------- backends
class Backend:
    name = "base"

    def send(self, frame: bytes) -> None:
        raise NotImplementedError

    def recv(self, timeout: float = 0.05) -> Optional[bytes]:
        raise NotImplementedError

    def close(self) -> None:
        pass


class FakeBackend(Backend):
    """En memoria (pruebas): lo enviado vuelve por la recepción, opcionalmente perdiendo 1 de cada `drop`."""
    name = "fake"

    def __init__(self, drop: int = 0, only_dst: Optional[bytes] = None):
        import queue
        self.q = queue.Queue()
        self.drop = drop
        self.n = 0
        self.sent = 0
        self.lock = threading.Lock()

    def send(self, frame):
        with self.lock:
            self.sent += 1
            self.n += 1
            if self.drop and self.n % self.drop == 0:
                return
        self.q.put(frame)

    def recv(self, timeout=0.05):
        import queue
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None


class AfPacketBackend(Backend):
    name = "af_packet"

    def __init__(self, iface: str):
        self.s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0003))
        self.s.bind((iface, 0))
        self.s.settimeout(0.05)

    def send(self, frame):
        self.s.send(frame)

    def recv(self, timeout=0.05):
        try:
            data, addr = self.s.recvfrom(65535)
        except (socket.timeout, BlockingIOError):
            return None
        return None if addr[2] == 4 else data       # 4 = PACKET_OUTGOING: lo que enviamos nosotros no cuenta como recibido

    def close(self):
        self.s.close()


class PcapBackend(Backend):
    """libpcap / Npcap por ctypes (sin dependencias extra)."""
    name = "pcap"

    def __init__(self, dev: str):
        self.lib = _load_pcap()
        err = ctypes.create_string_buffer(256)
        self.h = self.lib.pcap_open_live(dev.encode(), 65535, 1, 20, err)
        if not self.h:
            raise OSError(err.value.decode(errors="replace") or "No se pudo abrir el puerto")
        try:
            self.lib.pcap_setdirection(self.h, 1)      # PCAP_D_IN: solo lo que llega, no lo que enviamos
        except Exception:  # noqa: BLE001
            pass
        self._hdr = ctypes.c_void_p()
        self._dat = ctypes.POINTER(ctypes.c_ubyte)()

    def send(self, frame):
        self.lib.pcap_sendpacket(self.h, frame, len(frame))

    def recv(self, timeout=0.05):
        r = self.lib.pcap_next_ex(self.h, ctypes.byref(self._hdr), ctypes.byref(self._dat))
        if r != 1:
            return None
        caplen = ctypes.cast(self._hdr, ctypes.POINTER(ctypes.c_uint32 * 4)).contents[2]
        return bytes(self._dat[:caplen])

    def close(self):
        if getattr(self, "h", None):
            self.lib.pcap_close(self.h)
            self.h = None


_pcap = None


def _load_pcap():
    global _pcap
    if _pcap is not None:
        return _pcap
    if platform.system() == "Windows":
        dll_dir = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "Npcap")
        if os.path.isdir(dll_dir) and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(dll_dir)
        names = ["wpcap.dll", os.path.join(dll_dir, "wpcap.dll")]
    else:
        names = [ctypes.util.find_library("pcap") or "libpcap.so.0.8", "libpcap.so.1", "libpcap.dylib"]
    last = None
    for n in names:
        try:
            lib = ctypes.CDLL(n)
            break
        except OSError as e:
            last = e
    else:
        raise OSError("No se encontró Npcap/libpcap. Instala Npcap (https://npcap.com) marcando «WinPcap API-compatible Mode». " + str(last or ""))
    lib.pcap_open_live.restype = ctypes.c_void_p
    lib.pcap_open_live.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_char_p]
    lib.pcap_sendpacket.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    lib.pcap_next_ex.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
    try:
        lib.pcap_setdirection.argtypes = [ctypes.c_void_p, ctypes.c_int]
    except AttributeError:
        pass
    lib.pcap_close.argtypes = [ctypes.c_void_p]
    lib.pcap_findalldevs.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p]
    lib.pcap_freealldevs.argtypes = [ctypes.c_void_p]
    _pcap = lib
    return lib


class _PcapIf(ctypes.Structure):
    pass


_PcapIf._fields_ = [("next", ctypes.POINTER(_PcapIf)), ("name", ctypes.c_char_p), ("description", ctypes.c_char_p),
                    ("addresses", ctypes.c_void_p), ("flags", ctypes.c_uint32)]


def list_ports() -> dict:
    """Puertos disponibles: [{id, nombre, mac}] y, si no se puede enviar tramas crudas, el motivo."""
    ports: List[dict] = []
    why = ""
    if platform.system() == "Linux" and hasattr(socket, "AF_PACKET"):
        try:
            for n in sorted(os.listdir("/sys/class/net")):
                try:
                    mac = open(f"/sys/class/net/{n}/address").read().strip()
                except OSError:
                    mac = ""
                ports.append({"id": n, "nombre": n, "mac": mac, "motor": "af_packet"})
            if os.geteuid() != 0:
                why = "Para enviar tramas crudas hay que ejecutar la app como administrador (root)."
            return {"ports": ports, "motivo": why}
        except OSError:
            pass
    try:
        lib = _load_pcap()
        alld = ctypes.c_void_p()
        err = ctypes.create_string_buffer(256)
        if lib.pcap_findalldevs(ctypes.byref(alld), err) == 0:
            p = ctypes.cast(alld, ctypes.POINTER(_PcapIf))
            while p:
                d = p.contents
                nm = (d.name or b"").decode(errors="replace")
                ds = (d.description or b"").decode(errors="replace")
                ports.append({"id": nm, "nombre": ds or nm, "mac": "", "motor": "pcap"})
                p = d.next
            lib.pcap_freealldevs(alld)
    except OSError as e:
        why = str(e)
    return {"ports": ports, "motivo": why}


def open_backend(port_id: str) -> Backend:
    if platform.system() == "Linux" and hasattr(socket, "AF_PACKET"):
        return AfPacketBackend(port_id)
    return PcapBackend(port_id)


# ---------------------------------------------------------------- motor
@dataclass
class Item:
    id: int
    nombre: str = "ICMP"
    src_mac: str = ""
    dst_mac: str = ""
    src_ip: str = "10.0.0.1"
    dst_ip: str = "10.0.0.2"
    size: int = 1024              # bytes por trama (sin FCS)
    mbps: float = 100.0           # ancho de banda a saturar, por sentido
    mbps_rev: Optional[float] = None   # sentido inverso (si no, igual)
    ttl: int = 64
    bidir: Optional[bool] = None  # None = lo que diga el puerto
    activo: bool = True


class _Flow:
    """Un sentido de un ítem: su propio hilo, su ritmo y sus contadores."""

    def __init__(self, fid, label, frame_args, size, mbps):
        self.fid, self.label, self.args, self.size, self.mbps = fid, label, frame_args, size, mbps
        self.tx = self.tx_bytes = self.rx = self.rx_bytes = 0
        self.seq = 0
        self.lat_sum = self.lat_n = 0
        self.lat_min = None
        self.lat_max = 0
        self.jit = 0.0
        self._last = None
        self.window: List = []    # (t, tx_bytes, rx_bytes) para Mbps instantáneos
        self.peak_tx = self.peak_rx = 0.0

    def pps(self):
        return max(1.0, self.mbps * 1e6 / wire_bits(self.size))


class Engine:
    def __init__(self, backend: Backend, bidir: bool = True):
        self.backend = backend
        self.bidir = bidir
        self.items: List[Item] = []
        self.flows: Dict[int, _Flow] = {}
        self.running = False
        self.t0 = 0.0
        self.duracion = 0
        self.error = ""
        self._threads: List[threading.Thread] = []
        self._stop = threading.Event()
        self._lock = threading.Lock()

    # --- configuración
    def build_flows(self):
        self.flows = {}
        for it in self.items:
            if not it.activo:
                continue
            sm, dm, si, di = parse_mac(it.src_mac), parse_mac(it.dst_mac), parse_ip(it.src_ip), parse_ip(it.dst_ip)
            size = max(MIN_FRAME - 4, min(int(it.size), MAX_FRAME))
            fwd = _Flow(it.id * 2, f"{it.nombre} A→B", (sm, dm, si, di, it.ttl), size, float(it.mbps))
            self.flows[fwd.fid] = fwd
            bid = self.bidir if it.bidir is None else it.bidir
            if bid:
                rev = _Flow(it.id * 2 + 1, f"{it.nombre} B→A", (dm, sm, di, si, it.ttl), size,
                            float(it.mbps if it.mbps_rev is None else it.mbps_rev))
                self.flows[rev.fid] = rev
        if not self.flows:
            raise ValueError("No hay ítems activos.")

    # --- ejecución
    def start(self, duracion: int = 0):
        self.build_flows()
        self._stop.clear()
        self.error = ""
        self.duracion = int(duracion)
        self.running = True
        self.t0 = time.perf_counter()
        self._threads = [threading.Thread(target=self._rx_loop, daemon=True)]
        for f in self.flows.values():
            self._threads.append(threading.Thread(target=self._tx_loop, args=(f,), daemon=True))
        self._threads.append(threading.Thread(target=self._sampler, daemon=True))
        for t in self._threads:
            t.start()

    def stop(self):
        self._stop.set()
        for t in self._threads:
            t.join(timeout=1.5)
        self.running = False

    def _tx_loop(self, f: _Flow):
        sm, dm, si, di, ttl = f.args
        ident = f.fid & 0xFFFF
        # Ritmo: lotes cada ~1 ms; el reloj manda (si se atrasa, se pone al día sin acumular de más)
        pps = f.pps()
        batch = max(1, int(pps / 1000))
        interval = batch / pps
        nxt = time.perf_counter()
        try:
            while not self._stop.is_set():
                now = time.perf_counter()
                if self.duracion and now - self.t0 >= self.duracion:
                    break
                if now < nxt:
                    d = nxt - now
                    if d > 0.002:
                        time.sleep(d - 0.001)
                    continue
                for _ in range(batch):
                    fr = build_icmp_frame(sm, dm, si, di, f.size, ttl, ident, f.seq, f.fid)
                    self.backend.send(fr)
                    f.seq += 1
                    f.tx += 1
                    f.tx_bytes += len(fr)
                nxt += interval
                if now - nxt > 0.25:
                    nxt = now
        except Exception as e:  # noqa: BLE001
            self.error = f"Error al enviar: {e}"

    def _rx_loop(self):
        try:
            while not self._stop.is_set():
                fr = self.backend.recv(0.05)
                if fr is None:
                    if self.duracion and time.perf_counter() - self.t0 >= self.duracion + 1:
                        break
                    continue
                tag = parse_tag(fr)
                if not tag:
                    continue
                fid, _seq, t_ns = tag
                f = self.flows.get(fid)
                if not f:
                    continue
                f.rx += 1
                f.rx_bytes += len(fr)
                if t_ns:
                    lat = (time.perf_counter_ns() - t_ns) / 1e6
                    if lat >= 0:
                        f.lat_sum += lat
                        f.lat_n += 1
                        f.lat_min = lat if f.lat_min is None else min(f.lat_min, lat)
                        f.lat_max = max(f.lat_max, lat)
                        if f._last is not None:
                            f.jit += (abs(lat - f._last) - f.jit) / 16
                        f._last = lat
        except Exception as e:  # noqa: BLE001
            self.error = f"Error al recibir: {e}"

    def _sampler(self):
        while not self._stop.is_set():
            time.sleep(0.5)
            now = time.perf_counter()
            for f in self.flows.values():
                f.window.append((now, f.tx_bytes, f.rx_bytes))
                f.window = f.window[-4:]
                if len(f.window) >= 2:
                    a, b = f.window[0], f.window[-1]
                    dt = max(b[0] - a[0], 1e-6)
                    f.peak_tx = max(f.peak_tx, (b[1] - a[1]) * 8 / dt / 1e6)
                    f.peak_rx = max(f.peak_rx, (b[2] - a[2]) * 8 / dt / 1e6)
            if self.duracion and now - self.t0 >= self.duracion + 1:
                self.running = False
                break

    # --- estado
    def status(self) -> dict:
        now = time.perf_counter()
        out = []
        for f in self.flows.values():
            tx_m = rx_m = 0.0
            if len(f.window) >= 2:
                a, b = f.window[0], f.window[-1]
                dt = max(b[0] - a[0], 1e-6)
                tx_m = (b[1] - a[1]) * 8 / dt / 1e6
                rx_m = (b[2] - a[2]) * 8 / dt / 1e6
            lost = max(0, f.tx - f.rx)
            out.append({
                "id": f.fid, "nombre": f.label, "objetivo_mbps": f.mbps, "tx": f.tx, "rx": f.rx,
                "tx_mbps": round(tx_m, 2), "rx_mbps": round(rx_m, 2),
                "pico_tx": round(f.peak_tx, 2), "pico_rx": round(f.peak_rx, 2),
                "perdida": round(100.0 * lost / f.tx, 2) if f.tx else 0.0,
                "lat_ms": round(f.lat_sum / f.lat_n, 3) if f.lat_n else None,
                "lat_min": round(f.lat_min, 3) if f.lat_min is not None else None,
                "lat_max": round(f.lat_max, 3) if f.lat_n else None,
                "jitter_ms": round(f.jit, 3) if f.lat_n else None,
            })
        return {"corriendo": self.running, "segundos": round(now - self.t0, 1) if self.t0 else 0,
                "duracion": self.duracion, "error": self.error, "flujos": out,
                "total_tx_mbps": round(sum(x["tx_mbps"] for x in out), 2),
                "total_rx_mbps": round(sum(x["rx_mbps"] for x in out), 2)}

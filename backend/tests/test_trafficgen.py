import struct
import time

from app.services import trafficgen as TG

M1, M2 = "00:11:22:33:44:55", "66:77:88:99:aa:bb"


def test_trama_icmp_checksums_y_tamano():
    fr = TG.build_icmp_frame(TG.parse_mac(M1), TG.parse_mac(M2), TG.parse_ip("10.0.0.1"), TG.parse_ip("10.0.0.2"), 512, flow=7, seq=9)
    assert len(fr) == 512
    assert fr[:6] == TG.parse_mac(M2) and fr[6:12] == TG.parse_mac(M1) and fr[12:14] == b"\x08\x00"
    assert TG.checksum(fr[14:34]) == 0          # cabecera IPv4 válida
    assert TG.checksum(fr[34:]) == 0            # ICMP válido
    assert struct.unpack("!H", fr[16:18])[0] == 512 - 14
    flow, seq, _t = TG.parse_tag(fr)
    assert (flow, seq) == (7, 9)


def test_mac_ip_invalidas():
    for bad in ("zz", "00:11"):
        try:
            TG.parse_mac(bad)
            assert False
        except ValueError:
            pass
    try:
        TG.parse_ip("300.1.1.1")
        assert False
    except ValueError:
        pass


def test_motor_bidireccional_mide_ambos_sentidos():
    be = TG.FakeBackend(drop=10)
    eng = TG.Engine(be, bidir=True)
    eng.items = [TG.Item(id=1, src_mac=M1, dst_mac=M2, size=256, mbps=20)]
    eng.start(duracion=2)
    time.sleep(2.6)
    eng.stop()
    st = eng.status()
    assert {f["nombre"] for f in st["flujos"]} == {"ICMP A→B", "ICMP B→A"}
    for f in st["flujos"]:
        assert f["tx"] > 500 and f["rx"] > 0
        assert 3 < f["perdida"] < 20            # ~10 % de pérdida simulada
        assert f["lat_ms"] is not None
    assert st["error"] == ""


def test_solo_un_sentido():
    be = TG.FakeBackend()
    eng = TG.Engine(be, bidir=False)
    eng.items = [TG.Item(id=1, src_mac=M1, dst_mac=M2, size=128, mbps=5)]
    eng.start(duracion=1)
    time.sleep(1.8)
    eng.stop()
    assert len(eng.status()["flujos"]) == 1


def test_sin_items_activos():
    eng = TG.Engine(TG.FakeBackend())
    eng.items = [TG.Item(id=1, src_mac=M1, dst_mac=M2, activo=False)]
    try:
        eng.start(1)
        assert False
    except ValueError:
        pass

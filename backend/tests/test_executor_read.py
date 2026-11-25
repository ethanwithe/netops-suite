"""Lectura de la salida de un comando: debe esperar a que vuelva el prompt aunque el equipo tarde (p. ej. un
«show ip route» enorme de un banco) y no mezclar con el comando siguiente."""
import time

import pytest

ssh = pytest.importorskip("app.services.ssh_executor")


class FakeChan:
    """Canal que entrega trozos de texto en momentos fijos (segundos desde que se crea)."""

    def __init__(self, plan):
        self.t0 = time.time()
        self.plan = list(plan)   # [(segundo, bytes)]
        self.sent = []

    def recv_ready(self):
        return bool(self.plan) and time.time() - self.t0 >= self.plan[0][0]

    def recv(self, n):
        return self.plan.pop(0)[1]

    def send(self, b):
        self.sent.append(b)


def test_prompt_de_banner():
    assert ssh._prompt_of("Welcome\r\nRouter#") == "Router#"
    assert ssh._prompt_of("x\n<Huawei>") == "<Huawei>"
    assert ssh._prompt_of("sin prompt") == ""


def test_espera_pausas_largas_hasta_el_prompt():
    # la mitad de la tabla llega al instante y la otra mitad 2,2 s después (más que el silencio de 1,3 s de antes)
    plan = [(0.0, b"show ip route\r\nC 10.0.0.0/24 via A\r\n"), (2.2, b"S 10.1.0.0/16 via B\r\nRouter#")]
    out = ssh._read_chunk(FakeChan(plan), quiet_time=1.3, max_time=20, prompt="Router#")
    assert "10.0.0.0/24" in out and "10.1.0.0/16" in out and out.rstrip().endswith("Router#")


def test_sin_prompt_conocido_sigue_por_silencio():
    out = ssh._read_chunk(FakeChan([(0.0, b"hola\r\n")]), quiet_time=0.5, max_time=10)
    assert "hola" in out

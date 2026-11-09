"""Colores de terminal tipo MobaXterm para la salida de comandos del CheckList (PDF y Word).

`segments(line, dark)` parte una línea en trozos (texto, color RGB 0-255 o None = color base).
Reconoce: IPs (con máscara), MAC, interfaces, up/down, errores, comentarios «!» y palabras de configuración.
"""
import re

# (nombre, patrón)
_RULES = [
    ("bad", re.compile(r"\b(?:down|DOWN|Down|notconnect|err-disabled|deleted|failed|FAILED|Failed|error|Error|ERROR|unreachable|Unreachable|invalid|Invalid|timeout|Timeout)\b|\badministratively down\b")),
    ("ok", re.compile(r"\b(?:up|UP|Up|connected|established|Established|ESTABLISHED|operational|Success|success)\b|!{3,}|\b100 percent\b")),
    ("ip", re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?:/\d{1,2})?\b")),
    ("mac", re.compile(r"\b[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\b|\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}\b|\b[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}\b")),
    ("ip", re.compile(r"\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){3,7}(?:/\d{1,3})?\b")),
    ("iface", re.compile(r"\b(?:(?:Gigabit|TenGigabit|TwentyFiveGig|HundredGig|Fast)?Ethernet|Port-channel|Loopback|Tunnel|Serial|Vlanif|Vlan|Eth-Trunk|GigabitEthernet|XGigabitEthernet|MEth|GE|XGE|Gi|Te|Fa|Eth|Po|Lo|Vl|ae|xe|ge|et)[-]?\d[\d/.:]*")),
    ("kw", re.compile(r"^\s*(?:interface|ip address|ip route|description|shutdown|no shutdown|router|network|neighbor|vlan|speed|duplex|switchport|sysname|undo|display|bandwidth)\b")),
]

# Fondo blanco (hoja) y fondo negro (terminal)
_LIGHT = {"ip": (11, 97, 196), "mac": (0, 131, 143), "iface": (176, 92, 0), "ok": (10, 138, 31), "bad": (208, 16, 16),
          "kw": (123, 31, 162), "comment": (122, 122, 122), "prompt": (106, 27, 154)}
_DARK = {"ip": (79, 195, 247), "mac": (77, 208, 225), "iface": (255, 213, 79), "ok": (102, 255, 102), "bad": (255, 107, 107),
         "kw": (206, 147, 216), "comment": (136, 136, 136), "prompt": (89, 216, 88)}


def palette(dark: bool) -> dict:
    return _DARK if dark else _LIGHT


def segments(line: str, dark: bool = False):
    """[(texto, (r, g, b) | None), ...] sin perder ni un carácter."""
    pal = palette(dark)
    if line.lstrip().startswith("!") and not re.match(r"^\s*!{3,}\s*$", line):
        return [(line, pal["comment"])]
    spans = []  # (ini, fin, nombre)
    taken = [False] * len(line)
    for name, rx in _RULES:
        for m in rx.finditer(line):
            a, b = m.span()
            if b <= a or any(taken[a:b]):
                continue
            for i in range(a, b):
                taken[i] = True
            spans.append((a, b, name))
    spans.sort()
    out, pos = [], 0
    for a, b, name in spans:
        if a > pos:
            out.append((line[pos:a], None))
        out.append((line[a:b], pal[name]))
        pos = b
    if pos < len(line):
        out.append((line[pos:], None))
    return out or [(line, None)]


def split_head(line: str, prompt_len: int):
    """Primera línea «prompt + comando»: el prompt de color y el comando con el color base."""
    return line[:prompt_len], line[prompt_len:]


_PROMPT = re.compile(r"^(<[^<>\s]{1,60}>|\[[^\[\]\s]{1,60}\]|[\w.()/:@-]{1,60}?[#>$])(?=\S|\s*$|\s)")


def line_segments(line: str, dark: bool = False, first: bool = False):
    """Como `segments`, pero pinta el nombre del equipo (prompt) de la primera línea (prompt + comando)
    y las líneas que son solo el prompt (al final de la salida)."""
    m = _PROMPT.match(line)
    if m:
        rest = line[m.end():]
        if (first and rest.strip()) or not rest.strip():
            pal = palette(dark)
            out = [(m.group(1), pal["prompt"])]
            if rest:
                out.append((rest, None))
            return out
    return segments(line, dark)

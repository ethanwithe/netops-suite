"""
config_builder.py
Junta los fragmentos elegidos (de templates_store) en el orden correcto y
reemplaza los placeholders {VARIABLE} con los datos que el usuario puso en
el formulario "Generar plantilla completa".

Si una variable no fue proporcionada, se deja resaltada como
[[FALTA:VARIABLE]] en el resultado, para que sea fácil de encontrar y
completar a mano antes de aplicar la plantilla al equipo.
"""

import re

PLACEHOLDER_RE = re.compile(r"\{([A-Z0-9_]+)\}")


def find_placeholders(text):
    """Devuelve el set de nombres de variables {ASI} usados en un texto."""
    return set(PLACEHOLDER_RE.findall(text))


def find_placeholders_in_fragments(fragments):
    """fragments: lista de dicts con clave 'texto'. Devuelve el set de
    variables usadas (para que el frontend sepa qué campos pedir)."""
    all_vars = set()
    for frag in fragments:
        if frag:
            all_vars |= find_placeholders(frag["texto"])
    all_vars -= {"EXTRA_LAN_NETWORKS", "EXTRA_PREFIX_LIST", "ACL_MGMT_LINES", "WAN_INTERFACE_SLUG"}
    return all_vars


def _safe_substitute(text, variables):
    def repl(m):
        key = m.group(1)
        if key in variables and str(variables[key]).strip() != "":
            return str(variables[key])
        return f"[[FALTA:{key}]]"
    return PLACEHOLDER_RE.sub(repl, text)


def build_extra_lan_networks_block(extra_networks):
    """extra_networks: list[{'ip':..., 'mask':...}] -> lineas
    'network X mask Y' adicionales para el address-family de BGP."""
    lines = []
    for net in extra_networks or []:
        ip = net.get("ip", "").strip()
        mask = net.get("mask", "").strip()
        if ip and mask:
            lines.append(f"  network {ip} mask {mask}\n")
    return "".join(lines)


def build_extra_prefix_list_block(extra_networks, start_seq=20):
    lines = []
    seq = start_seq
    for net in extra_networks or []:
        ip = net.get("ip", "").strip()
        prefix_len = net.get("prefix_len", "").strip()
        if ip and prefix_len:
            lines.append(f"ip prefix-list RED_LAN seq {seq} permit {ip}/{prefix_len}\n")
            seq += 10
    return "".join(lines)


def build_acl_mgmt_block(ip_list):
    """ip_list: lista de IPs permitidas para gestion (ACL 25). seq automatico."""
    lines = []
    seq = 10
    for ip in ip_list or []:
        ip = ip.strip()
        if ip:
            lines.append(f" {seq} permit {ip}\n")
            seq += 10
    return "".join(lines)


def build_full_config(fragments, variables, extra_lan_networks=None, acl_mgmt_ips=None):
    """
    fragments: lista de dicts {nombre, orden, texto} YA FILTRADOS/elegidos
               (se reordenan aquí por 'orden')
    variables: dict {NOMBRE_VARIABLE: valor}
    extra_lan_networks: list[{'ip','mask','prefix_len'}] redes LAN adicionales
    acl_mgmt_ips: list[str] IPs adicionales para la ACL de gestion
    """
    variables = dict(variables or {})
    variables["EXTRA_LAN_NETWORKS"] = build_extra_lan_networks_block(extra_lan_networks)
    variables["EXTRA_PREFIX_LIST"] = build_extra_prefix_list_block(extra_lan_networks)
    variables["ACL_MGMT_LINES"] = build_acl_mgmt_block(acl_mgmt_ips)
    if variables.get("WAN_INTERFACE", "").strip():
        variables["WAN_INTERFACE_SLUG"] = variables["WAN_INTERFACE"].replace("/", "_").replace(".", "_")

    frags = sorted([f for f in fragments if f], key=lambda f: f.get("orden", 0))

    parts = []
    for f in frags:
        parts.append(f"! ---- {f['nombre']} ----")
        parts.append(_safe_substitute(f["texto"], variables))
    return "\n".join(parts)


def to_command_lines(full_config_text):
    """Convierte el texto armado en una lista de lineas listas para enviar
    al equipo (para el boton 'Aplicar al equipo'). Descarta comentarios
    propios del generador (lineas '! ----') y lineas vacias."""
    lines = []
    for line in full_config_text.splitlines():
        if line.startswith("! ----"):
            continue
        lines.append(line)
    return lines

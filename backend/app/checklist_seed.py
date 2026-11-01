"""
checklist_seed.py
Plantillas de CheckList (estilo Claro) que se siembran la primera vez.

Cada plantilla es:  servicio (internet | rpv) + marca (cisco | huawei | fortinet)
y, opcionalmente, MRA o HA. El contenido sale de los ejemplos reales:
  A: VALIDACION DE LA CONFIGURACION       (los 2 primeros ítems van como TEXTO)
  B: VERIFICACION DE CONECTIVIDAD
  C: PRUEBAS DE SATURACION
  D: PRUEBAS ADICIONALES                   (el resto va como FOTO)
Los comandos de Cisco son los alternativos a los de Huawei (mismo ítem).
Los parámetros {WAN} {LAN} {NEXTHOP} {REMOTE} {INTERNET} {MRA} {BGP_PEER} {VRF}
se piden al inicio y se reemplazan en cada comando.
"""

PARAM_INFO = {
    "WAN": ("Interfaz WAN (sub-interfaz)", ""),
    "LAN": ("Interfaz LAN", ""),
    "NEXTHOP": ("IP del siguiente salto (WAN)", ""),
    "REMOTE": ("IP remota (ping LAN to LAN)", ""),
    "INTERNET": ("IP de Internet (ping / traza)", "8.8.8.8"),
    "MRA": ("IP del servidor MRA", ""),
    "BGP_PEER": ("IP del vecino BGP", ""),
    "VRF": ("VRF", "300"),
}

SETUP = {
    "huawei": ["screen-length 0 temporary"],
    "cisco": ["terminal length 0"],
    "fortinet": [],
}

VENDOR_LABEL = {"huawei": "Huawei", "cisco": "Cisco", "fortinet": "Fortinet"}


def _it(nombre, modo="foto", cmd="", n=[0]):
    n[0] += 1
    it = {"id": f"s{n[0]}", "nombre": nombre, "modo": modo, "cmd": cmd}
    # Estadísticas de interfaz WAN/LAN: solo valen mientras se satura
    if "[WAN Interface]" in nombre or "[LAN Interface]" in nombre:
        it["sat"] = True
    return it


def _huawei(servicio, mra, ha):
    rpv = servicio == "rpv"
    A = [
        _it("DISPLAY CURRENT-CONFIGURATION (Configuración actual)", "texto", "display current-configuration"),
        _it("DISPLAY SAVED-CONFIGURATION (Configuración Guardada)", "texto", "display saved-configuration"),
        _it("DISPLAY VERSION (Version del VRP)", "foto", "display version"),
        _it("DISPLAY STARTUP", "foto", "display startup"),
    ]
    if rpv:
        A += [_it("DIR", "foto", "dir"), _it("DISPLAY PATCH-INFORMATION", "foto", "display patch-information")]
    A += [_it("DISPLAY DEVICE", "foto", "display device"), _it("DISPLAY ELABEL", "foto", "display elabel")]
    B = [
        _it("DISPLAY IP ROUTING-TABLE (Tabla de Enrutamiento)", "foto", "display ip routing-table"),
        _it("PING TO WAN (Ping hacia la IP del siguiente salto)", "foto", "ping -c 5 {NEXTHOP}"),
        _it("PING LAN TO LAN (Ping hacia una IP Remota)", "foto", "ping -c 5 {REMOTE}"),
    ]
    C = [
        _it("DISPLAY ACL ALL", "foto", "display acl all"),
        _it("DISPLAY INTERFACE [WAN Interface] (Estadísticas de la interface WAN)", "foto", "display interface {WAN}"),
    ]
    if not rpv:
        C += [_it("CAPTURA SOFTWARE PARA SATURAR (iperf / otro)", "foto", ""),
              _it("CAPTURA DE SATURACIÓN DESDE EQUIPO DE ACCESO", "foto", "")]
    C += [_it("DISPLAY INTERFACE [LAN Interface] (Estadísticas de la interface LAN)", "foto", "display interface {LAN}")]
    D = []
    if not rpv:
        D += [_it("TRACERT (Tracert hacia una IP Remota)", "foto", "tracert {INTERNET}"),
              _it("SPEED TEST", "foto", "")]
    D += [_it("DISPLAY ARP (Tabla ARP)", "foto", "display arp"),
          _it("DISPLAY IP INTERFACE BRIEF (Estado de las interfaces)", "foto", "display ip interface brief")]
    if rpv:
        D += [
            _it("DISPLAY BGP PEER", "foto", "display bgp peer"),
            _it("DIS BGP ROUTING-TABLE PEER NEXT-HOP RECEIVED-ROUTES", "foto",
                "display bgp routing-table peer {BGP_PEER} received-routes"),
            _it("DIS BGP ROUTING-TABLE PEER NEXT-HOP ADVERTISED-ROUTES", "foto",
                "display bgp routing-table peer {BGP_PEER} advertised-routes"),
        ]
    if mra:
        D += [_it("DISPLAY USERS", "foto", "display users")]
        D += [_it("PING HACIA SERVIDOR MRA", "foto", "ping -c 5 {MRA}")] if rpv else [_it("MRA VT", "foto", "")]
    if ha:
        D += [_it("DISPLAY VRRP BRIEF (Estado HA)", "foto", "display vrrp brief"),
              _it("DISPLAY VRRP (Detalle HA)", "foto", "display vrrp")]
    if rpv:
        D += [_it("DISPLAY TRANSCEIVER VERBOSE", "foto", "display transceiver verbose")]
    return [("A: VALIDACION DE LA CONFIGURACION", A), ("B: VERIFICACION DE CONECTIVIDAD.", B),
            ("C: PRUEBAS DE SATURACION.", C), ("D: PRUEBAS ADICIONALES.", D)]


def _cisco(servicio, mra, ha):
    rpv = servicio == "rpv"
    v = " vrf {VRF}" if rpv else ""
    A = [
        _it("SHOW RUNNING (Configuración Actual)", "texto", "show running-config"),
        _it("SHOW STARTUP-CONFIG (Configuración Guardada)", "texto", "show startup-config"),
        _it("SHOW VERSION", "foto", "show version"),
        _it("SHOW FLASH", "foto", "dir flash:"),
        _it("SHOW INVENTORY", "foto", "show inventory"),
        _it("SHOW CDP NEIGHBORS", "foto", "show cdp neighbors"),
    ]
    B = [
        _it("SHOW IP ROUTE (Tabla de Enrutamiento)", "foto", f"show ip route{v}"),
        _it("PING WAN (Ping hacia la IP del siguiente salto)", "foto", "ping {NEXTHOP}"),
        _it("PING LAN (Ping hacia una IP Remota)", "foto", f"ping{v} {{REMOTE}}"),
    ]
    C = [
        _it("SHOW ACCESS-LISTS", "foto", "show access-lists"),
        _it("SHOW INTERFACES [WAN Interface] (Estadísticas de la interface WAN)", "foto", "show interfaces {WAN}"),
    ]
    if not rpv:
        C += [_it("CAPTURA SOFTWARE PARA SATURAR (iperf / otro)", "foto", ""),
              _it("CAPTURA DE SATURACIÓN DESDE EQUIPO DE ACCESO", "foto", "")]
    C += [_it("SHOW INTERFACES [LAN Interface] (Estadísticas de la interface LAN)", "foto", "show interfaces {LAN}")]
    D = []
    if not rpv:
        D += [_it("TRACEROUTE (Traza hacia una IP Remota)", "foto", "traceroute {INTERNET}"),
              _it("SPEED TEST", "foto", "")]
    D += [_it("SHOW ARP", "foto", "show ip arp")]
    if rpv:
        D += [_it("SHOW ARP VRF", "foto", "show ip arp vrf {VRF}"),
              _it("RUTAS ADVERTIDAS", "foto", "show ip bgp neighbors {BGP_PEER} advertised-routes"),
              _it("RUTAS RECIBIDAS", "foto", "show ip bgp neighbors {BGP_PEER} received-routes"),
              _it("SHOW IP BGP SUMMARY", "foto", "show ip bgp summary")]
    D += [_it("SHOW LLDP NEIGHBORS", "foto", "show lldp neighbors"),
          _it("SHOW MAC ADDRESS-TABLE", "foto", "show mac address-table"),
          _it("ESTADO DE LAS INTERFACES", "foto", "show ip interface brief")]
    if mra:
        D += [_it("SHOW USERS", "foto", "show users")]
        D += [_it("PING HACIA SERVIDOR MRA", "foto", f"ping{v} {{MRA}}")] if rpv else [_it("MRA VT", "foto", "")]
    if ha:
        D += [_it("SHOW STANDBY BRIEF (Estado HA)", "foto", "show standby brief"),
              _it("SHOW STANDBY (Detalle HA)", "foto", "show standby")]
    if rpv:
        D += [_it("SHOW INTERFACES TRANSCEIVER", "foto", "show interfaces transceiver")]
    return [("A: VERIFICACION DE LA CONFIGURACION", A), ("B: VERIFICACION DE CONECTIVIDAD", B),
            ("C: PRUEBAS DE SATURACION", C), ("D: PRUEBAS ADICIONALES", D)]


def _fortinet(servicio, mra, ha):
    A = [
        _it("GET SYSTEM STATUS", "foto", "get system status"),
        _it("GET HARDWARE STATUS", "foto", "get hardware status"),
        _it("SHOW SYSTEM INTERFACE", "foto", "show system interface"),
        _it("GET SYSTEM INTERFACE TRANSCEIVER", "foto", "get system interface transceiver"),
    ]
    B = [
        _it("GET ROUTER INFO ROUTING-TABLE ALL", "foto", "get router info routing-table all"),
        _it("GET ROUTER INFO BGP SUMMARY", "foto", "get router info bgp summary"),
        _it("GET ROUTER INFO BGP NEIGHBORS {BGP_PEER} ADVERTISED-ROUTES", "foto",
            "get router info bgp neighbors {BGP_PEER} advertised-routes"),
        _it("GET ROUTER INFO BGP NEIGHBORS {BGP_PEER} RECEIVED-ROUTES", "foto",
            "get router info bgp neighbors {BGP_PEER} received-routes"),
        _it("GET SYSTEM ARP", "foto", "get system arp"),
        _it("PING AL SIGUIENTE SALTO", "foto", "execute ping {NEXTHOP}"),
        _it("PING A LA LAN", "foto", "execute ping {REMOTE}"),
        _it("PING A INTERNET", "foto", "execute ping {INTERNET}"),
        _it("TRAZA A INTERNET", "foto", "execute traceroute {INTERNET}"),
    ]
    C = [_it("PRUEBAS DE SATURACION (captura del software)", "foto", ""),
         _it("ACCESO (captura desde el equipo de acceso)", "foto", ""),
         _it("SPEEDTEST", "foto", "")]
    return [("CONFIGURACION", A), ("CONECTIVIDAD", B), ("PRUEBAS DE SATURACION", C)]


BUILDERS = {"huawei": _huawei, "cisco": _cisco, "fortinet": _fortinet}

# (nombre, servicio, marca, mra, ha) — en este orden aparecen en el menú
SEED_TYPES = [
    ("Internet Cisco", "internet", "cisco", False, False),
    ("Internet Cisco con MRA", "internet", "cisco", True, False),
    ("Internet Huawei", "internet", "huawei", False, False),
    ("Internet Huawei con MRA", "internet", "huawei", True, False),
    ("Internet Fortinet", "internet", "fortinet", False, False),
    ("RPV Cisco", "rpv", "cisco", False, False),
    ("RPV Cisco con MRA", "rpv", "cisco", True, False),
    ("RPV Cisco con HA", "rpv", "cisco", False, True),
    ("RPV Huawei", "rpv", "huawei", False, False),
    ("RPV Huawei con MRA", "rpv", "huawei", True, False),
    ("RPV Huawei con HA", "rpv", "huawei", False, True),
]


def build_data(servicio, marca, mra=False, ha=False):
    import re
    secciones = BUILDERS[marca](servicio, mra, ha)
    used = []
    sections = []
    for i, (titulo, items) in enumerate(secciones):
        sections.append({"id": f"sec{i + 1}", "titulo": titulo, "items": items})
        for it in items:
            used += re.findall(r"\{([A-Z_]+)\}", it["cmd"] + " " + it["nombre"])
    params = []
    for k in PARAM_INFO:
        if k in used:
            params.append({"key": k, "label": PARAM_INFO[k][0], "default": PARAM_INFO[k][1]})
    return {
        "servicio": servicio,
        "vendor": marca,
        "setup": SETUP[marca],
        "params": params,
        "sections": sections,
    }

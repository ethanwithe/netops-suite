"""
vendor_commands.py
Base de comandos por marca (switch/router). Cada entrada de prueba es:
  (clave, descripción, comando)

Los comandos pueden llevar los placeholders {UPLINK} y {PING} que se
reemplazan con lo que el usuario ponga en el formulario (interfaz de
uplink y/o IP a la que hacer ping). Si el usuario deja esos campos vacíos,
esa prueba puntual se OMITE automáticamente (no se puede ejecutar sin el dato).
"""

VENDORS = {

    "huawei": {
        "label": "Huawei (VRP)",
        "disable_paging": ["screen-length 0 temporary"],
        "config_cmd": ("current_config", "Configuración actual (current-configuration)",
                        "display current-configuration"),
        "save_cmds": ["save", "y"],
        "switch": [
            ("encendido", "Verificación de encendido / estado del equipo", "display device"),
            ("interfaces", "Estado de interfaces (UP/DOWN)", "display interface brief"),
            ("transceiver", "Transceivers (estado)", "display transceiver interface brief"),
            ("transceiver_alarm", "Alarmas de transceivers", "display transceiver alarm interface brief"),
            ("cpu_mem", "Uso de CPU y memoria", "display cpu-usage"),
            ("logs", "Logs / errores críticos", "display logbuffer level 0 1 2 3"),
            ("vlan", "VLANs configuradas", "display vlan brief"),
            ("trunk", "Eth-Trunk / LACP", "display eth-trunk"),
            ("uplink", "Interfaz de uplink", "display interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("snmp", "SNMP", "display snmp-agent sys-info"),
            ("ntp", "NTP", "display ntp-service status"),
            ("ssh", "Acceso SSH", "display ssh server status"),
        ],
        "router": [
            ("version", "Versión / estado del equipo", "display version"),
            ("ip_int", "Interfaces IP", "display ip interface brief"),
            ("route", "Tabla de ruteo", "display ip routing-table"),
            ("ospf", "Vecinos OSPF", "display ospf peer brief"),
            ("bgp", "Vecinos BGP", "display bgp peer"),
            ("nat", "Sesiones NAT", "display nat session summary"),
            ("cpu_mem", "CPU y memoria", "display cpu-usage"),
            ("logs", "Logs / errores críticos", "display logbuffer level 0 1 2 3"),
            ("uplink", "Interfaz de uplink/WAN", "display interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("ntp", "NTP", "display ntp-service status"),
            ("ssh", "Acceso SSH", "display ssh server status"),
        ],
    },

    "hp_comware": {
        "label": "HP / H3C Comware",
        "disable_paging": ["screen-length disable"],
        "config_cmd": ("current_config", "Configuración actual (current-configuration)",
                        "display current-configuration"),
        "save_cmds": ["save force"],
        "switch": [
            ("encendido", "Estado del equipo", "display device"),
            ("interfaces", "Estado de interfaces", "display interface brief"),
            ("cpu_mem", "CPU y memoria", "display cpu-usage") ,
            ("cpu_mem2", "Memoria", "display memory"),
            ("logs", "Logs", "display logbuffer"),
            ("vlan", "VLANs", "display vlan brief"),
            ("trunk", "Link-aggregation", "display link-aggregation summary"),
            ("uplink", "Interfaz de uplink", "display interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("snmp", "SNMP", "display snmp-agent sys-info"),
            ("ntp", "NTP", "display ntp-service status"),
            ("ssh", "SSH", "display ssh server session"),
        ],
        "router": [
            ("version", "Versión del equipo", "display version"),
            ("ip_int", "Interfaces IP", "display ip interface brief"),
            ("route", "Tabla de ruteo", "display ip routing-table"),
            ("ospf", "Vecinos OSPF", "display ospf peer brief"),
            ("bgp", "Vecinos BGP", "display bgp peer"),
            ("cpu_mem", "CPU y memoria", "display cpu-usage"),
            ("logs", "Logs", "display logbuffer"),
            ("uplink", "Interfaz WAN/uplink", "display interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("ntp", "NTP", "display ntp-service status"),
        ],
    },

    "cisco_ios": {
        "label": "Cisco IOS / IOS-XE",
        "disable_paging": ["terminal length 0"],
        "config_cmd": ("current_config", "Configuración actual (running-config)",
                        "show running-config"),
        "save_cmds": ["write memory"],
        "switch": [
            ("version", "Versión / estado del equipo", "show version"),
            ("interfaces", "Estado de interfaces", "show ip interface brief"),
            ("interfaces_status", "Estado detallado de puertos", "show interfaces status"),
            ("transceiver", "Transceivers (SFP)", "show interfaces transceiver"),
            ("cpu", "Uso de CPU", "show processes cpu"),
            ("mem", "Uso de memoria", "show processes memory"),
            ("logs", "Logs", "show logging"),
            ("vlan", "VLANs", "show vlan brief"),
            ("trunk", "EtherChannel / trunk", "show etherchannel summary"),
            ("uplink", "Interfaz de uplink", "show interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("cdp", "Vecinos CDP", "show cdp neighbors"),
            ("ntp", "NTP", "show ntp status"),
            ("ssh", "SSH", "show ip ssh"),
        ],
        "router": [
            ("version", "Versión / estado del equipo", "show version"),
            ("ip_int", "Interfaces IP", "show ip interface brief"),
            ("route", "Tabla de ruteo", "show ip route"),
            ("ospf", "Vecinos OSPF", "show ip ospf neighbor"),
            ("bgp", "Resumen BGP", "show ip bgp summary"),
            ("nat", "Traducciones NAT", "show ip nat translations"),
            ("cpu", "Uso de CPU", "show processes cpu"),
            ("mem", "Uso de memoria", "show processes memory"),
            ("logs", "Logs", "show logging"),
            ("uplink", "Interfaz WAN/uplink", "show interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("ntp", "NTP", "show ntp status"),
            ("ssh", "SSH", "show ip ssh"),
        ],
    },

    "aruba_cx": {
        "label": "Aruba (AOS-CX)",
        "disable_paging": ["no page"],
        "config_cmd": ("current_config", "Configuración actual (running-config)",
                        "show running-config"),
        "save_cmds": ["write memory"],
        "switch": [
            ("version", "Versión / estado del equipo", "show version"),
            ("interfaces", "Estado de interfaces", "show interface brief"),
            ("cpu_mem", "CPU y memoria", "show system resource-utilization"),
            ("logs", "Logs", "show events"),
            ("vlan", "VLANs", "show vlan"),
            ("trunk", "LAG / LACP", "show lacp interfaces"),
            ("uplink", "Interfaz de uplink", "show interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("ntp", "NTP", "show ntp status"),
            ("ssh", "SSH", "show ssh-server"),
        ],
        "router": [
            ("version", "Versión / estado del equipo", "show version"),
            ("ip_int", "Interfaces IP", "show interface brief"),
            ("route", "Tabla de ruteo", "show ip route"),
            ("ospf", "Vecinos OSPF", "show ip ospf neighbor"),
            ("bgp", "Vecinos BGP", "show bgp neighbor"),
            ("cpu_mem", "CPU y memoria", "show system resource-utilization"),
            ("logs", "Logs", "show events"),
            ("uplink", "Interfaz WAN/uplink", "show interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
        ],
    },

    "mikrotik": {
        "label": "MikroTik (RouterOS)",
        "disable_paging": [],
        "config_cmd": ("current_config", "Configuración actual (export)", "/export"),
        "save_cmds": [],
        "switch": [
            ("recursos", "CPU / memoria / uptime", "/system resource print"),
            ("interfaces", "Estado de interfaces", "/interface print"),
            ("bridge", "Puertos en bridge / VLAN", "/interface bridge port print"),
            ("vlan", "VLANs", "/interface vlan print"),
            ("logs", "Logs", "/log print"),
            ("uplink", "Interfaz de uplink", "/interface print detail where name={UPLINK}"),
            ("ping", "Ping de conectividad", "/ping {PING} count=4"),
            ("ntp", "NTP", "/system ntp client print"),
            ("health", "Salud del equipo (temp/voltaje)", "/system health print"),
        ],
        "router": [
            ("recursos", "CPU / memoria / uptime", "/system resource print"),
            ("interfaces", "Estado de interfaces", "/interface print"),
            ("ip_addr", "Direcciones IP", "/ip address print"),
            ("route", "Tabla de ruteo", "/ip route print"),
            ("ospf", "Vecinos OSPF", "/routing ospf neighbor print"),
            ("bgp", "Peers BGP", "/routing bgp peer print"),
            ("nat", "Reglas NAT", "/ip firewall nat print"),
            ("logs", "Logs", "/log print"),
            ("uplink", "Interfaz WAN/uplink", "/interface print detail where name={UPLINK}"),
            ("ping", "Ping de conectividad", "/ping {PING} count=4"),
            ("ntp", "NTP", "/system ntp client print"),
        ],
    },

    "juniper": {
        "label": "Juniper (JunOS)",
        "disable_paging": ["set cli screen-length 0"],
        "config_cmd": ("current_config", "Configuración actual", "show configuration"),
        "save_cmds": [],
        "switch": [
            ("hardware", "Hardware / estado del equipo", "show chassis hardware"),
            ("interfaces", "Estado de interfaces", "show interfaces terse"),
            ("cpu_mem", "CPU / memoria (routing-engine)", "show chassis routing-engine"),
            ("logs", "Logs", "show log messages"),
            ("vlan", "VLANs", "show vlans"),
            ("trunk", "LACP", "show lacp interfaces"),
            ("uplink", "Interfaz de uplink", "show interfaces {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING} count 4"),
            ("ntp", "NTP", "show ntp status"),
            ("uptime", "Uptime del sistema", "show system uptime"),
        ],
        "router": [
            ("hardware", "Hardware / estado del equipo", "show chassis hardware"),
            ("interfaces", "Estado de interfaces", "show interfaces terse"),
            ("route", "Tabla de ruteo", "show route"),
            ("ospf", "Vecinos OSPF", "show ospf neighbor"),
            ("bgp", "Resumen BGP", "show bgp summary"),
            ("cpu_mem", "CPU / memoria", "show chassis routing-engine"),
            ("logs", "Logs", "show log messages"),
            ("uplink", "Interfaz WAN/uplink", "show interfaces {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING} count 4"),
            ("ntp", "NTP", "show ntp status"),
        ],
    },

    "fortinet": {
        "label": "Fortinet (FortiOS)",
        "disable_paging": ["config system console", "set output standard", "end"],
        "config_cmd": ("current_config", "Configuración actual (show full-configuration)",
                        "show full-configuration"),
        "save_cmds": [],
        "switch": [
            ("status", "Estado del equipo", "get system status"),
            ("interfaces", "Estado de interfaces", "get system interface physical"),
            ("cpu_mem", "CPU y memoria", "get system performance status"),
            ("logs", "Logs recientes", "execute log display"),
            ("ha", "Estado HA (si aplica)", "get system ha status"),
            ("ping", "Ping de conectividad", "execute ping {PING}"),
        ],
        "router": [
            ("status", "Estado del equipo", "get system status"),
            ("interfaces", "Estado de interfaces", "get system interface physical"),
            ("route", "Tabla de ruteo", "get router info routing-table all"),
            ("bgp", "Resumen BGP", "get router info bgp summary"),
            ("ospf", "Vecinos OSPF", "get router info ospf neighbor"),
            ("cpu_mem", "CPU y memoria", "get system performance status"),
            ("logs", "Logs recientes", "execute log display"),
            ("ping", "Ping de conectividad", "execute ping {PING}"),
        ],
    },

    "zte": {
        "label": "ZTE (ZXR10 / similar Cisco-like)",
        "disable_paging": ["terminal length 0"],
        "config_cmd": ("current_config", "Configuración actual (running-config)",
                        "show running-config"),
        "save_cmds": ["write"],
        "switch": [
            ("version", "Versión / estado del equipo", "show version"),
            ("interfaces", "Estado de interfaces", "show interface brief"),
            ("cpu_mem", "CPU y memoria", "show cpu"),
            ("logs", "Logs", "show logging"),
            ("vlan", "VLANs", "show vlan"),
            ("trunk", "LACP / smartgroup", "show smartgroup"),
            ("uplink", "Interfaz de uplink", "show interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
            ("ntp", "NTP", "show ntp status"),
        ],
        "router": [
            ("version", "Versión / estado del equipo", "show version"),
            ("ip_int", "Interfaces IP", "show ip interface brief"),
            ("route", "Tabla de ruteo", "show ip route"),
            ("ospf", "Vecinos OSPF", "show ip ospf neighbor"),
            ("bgp", "Resumen BGP", "show ip bgp summary"),
            ("cpu_mem", "CPU y memoria", "show cpu"),
            ("logs", "Logs", "show logging"),
            ("uplink", "Interfaz WAN/uplink", "show interface {UPLINK}"),
            ("ping", "Ping de conectividad", "ping {PING}"),
        ],
    },
}


def get_vendor_labels():
    """Devuelve lista [(clave, etiqueta), ...] para llenar el combobox de marca."""
    return [(k, v["label"]) for k, v in VENDORS.items()]


def get_tests(vendor_key, device_type, uplink="", ping=""):
    """
    Devuelve la lista final de pruebas a ejecutar para la marca/tipo de equipo,
    ya con los placeholders {UPLINK}/{PING} reemplazados. Si el usuario no dio
    ese dato, la prueba correspondiente se omite (no se agrega a la lista).
    """
    vendor = VENDORS[vendor_key]
    raw_tests = vendor.get(device_type, [])
    final = []
    for key, label, cmd in raw_tests:
        needs_uplink = "{UPLINK}" in cmd
        needs_ping = "{PING}" in cmd
        if needs_uplink and not uplink.strip():
            continue
        if needs_ping and not ping.strip():
            continue
        cmd_final = cmd.replace("{UPLINK}", uplink.strip()).replace("{PING}", ping.strip())
        final.append((key, label, cmd_final))
    return final


# ============================================================
# Comandos para ENTRAR / SALIR de modo configuración y guardar,
# usados por el módulo de aplicación automática de plantillas
# (config_builder.py / device_link.py). No confundir con
# "save_cmds" de las pruebas (arriba), que es lo mismo pero se
# repite aquí explícito por claridad de uso.
# ============================================================
CONFIG_MODE = {
    "huawei":     {"enter": ["system-view"],        "exit": ["return"],  "save": ["save", "y"]},
    "hp_comware": {"enter": ["system-view"],        "exit": ["return"],  "save": ["save force"]},
    "cisco_ios":  {"enter": ["configure terminal"], "exit": ["end"],     "save": ["write memory"]},
    "aruba_cx":   {"enter": ["configure terminal"], "exit": ["end"],     "save": ["write memory"]},
    "mikrotik":   {"enter": [],                     "exit": [],         "save": []},
    "juniper":    {"enter": ["configure"],           "exit": ["commit and-quit"], "save": []},
    "fortinet":   {"enter": [],                     "exit": ["end"],     "save": []},
    "zte":        {"enter": ["configure terminal"], "exit": ["end"],     "save": ["write"]},
}


def get_config_mode(vendor_key):
    return CONFIG_MODE.get(vendor_key, {"enter": [], "exit": [], "save": []})

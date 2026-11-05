"""Arma la plantilla «Internet con ONT y Router Cisco» a partir del doc.json extraído del PPTX de ejemplo:
renombra los iconos y cambia los textos de ejemplo por campos {{clave}} que se llenan al inicio."""
import json, shutil, sys, os

src, icons_src, out_json, icons_dst = sys.argv[1:5]
doc = json.load(open(src))
RENAME = {"ont-1": "roseta", "ont-2": "switch-cliente", "ont-3": "nube-pop", "ont-4": "caja-fat", "ont-5": "olt",
          "ont-6": "caja-distribucion", "ont-7": "router-cisco-c1121x", "ont-8": "router-ont-huawei", "ont-9": "logo-claro"}
TXT = {
    "e14": "VLAN:{{vlan}}\nSUB INTERFACE: {{subinterface}}",
    "e17": "{{pop}}", "e18": "RED LAN:\n{{red_lan}}", "e22": "ROUTER CISCO\n{{modelo_router}}",
    "e24": "IP WAN CLARO:\n{{ip_wan_claro}}", "e26": "RED DEL CLIENTE - {{cliente}}", "e30": "RED WAN:\n{{red_wan}}",
    "e34": "IP WAN CPE:\n{{ip_wan_cpe}}", "e35": "{{olt}}", "e37": "ROUTER ONT\n{{marca_ont}}", "e39": "CID: {{cid}}",
    "e40": "{{ip_lan_gw}}", "e41": "{{ip_lan_sw}}", "e21": "PUERTO RJ45\nP: {{puerto}}",
}
els = []
for e in doc["elements"]:
    if e.get("icon"):
        base = e["icon"].rsplit(".", 1)[0]
        e["icon"] = RENAME.get(base, base)
    if e["id"] in TXT:
        e["text"] = TXT[e["id"]]
    if e["id"] == "e16":  # título: 3 líneas azules + contacto en negro (un solo estilo por cuadro)
        pitch = 20 * 1.2698 * 1.15 + e["spcBef"]
        a = dict(e, id="e16", text="{{cliente}}\nSEDE: {{sede}}\nDIRECCIÓN: {{direccion}}", h=round(pitch * 3, 2))
        b = dict(e, id="e16b", text="CONTACTO: {{contacto}}", color="#000000", y=round(e["y"] + pitch * 3, 2), h=round(pitch, 2))
        els += [a, b]
        continue
    if e["type"] == "table":
        c = e["rows"]
        c[1]["cells"][1]["text"] = "{{cliente}}\nDIRECCIÓN: {{direccion_corta}}"
        c[2]["cells"][1]["text"] = "{{servicio}}"
        c[3]["cells"][1]["text"] = "{{proyecto}}"; c[3]["cells"][3]["text"] = "CID"
        c[4]["cells"][0]["text"] = "FECHA:"; c[4]["cells"][1]["text"] = "{{fecha}}"; c[4]["cells"][2]["text"] = "{{sot}}"; c[4]["cells"][3]["text"] = "{{cid}}"
        c[5]["cells"][1]["text"] = "{{realizado}}"; c[6]["cells"][1]["text"] = "{{empresa}}"
    els.append(e)
for i, e in enumerate(els): e["id"] = "e%d" % (i + 1)
doc["elements"] = els
json.dump(doc, open(out_json, "w"), ensure_ascii=False, indent=1)
os.makedirs(icons_dst, exist_ok=True)
for f in os.listdir(icons_src):
    base, ext = os.path.splitext(f)
    shutil.copy(os.path.join(icons_src, f), os.path.join(icons_dst, RENAME.get(base, base) + ext))
print(len(els), "elementos")

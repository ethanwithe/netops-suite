# PyInstaller: empaqueta el servidor local (Python + dependencias + interfaz) en un solo .exe (la ventana de Tauri lo oculta).
# Uso (desde backend/):  pyinstaller netops-server.spec --noconfirm
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hidden = [], [], []
for pkg in ("uvicorn", "reportlab", "pptx", "docx", "openpyxl", "pypdf", "paramiko", "serial", "websockets", "sqlalchemy", "PIL"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hidden += h
hidden += collect_submodules("app")
datas += [("app/assets", "app/assets")]
frontend = os.environ.get("FRONTEND_BUILD", "../frontend/dist")
if os.path.isdir(frontend):
    datas += [(frontend, "static_frontend")]

a = Analysis(["desktop_main.py"], pathex=["."], binaries=binaries, datas=datas, hiddenimports=hidden,
             excludes=["playwright", "telethon", "redis", "psycopg2", "tkinter"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="netops-server", console=True, upx=False)

"""
models.py
Modelos SQLAlchemy - equivalentes en Postgres a los antiguos
templates_store.py / checklist_store.py / photo_items_store.py (JSON).
"""

import uuid
import datetime as dt

from sqlalchemy import Column, String, Integer, Text, DateTime, JSON, LargeBinary, Boolean, ForeignKey, Index
from sqlalchemy.dialects.postgresql import ARRAY

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class Service(Base):
    """Servicio (ej. 'internet_cpe_cisco', 'rpv') - usado tanto por
    plantillas como por el checklist."""
    __tablename__ = "services"

    id = Column(String, primary_key=True, default=gen_uuid)
    clave = Column(String, unique=True, nullable=False)
    etiqueta = Column(String, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class TemplateFragment(Base):
    """Fragmento reutilizable de plantilla (ej. 'MRA', 'TACACS', 'BGP+RPV')."""
    __tablename__ = "template_fragments"

    id = Column(String, primary_key=True, default=gen_uuid)
    nombre = Column(String, nullable=False)
    marca = Column(String, nullable=False, index=True)
    modelos_compatibles = Column(String, default="")
    servicios = Column(ARRAY(String), default=list)
    orden = Column(Integer, default=50)
    texto = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)


class ChecklistItem(Base):
    """Item de un checklist (ej. 'SHOW RUNNING', seccion '1A: ...')."""
    __tablename__ = "checklist_items"

    id = Column(String, primary_key=True, default=gen_uuid)
    servicio = Column(String, nullable=False, index=True)
    seccion = Column(String, nullable=False)
    nombre = Column(String, nullable=False)
    orden = Column(Integer, default=10)
    modo = Column(String, default="auto")
    comando = Column(String, default="")
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class PhotoItem(Base):
    """Descripcion de item del reporte fotografico (ej. 'Transceiver instalado')."""
    __tablename__ = "photo_items"

    id = Column(String, primary_key=True, default=gen_uuid)
    categoria = Column(String, nullable=False, index=True)
    nombre = Column(String, nullable=False)
    orden = Column(Integer, default=10)
    # Tipo de reporte al que pertenece: fibra | gpon_ont | gpon_modulo
    tipo = Column(String, nullable=False, default="fibra", server_default="fibra", index=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class PhotoWindow(Base):
    """Ventana (tipo de reporte fotográfico) creada por el usuario.

    `config` guarda los valores por defecto de los campos (PROY, CLIENTE, SOT,
    CID, CONTRATA y logos). Sus ítems son PhotoItem con tipo = id de la ventana.
    """
    __tablename__ = "photo_windows"

    id = Column(String, primary_key=True, default=gen_uuid)
    nombre = Column(String, nullable=False)
    config = Column(JSON, nullable=False, default=dict)
    orden = Column(Integer, default=10)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class ChecklistTemplate(Base):
    """Tipo de CheckList (p. ej. «Internet Huawei con MRA»).

    `data` guarda servicio, marca, comandos de preparación, parámetros que se
    piden al inicio y las secciones con sus ítems (texto o foto + comando).
    """
    __tablename__ = "checklist_templates"

    id = Column(String, primary_key=True, default=gen_uuid)
    nombre = Column(String, nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    orden = Column(Integer, default=10)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class Client(Base):
    """Cliente / servicio identificado por su SOT.

    Se ubica por año y mes según `fecha` (la fecha que se puso en los datos, no la de
    creación). `datos` junta lo asociado a la SOT desde cualquier ventana (IPs, interfaces...)
    y `reportes` el historial de PDF/carpetas generados.
    """
    __tablename__ = "clients"

    id = Column(String, primary_key=True, default=gen_uuid)
    sot = Column(String, nullable=False, index=True)
    nombre = Column(String, nullable=False, default="")
    fecha = Column(String, nullable=False, default="")  # ISO yyyy-mm-dd
    cid = Column(String, nullable=False, default="")
    proy = Column(String, nullable=False, default="")
    contrata = Column(String, nullable=False, default="")
    datos = Column(JSON, nullable=False, default=dict)
    reportes = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow)
    # Quién lo creó (los participantes están en ClientShare) y papelera (borrado recuperable).
    owner_id = Column(String, nullable=True, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(String, nullable=True)


class ClientYear(Base):
    """Años creados a mano (el actual existe siempre; los años con clientes también)."""
    __tablename__ = "client_years"

    year = Column(Integer, primary_key=True)


class HeaderLogo(Base):
    """Logo reutilizable para la cabecera de los PDF.

    El binario se guarda en la base de datos (no en disco) para que no se
    pierda cuando el servidor se reinicia o se vuelve a desplegar.
    posicion: 'izq' (empresa) o 'der' (Claro).
    """
    __tablename__ = "header_logos"

    id = Column(String, primary_key=True, default=gen_uuid)
    posicion = Column(String, nullable=False, default="izq", index=True)
    nombre = Column(String, nullable=False)
    content_type = Column(String, nullable=False, default="image/png")
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class GeneratedDocument(Base):
    """Historial de PDFs generados (para poder listarlos/descargarlos despues)."""
    __tablename__ = "generated_documents"

    id = Column(String, primary_key=True, default=gen_uuid)
    tipo = Column(String, nullable=False)
    nombre_archivo = Column(String, nullable=False)
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class StoredFile(Base):
    """Copia durable (en la base de datos) de fotos subidas y de PDF/ZIP generados.

    El disco de Railway se borra en cada despliegue; esto permite volver a descargar
    y volver a usar las fotos y los reportes de un cliente cuando quieras.
    """
    __tablename__ = "stored_files"

    name = Column(String, primary_key=True)          # nombre en disco (uuid.ext o el del PDF/ZIP)
    kind = Column(String, nullable=False, index=True)  # 'upload' | 'output'
    content_type = Column(String, nullable=False, default="application/octet-stream")
    data = Column(LargeBinary, nullable=False)          # vacío (b"") cuando el contenido vive en Telegram
    tg_chat = Column(String, nullable=True)             # referencia en Telegram: chat…
    tg_msg = Column(Integer, nullable=True)             # …y mensaje (solo se guarda esto, no el archivo)
    size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class ClientWorkspace(Base):
    """Lo que había en pantalla en una ventana (reporte fotográfico, checklist, Poder Judicial...)
    para una SOT, guardado solo para poder volver a abrirlo y seguir editando."""
    __tablename__ = "client_workspaces"

    sot = Column(String, primary_key=True)
    key = Column(String, primary_key=True)           # p. ej. 'foto:gpon_ont', 'checklist:<id>', 'pj'
    label = Column(String, nullable=False, default="")
    route = Column(String, nullable=False, default="")
    state = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=dt.datetime.utcnow)


class User(Base):
    """Cuenta de acceso. No hay registro público: solo el administrador las crea."""
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    username = Column(String, unique=True, nullable=False, index=True)   # siempre en minúsculas
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="user")                # superadmin | admin | user
    full_name = Column(String, nullable=False, default="")               # nombre completo (para asociar SOT)
    email = Column(String, nullable=False, default="")
    phone = Column(String, nullable=False, default="")
    cargo = Column(String, nullable=False, default="")
    avatar = Column(LargeBinary, nullable=True)
    avatar_type = Column(String, nullable=False, default="")
    active = Column(Boolean, nullable=False, default=True)
    # Vigencia: fechas (yyyy-mm-dd) y horario diario (HH:MM); vacío = sin límite.
    valid_from = Column(String, nullable=False, default="")
    valid_until = Column(String, nullable=False, default="")
    daily_start = Column(String, nullable=False, default="")
    daily_end = Column(String, nullable=False, default="")
    permissions = Column(JSON, nullable=False, default=dict)             # {funcion: bool}
    must_change_password = Column(Boolean, nullable=False, default=False)
    token_version = Column(Integer, nullable=False, default=0)           # subirlo cierra todas sus sesiones
    notes = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class ClientShare(Base):
    """Participantes de un cliente. Cada cliente vale 1 punto, repartido entre los participantes."""
    __tablename__ = "client_shares"

    client_id = Column(String, ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    added_at = Column(DateTime, default=dt.datetime.utcnow)


class UserWorkspace(Base):
    """Ventana guardada de un cliente (la ven y editan todos sus participantes)."""
    __tablename__ = "user_workspaces"

    client_id = Column(String, ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True)
    key = Column(String, primary_key=True)
    label = Column(String, nullable=False, default="")
    route = Column(String, nullable=False, default="")
    state = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_by = Column(String, nullable=True)


class WorkspaceVersion(Base):
    """Copias anteriores de una ventana, para recuperar lo que se borró o se pisó por error."""
    __tablename__ = "workspace_versions"

    id = Column(String, primary_key=True, default=gen_uuid)
    client_id = Column(String, nullable=False, index=True)
    key = Column(String, nullable=False)
    label = Column(String, nullable=False, default="")
    state = Column(JSON, nullable=False, default=dict)
    saved_at = Column(DateTime, default=dt.datetime.utcnow, index=True)
    saved_by = Column(String, nullable=True)


class ActivityLog(Base):
    """Qué hace cada usuario (inicios de sesión, clientes, PDF...), solo lo ve el administrador."""
    __tablename__ = "activity_log"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, nullable=True, index=True)
    username = Column(String, nullable=False, default="")
    action = Column(String, nullable=False, index=True)
    detail = Column(Text, nullable=False, default="")
    client_id = Column(String, nullable=True)
    at = Column(DateTime, default=dt.datetime.utcnow, index=True)


class DiagramIcon(Base):
    """Icono de la biblioteca de diagramas (equipos, nubes, logos...). Es compartida entre usuarios;
    los que vienen con el sistema (builtin) no se pueden borrar."""
    __tablename__ = "diagram_icons"

    id = Column(String, primary_key=True)             # 'olt', 'router-cisco-c1121x' o un uuid
    name = Column(String, nullable=False, default="")
    categoria = Column(String, nullable=False, default="Equipos")
    content_type = Column(String, nullable=False, default="image/png")
    data = Column(LargeBinary, nullable=False)
    builtin = Column(Boolean, nullable=False, default=False)
    owner_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class AgendaItem(Base):
    """Recordatorio, tarea o evento de la agenda personal (lo crea el usuario o su asistente Bit)."""
    __tablename__ = "agenda_items"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False, default="recordatorio")   # recordatorio | tarea | evento
    title = Column(String, nullable=False)
    notes = Column(Text, nullable=False, default="")
    due_at = Column(DateTime, nullable=True, index=True)             # UTC
    done = Column(Boolean, nullable=False, default=False)
    notified = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class BitProfile(Base):
    """Lo que Bit sabe de cada usuario (nombre, gustos, hábitos). Vive en el servidor, no en el navegador."""
    __tablename__ = "bit_profiles"

    user_id = Column(String, primary_key=True)
    name = Column(String, nullable=False, default="")
    facts = Column(JSON, nullable=False, default=list)
    routes = Column(JSON, nullable=False, default=dict)
    hours = Column(JSON, nullable=False, default=list)
    asked = Column(Boolean, nullable=False, default=False)
    chats = Column(Integer, nullable=False, default=0)
    summary = Column(Text, nullable=True)      # resumen de cómo trabaja la persona (Bit lo reescribe con el tiempo)
    style = Column(JSON, nullable=True)        # votos 👍/👎 y motivos: cómo le gusta que responda
    updated_at = Column(DateTime, default=dt.datetime.utcnow)


class BitEvent(Base):
    """Cosas que hace la persona y Bit aprende: pantallas que abre, comandos que usa, SOT en los que trabaja."""
    __tablename__ = "bit_events"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False, index=True)    # page | cmd | sot | checklist
    key = Column(String, nullable=False, default="")
    detail = Column(String, nullable=False, default="")
    at = Column(DateTime, default=dt.datetime.utcnow, index=True)


class BitReport(Base):
    """Reporte fijado por un administrador desde el chat con Bit (se vuelve a calcular al abrirlo)."""
    __tablename__ = "bit_reports"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False, default="")
    spec = Column(JSON, nullable=False, default=dict)    # {"report": "...", "params": {...}}
    created_at = Column(DateTime, default=dt.datetime.utcnow)


class BitMemory(Base):
    """Memoria de trabajo de Bit por usuario: proyectos, comandos, configuraciones, preferencias y rutinas.
    Cada vez que se repite algo su peso sube (lo habitual pesa más); es la base para anticiparse."""
    __tablename__ = "bit_memories"

    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, nullable=False, index=True)
    kind = Column(String, nullable=False, default="dato")     # proyecto | comando | config | preferencia | rutina | feedback | dato
    text = Column(Text, nullable=False)
    key = Column(String, nullable=False, index=True)          # texto normalizado (evita duplicados)
    weight = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    last_seen = Column(DateTime, default=dt.datetime.utcnow, index=True)

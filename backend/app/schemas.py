"""
schemas.py
Schemas Pydantic para la API (request/response).
"""
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel


class ServiceOut(BaseModel):
    clave: str
    etiqueta: str
    class Config:
        from_attributes = True


class ServiceCreate(BaseModel):
    clave: str
    etiqueta: str


class FragmentBase(BaseModel):
    nombre: str
    marca: str
    modelos_compatibles: str = ""
    servicios: List[str] = []
    orden: int = 50
    texto: str = ""


class FragmentCreate(FragmentBase):
    pass


class FragmentUpdate(FragmentBase):
    pass


class FragmentOut(FragmentBase):
    id: str
    class Config:
        from_attributes = True


class BuildTemplateRequest(BaseModel):
    fragment_ids: List[str]
    variables: Dict[str, str] = {}
    extra_lan_networks: List[Dict[str, str]] = []
    acl_mgmt_ips: List[str] = []


class ApplyTemplateRequest(BuildTemplateRequest):
    marca: str
    connection: Dict[str, Any]


class ChecklistItemBase(BaseModel):
    servicio: str
    seccion: str
    nombre: str
    orden: int = 10
    modo: str = "auto"
    comando: str = ""


class ChecklistItemCreate(ChecklistItemBase):
    pass


class ChecklistItemOut(ChecklistItemBase):
    id: str
    class Config:
        from_attributes = True


class ChecklistRunItem(BaseModel):
    item_id: str
    param: Optional[str] = ""


class ChecklistRunRequest(BaseModel):
    connection: Dict[str, Any]
    items: List[ChecklistRunItem]


class ChecklistPdfItem(BaseModel):
    nombre: str
    seccion: str
    modo: str
    cmd: Optional[str] = ""
    output: Optional[str] = ""
    image_paths: List[str] = []


class ChecklistPdfRequest(BaseModel):
    titulo: str = "CheckList de Claro"
    servicio_label: str = ""
    sot: str = ""
    cid: str = ""
    fecha: str = ""
    device_id: str = ""
    # Logo guardado en la base de datos (tiene prioridad sobre logo_path)
    logo_id: Optional[str] = None
    # Logo subido solo para este reporte (archivo temporal)
    logo_path: Optional[str] = None
    items: List[ChecklistPdfItem]


class PhotoItemBase(BaseModel):
    categoria: str
    nombre: str
    orden: int = 10


class PhotoItemCreate(PhotoItemBase):
    # Si no se envía "orden" al crear, el ítem va al final de su categoría.
    orden: Optional[int] = None
    # Tipo de reporte. Al editar, si no se envía, se conserva el actual.
    tipo: Optional[str] = None


class PhotoWindowIn(BaseModel):
    nombre: str
    config: Dict[str, Any] = {}
    # Solo al crear: de qué tipo se copian los ítems iniciales
    # ("fibra", "gpon_ont", "gpon_modulo", o "" para empezar vacía).
    copiar_de: Optional[str] = "fibra"


class PhotoWindowOut(BaseModel):
    id: str
    nombre: str
    config: Dict[str, Any] = {}
    class Config:
        from_attributes = True


class PhotoItemOut(PhotoItemBase):
    id: str
    tipo: str = "fibra"
    class Config:
        from_attributes = True


class PhotoReorderRequest(BaseModel):
    """IDs de una categoría en el nuevo orden deseado."""
    ids: List[str]


class HeaderLogoOut(BaseModel):
    id: str
    posicion: Literal["izq", "der"]
    nombre: str
    url: str


class PhotoReportItem(BaseModel):
    numero: int
    descripcion: str
    image_path: Optional[str] = None
    # Identificador de la opción elegida (las opciones las define el usuario)
    lado: str = "site"
    # Texto que se agrega al título del reporte, p. ej. "INSTALACION EN CLIENTE"
    lado_label: str = ""


class PhotoReportRequest(BaseModel):
    # gpon_ont / gpon_modulo: todas las fotos van en el lado CLIENTE.
    tipo: str = "fibra"
    titulo: str = "REPORTE FOTOGRAFICO"
    proy: str = ""
    cliente: str = ""
    sot: str = ""
    fecha: str = ""
    cid: str = ""
    contrata: str = ""
    # Logo ya guardado en la base de datos (tiene prioridad sobre *_path)
    logo_izq_id: Optional[str] = None
    logo_der_id: Optional[str] = None
    # Logo subido solo para este reporte (archivo temporal)
    logo_izq_path: Optional[str] = None
    logo_der_path: Optional[str] = None
    items: List[PhotoReportItem]
    # Orden de las opciones (secciones) en el PDF
    lados: List[str] = []
    # Estado del formulario: se guarda dentro del PDF para poder reabrirlo.
    project: Optional[Dict[str, Any]] = None


class RunTestsRequest(BaseModel):
    connection: Dict[str, Any]
    vendor_key: str
    device_type: str
    uplink: str = ""
    ping: str = ""


class TestsPdfRequest(BaseModel):
    device_id: str = ""
    ip: str = ""
    vendor_label: str = ""
    sede: str = ""
    fecha: str = ""
    logo_izq_id: Optional[str] = None
    logo_der_id: Optional[str] = None
    logo_izq_path: Optional[str] = None
    logo_der_path: Optional[str] = None
    config_text: str = ""
    results: List[Dict[str, Any]] = []


class UploadOut(BaseModel):
    path: str
    url: str


# ---------------- Informe de diseño Poder Judicial ----------------

class PJCell(BaseModel):
    caption: str = ""
    images: List[str] = []          # rutas subidas (image_path)


class PJSection(BaseModel):
    title: str = ""
    cells: List[PJCell] = []


class PJChange(BaseModel):
    version: str = ""
    fecha: str = ""
    modificacion: str = ""


class PJReportRequest(BaseModel):
    portada_lineas: List[str] = []
    subtitulo_lineas: List[str] = []
    version: str = "1.0"
    periodo: str = ""
    cambios: List[PJChange] = []
    sede: str = ""
    sot: str = ""
    ubicacion_titulo: str = "Ubicación del Data Center"
    direccion: str = ""
    coordenadas: str = ""
    foto_ubicacion: Optional[str] = None
    sections: List[PJSection] = []
    conclusiones_intro: str = ""
    conclusiones: List[str] = []
    logo_id: Optional[str] = None
    logo_path: Optional[str] = None
    project: Optional[Dict[str, Any]] = None


# ---------------- CheckList (plantillas y reporte) ----------------

class ChecklistTemplateIn(BaseModel):
    nombre: str
    data: Dict[str, Any] = {}
    # Solo al crear: id de una plantilla existente de la que se copia el contenido
    copiar_de: Optional[str] = None


class ChecklistTemplateOut(BaseModel):
    id: str
    nombre: str
    data: Dict[str, Any] = {}
    class Config:
        from_attributes = True


class ChecklistReportItem(BaseModel):
    nombre: str
    modo: str = "foto"          # "texto" | "foto"
    texto: str = ""             # salida del comando (texto) o captura tipo terminal (foto sin imagen)
    cmd: str = ""
    images: List[str] = []


class ChecklistReportSection(BaseModel):
    titulo: str
    items: List[ChecklistReportItem]


class ChecklistReportRequest(BaseModel):
    titulo: str = "CheckList de Claro"
    servicio_label: str = ""
    sot: str = ""
    cid: str = ""
    cliente: str = ""
    fecha: str = ""
    equipo: str = ""            # nombre del equipo (prompt de la terminal)
    logo_id: Optional[str] = None
    logo_path: Optional[str] = None
    sections: List[ChecklistReportSection]


# ---------------- Clientes (por SOT, año y mes) ----------------

class ClientIn(BaseModel):
    sot: str
    nombre: str = ""
    fecha: str = ""          # yyyy-mm-dd; si falta, hoy
    cid: str = ""
    proy: str = ""
    contrata: str = ""
    datos: Dict[str, str] = {}


class ClientOut(BaseModel):
    id: str
    sot: str
    nombre: str = ""
    fecha: str = ""
    cid: str = ""
    proy: str = ""
    contrata: str = ""
    datos: Dict[str, Any] = {}
    reportes: List[Dict[str, Any]] = []
    class Config:
        from_attributes = True


class ClientSync(BaseModel):
    """Lo que cualquier ventana manda cuando conoce algo de una SOT. Solo se guardan los datos con valor."""
    sot: str
    nombre: str = ""
    fecha: str = ""
    cid: str = ""
    proy: str = ""
    contrata: str = ""
    datos: Dict[str, str] = {}
    reporte: Optional[Dict[str, Any]] = None  # {tipo, nombre, filename, url}


class ClientYearIn(BaseModel):
    year: int


class EvidenceItem(BaseModel):
    nombre: str = ""
    path: str = ""            # foto final (editada, si se editó)
    original_path: str = ""   # foto sin editar (si es distinta)
    lado_label: str = ""


class EvidenceRequest(BaseModel):
    sot: str = ""
    cliente: str = ""
    items: List[EvidenceItem]

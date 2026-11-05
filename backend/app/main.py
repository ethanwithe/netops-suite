import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import CORS_ORIGINS
from sqlalchemy import inspect, text

from app.database import Base, engine, SessionLocal
from app import db_seed
from app.routers import services, vendors, templates, checklist, photos, tests, files, serial_ports, tools, logos, clients, mascot, imageai
from app.routers import auth as auth_router, admin as admin_router, exports as exports_router, diagrams as diagrams_router
from app import auth as authlib, models
from app.services import security

app = FastAPI(title="NetOps Suite API", version="1.0.0", docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def security_layer(request: Request, call_next):
    """Anti-CSRF (peticiones que modifican datos solo desde este mismo sitio) y cabeceras de seguridad."""
    if request.url.path.startswith("/api") and request.method not in SAFE_METHODS:
        origin = request.headers.get("origin", "")
        if origin:
            host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
            same = origin.split("://", 1)[-1].rstrip("/") == host
            if not same and origin.rstrip("/") not in [o.strip().rstrip("/") for o in CORS_ORIGINS]:
                return JSONResponse({"detail": "Origen no permitido."}, status_code=403)
    resp = await call_next(request)
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "SAMEORIGIN")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)")
    if request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https":
        h.setdefault("Strict-Transport-Security", "max-age=15552000")
    if request.url.path.startswith("/api"):
        h.setdefault("Cache-Control", "no-store") if "Cache-Control" not in h else None
    return resp


@app.middleware("http")
async def require_login(request: Request, call_next):
    """Todo /api exige sesión válida (usuario activo, dentro de su vigencia y horario, con permiso)."""
    path = request.url.path
    if path.startswith("/api") and request.method != "OPTIONS" and path not in authlib.PUBLIC_PATHS:
        user, err = authlib.check_request(path, request.method, authlib.token_from(request))
        if err:
            status, code, msg = err
            return JSONResponse({"detail": msg, "code": code}, status_code=status)
    return await call_next(request)


app.include_router(auth_router.router)
app.include_router(admin_router.router)
app.include_router(exports_router.router)
app.include_router(diagrams_router.router)
app.include_router(services.router)
app.include_router(vendors.router)
app.include_router(templates.router)
app.include_router(checklist.router)
app.include_router(photos.router)
app.include_router(clients.router)
app.include_router(mascot.router)
app.include_router(imageai.router)
app.include_router(logos.router)
app.include_router(tests.router)
app.include_router(files.router)
app.include_router(serial_ports.router)
app.include_router(tools.router)


def _ensure_columns() -> None:
    """
    create_all no modifica tablas que ya existen. Aquí se agregan, sin perder
    datos, las columnas nuevas que las bases de datos ya creadas no tienen.
    """
    insp = inspect(engine)
    if "photo_items" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("photo_items")}
        if "tipo" not in cols:
            with engine.begin() as conn:
                # los ítems que ya existían son de "Fibra convencional"
                conn.execute(text("ALTER TABLE photo_items ADD COLUMN tipo VARCHAR NOT NULL DEFAULT 'fibra'"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_photo_items_tipo ON photo_items (tipo)"))
    if "clients" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("clients")}
        with engine.begin() as conn:
            if "owner_id" not in cols:
                conn.execute(text("ALTER TABLE clients ADD COLUMN owner_id VARCHAR"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clients_owner_id ON clients (owner_id)"))
            if "deleted_at" not in cols:
                conn.execute(text("ALTER TABLE clients ADD COLUMN deleted_at TIMESTAMP"))
            if "deleted_by" not in cols:
                conn.execute(text("ALTER TABLE clients ADD COLUMN deleted_by VARCHAR"))


def _ensure_users_and_migrate(db) -> None:
    """Primer arranque con usuarios: crea el superadmin inicial y asigna a él lo que ya existía."""
    root = db.query(models.User).filter(models.User.role == "superadmin").order_by(models.User.created_at).first()
    if not root:
        root = models.User(
            username="superadmin", password_hash=security.hash_password("superadmin123"),
            role="superadmin", full_name="Super administrador", must_change_password=True,
        )
        db.add(root)
        db.commit()
    # Clientes anteriores a los usuarios -> son del superadmin
    for c in db.query(models.Client).filter(models.Client.owner_id.is_(None)).all():
        c.owner_id = root.id
    db.commit()
    shared = {r.client_id for r in db.query(models.ClientShare).all()}
    for c in db.query(models.Client).all():
        if c.id not in shared:
            db.add(models.ClientShare(client_id=c.id, user_id=c.owner_id or root.id))
    db.commit()
    # Ventanas guardadas del esquema anterior (por SOT) -> por cliente
    by_sot = {c.sot: c.id for c in db.query(models.Client).all()}
    if db.query(models.UserWorkspace).count() == 0:
        for w in db.query(models.ClientWorkspace).all():
            cid = by_sot.get(w.sot)
            if cid:
                db.add(models.UserWorkspace(client_id=cid, key=w.key, label=w.label, route=w.route,
                                            state=w.state or {}, updated_at=w.updated_at))
        db.commit()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    db = SessionLocal()
    try:
        _ensure_users_and_migrate(db)
        from app.services.diagram_seed import seed_diagram_icons
        seed_diagram_icons(db)
        db_seed.seed_if_empty(db)
        db_seed.seed_photo_tipos(db)
        db_seed.seed_checklist_templates(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------
# En producción (Docker), el frontend compilado (Vite build) se copia a
# esta carpeta y FastAPI lo sirve directamente -> UNA SOLA imagen/proceso
# atiende tanto la API como la interfaz web.
# ---------------------------------------------------------------
class SPAStaticFiles(StaticFiles):
    """
    Sirve el frontend compilado y, para las rutas de la aplicación
    (/fotografico, /pruebas, ...), devuelve index.html en vez de un 404.

    Sin esto, al recargar la página (F5) estando en una ruta interna el
    navegador pedía un archivo con ese nombre, el servidor respondía
    {"detail":"Not Found"} y se veía una pantalla en blanco/negra con JSON.
    React Router resuelve la ruta en el navegador una vez cargado index.html.

    NO se hace el reemplazo para:
      - /api/...            (un error de la API debe seguir siendo un 404 real)
      - archivos con extensión (assets/app.js, favicon.ico...): si falta uno,
        devolver HTML con código 200 solo escondería el problema.
    """

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not self._is_app_route(path):
                raise
            return await super().get_response("index.html", scope)

        if response.status_code == 404 and self._is_app_route(path):
            return await super().get_response("index.html", scope)
        return response

    @staticmethod
    def _is_app_route(path: str) -> bool:
        path = path.strip("/")
        if path == "api" or path.startswith("api/"):
            return False
        return "." not in path.rsplit("/", 1)[-1]


FRONTEND_DIST = Path(__file__).resolve().parent / "static_frontend"
if FRONTEND_DIST.is_dir():
    app.mount("/", SPAStaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

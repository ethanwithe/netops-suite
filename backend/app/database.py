import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

# Modo local (Windows/Android/pruebas): sin DATABASE_URL se usa SQLite en NETOPS_DATA_DIR.
# En la nube se sigue exigiendo Postgres por DATABASE_URL (no cambia nada ahí).
if not DATABASE_URL:
    if os.getenv("NETOPS_LOCAL", "").lower() in ("1", "true", "yes") or os.getenv("NETOPS_DATA_DIR"):
        _dir = os.getenv("NETOPS_DATA_DIR") or os.path.join(os.path.expanduser("~"), ".netops-suite")
        os.makedirs(_dir, exist_ok=True)
        DATABASE_URL = "sqlite:///" + os.path.join(_dir, "netops.db").replace("\\", "/")
    else:
        raise Exception(
            "DATABASE_URL no está configurada "
            "(en Railway/Render defínela en Variables; en local copia .env.example; "
            "para modo local con SQLite define NETOPS_LOCAL=1)."
        )

# 🔧 Compatibilidad Railway / Render / otros
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

IS_SQLITE = DATABASE_URL.startswith("sqlite")


def _connect_args(url: str) -> dict:
    """
    SSL: se exige (require) en la nube (Railway/Render), pero NO cuando la BD
    es local o es un servicio de Docker (host "localhost", "127.0.0.1" o un
    nombre sin puntos como "db"), porque el Postgres de docker-compose no
    tiene SSL y la conexión fallaría. Se puede forzar con DB_SSLMODE
    (disable, prefer, require, ...).
    """
    forced = os.getenv("DB_SSLMODE")
    if forced:
        return {"sslmode": forced}

    host = (make_url(url).host or "").lower()
    is_local = host in ("", "localhost", "127.0.0.1", "::1") or "." not in host
    return {} if is_local else {"sslmode": "require"}


if IS_SQLITE:
    from sqlalchemy import event

    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _rec):  # WAL: lecturas y escrituras a la vez sin bloquear; FK activadas
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()
else:
  engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,        # al abrir una pantalla llegan ~10 peticiones a la vez: con el pool por defecto (5) esperaban turno
    max_overflow=20,
    pool_recycle=1800,
    connect_args=_connect_args(DATABASE_URL),
  )

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

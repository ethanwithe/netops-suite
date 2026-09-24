# NetOps Suite — Web (React + TypeScript / FastAPI / PostgreSQL)

Versión web de PruebasLAN: mismo backend de negocio (SSH/Serial, plantillas,
checklist, reporte fotográfico) que la app de escritorio, ahora como
aplicación web moderna con frontend interactivo y base de datos PostgreSQL.

```
netops-suite/
├── backend/            FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── main.py             App FastAPI (monta routers + sirve el frontend en prod)
│   │   ├── models.py           Modelos SQLAlchemy (Postgres)
│   │   ├── schemas.py          Schemas Pydantic
│   │   ├── routers/            Endpoints (services, templates, checklist, photos, tests, files)
│   │   ├── services/           Lógica de negocio (SSH/Serial, PDFs, plantillas) — misma que la app de escritorio
│   │   └── seed_data.py        Datos de ejemplo (fragmentos Cisco, checklist América TV, items WITLINK)
│   └── requirements.txt
├── frontend/           React + TypeScript + Vite + Tailwind
│   └── src/
│       ├── pages/               Pruebas, Plantillas, CheckList, Fotográfico
│       ├── components/          ConnectionPanel, ImageUpload, LiveLog, Layout
│       └── api/client.ts        Cliente HTTP + WebSocket tipado
├── docker/allinone/     Soporte para la imagen "todo en uno" (Postgres embebido)
├── scripts/             run_local.sh / run_local.bat
├── Dockerfile            Imagen única app (frontend+backend) — Postgres aparte (recomendado)
├── Dockerfile.allinone   Imagen única CON Postgres embebido (todo en un contenedor)
├── docker-compose.yml           app + Postgres (2 servicios, 1 comando)
└── docker-compose.db-only.yml   Solo Postgres, para desarrollo local híbrido
```

---

## Opción A — Ejecutar LOCALMENTE, sin Docker

**Requisitos:** Python 3.11+, Node.js 20+, PostgreSQL (local o vía Docker solo para la BD).

1. Si no tienes Postgres instalado, levanta solo la base de datos con Docker:
   ```bash
   docker compose -f docker-compose.db-only.yml up -d
   ```
   (o instala Postgres normalmente y crea la BD/usuario `netops`/`netops`
   manualmente — ver `.env.example`).

2. Corre todo con un comando:
   ```bash
   ./scripts/run_local.sh        # Linux/Mac
   scripts\run_local.bat         # Windows
   ```
   Esto instala dependencias (si faltan) y levanta:
   - Backend: http://localhost:8000  (docs interactivos en `/docs`)
   - Frontend: http://localhost:5173  (con recarga en caliente)

   La primera vez que el backend arranca, crea las tablas y siembra datos
   de ejemplo automáticamente (marcas, servicios, fragmentos de plantilla
   Cisco, checklist "Internet CPE Cisco C1121-8P", ítems del reporte
   fotográfico WITLINK).

### Manual (paso a paso, si prefieres no usar el script)
```bash
# Backend
cd backend
pip install -r requirements.txt
export DATABASE_URL="postgresql+psycopg2://postgres:Yoe1999!@localhost:5432/config_db",
uvicorn app.main:app --reload --port 8000

# Frontend (en otra terminal)
cd frontend
npm install
npm run dev
```

---

## Opción B — Dockerizado

### B.1 — Recomendado: app + Postgres (2 servicios, 1 comando)
```bash
docker compose up --build
```
La app queda en **http://localhost:8000** (el backend sirve tanto la API
como el frontend compilado — un solo puerto). Postgres corre en su propio
contenedor con volumen persistente.

### B.2 — Todo en una sola imagen (Postgres incluido, un solo contenedor)
Tal como pediste, esta variante empaqueta absolutamente todo (frontend +
backend + PostgreSQL) en **una sola imagen**:
```bash
docker build -f Dockerfile.allinone -t netops-suite:allinone .
docker run -p 8000:8000 -v netops_pgdata:/var/lib/postgresql/data netops-suite:allinone
```
La app queda igual en **http://localhost:8000**. El volumen
`netops_pgdata` es importante — sin él, los datos de Postgres se pierden
al recrear el contenedor.

> **Nota:** la opción B.1 (Postgres en su propio contenedor) es la práctica
> estándar recomendada — permite actualizar/respaldar la base de datos
> independientemente de la app. La opción B.2 cumple literalmente "todo en
> una sola imagen", pero mezclar la base de datos con la app en un mismo
> contenedor no es lo ideal para producción real. Usa la que prefieras.

---

## Módulos (igual que la app de escritorio, ahora en el navegador)

1. **Pruebas** — conecta por SSH/Serial, ejecuta las pruebas de la marca
   elegida (con log en vivo por WebSocket), y genera el PDF de evidencia.
2. **Plantillas** — CRUD de fragmentos reutilizables (MRA, TACACS, BGP+RPV,
   etc.) por marca/servicio; arma la plantilla completa con las variables
   del formulario y la aplica al equipo (log en vivo).
3. **CheckList** — checklist por servicio (sembrado con el ejemplo real de
   26 ítems "Internet CPE Cisco C1121-8P"), cada ítem automático (SSH/
   Serial) o manual (subir imagen), con generación del PDF estilo
   "CheckList de Claro".
4. **Reporte Fotográfico** — checklist de descripciones (sembrado con los
   14 ítems del ejemplo WITLINK), subida de una foto por ítem, PDF con
   grilla 2×2 estilo "Reporte Fotográfico Instalación Fibra en Site".

Todos los datos (fragmentos, ítems de checklist, descripciones fotográficas)
se guardan en PostgreSQL — a diferencia de la versión de escritorio (que
usaba archivos JSON locales), aquí varios técnicos pueden compartir la
misma base de datos si el backend corre en un servidor común.

## Notas técnicas

- **Conexión Serial**: el listado de puertos COM/tty y la conexión serial
  ocurren **en el servidor donde corre el backend**, no en la PC del
  navegador. Para usar Serial, corre el backend localmente en la laptop
  del técnico (Opción A) — no tiene sentido en un backend remoto/Docker en
  la nube.
- **WebSockets**: las ejecuciones SSH/Serial y la aplicación de plantillas
  usan WebSocket (`/api/tests/run`, `/api/checklist/run`,
  `/api/templates/apply`) para mostrar el progreso en vivo en el frontend,
  en vez de esperar en silencio a que termine.
- **Contraseñas**: viajan solo en memoria por la conexión WebSocket, no se
  guardan en la base de datos.
- Documentación interactiva de la API disponible en `/docs` (Swagger) una
  vez el backend está corriendo.

---

## Novedades de esta actualización

### Bugs corregidos
- **PDF Reporte Fotográfico**: las fotos verticales (formato celular) se desbordaban y tapaban la descripción del
  ítem — corregido, ahora quedan centradas dentro de su recuadro.
- **Cabecera del PDF**: la tabla de datos (PROY/CLIENTE/SOT/...) invadía el header — corregido el cálculo de alto
  de cabecera para que siempre quede debajo del logo/título, con margen de seguridad.

### Subida de imágenes: pegar y arrastrar
Todos los campos de imagen (logos, capturas del checklist, fotos del reporte) ahora aceptan, además del botón de
subir archivo: **pegar con Ctrl+V** (útil si copiaste una captura de pantalla) y **arrastrar y soltar**.

### Reporte Fotográfico: selección en bloque, reordenar y editar
- Checkbox **"Seleccionar todo"** y **"Seleccionar sección"** por categoría, para no tener que marcar ítem por
  ítem.
- **Arrastra el ícono ⠿** de cada fila para reordenar los ítems dentro de su categoría (se guarda automáticamente).
- Botón **"✏️ Editar (líneas punteadas)"** en cualquier foto ya subida: abre un editor donde haces clic para ir
  marcando el recorrido de la fibra con una línea punteada (útil para las fotos de categoría "recorrido"), con
  deshacer/limpiar, y guarda la imagen editada como una nueva captura.

### CheckList: selección en bloque + herramientas de automatización
- Mismos checkboxes de selección en bloque (todo / por sección).
- Nueva pestaña **"🛠 Herramientas"**:
  - **Speedtest automático**: el backend abre un Chrome headless (Playwright), corre el test en una página real
    (fast.com por defecto, configurable), espera a que termine, y te devuelve la captura de pantalla lista para
    asignar a cualquier ítem manual (speedtest, Ostinato, etc.) con un clic.
  - **Ostinato + captura de saturación**: le das el comando que arranca tu script/CLI de Ostinato, cuánto tiempo
    esperar a que la saturación suba hasta el ancho de banda del servicio, y el comando a correr en el router — el
    backend arranca el tráfico, espera automáticamente, y captura WAN (y SUP debajo, si lo configuras) recién
    después de la espera. Asignas el resultado a los ítems que quieras con un clic.

**Nota sobre Playwright/Chromium**: para que el Speedtest automático funcione, el servidor donde corre el backend
necesita tener Chromium instalado (`python -m playwright install --with-deps chromium`, ya incluido en ambos
Dockerfile) y salida a Internet hacia el sitio de speedtest elegido.

**Nota sobre Ostinato**: el endpoint solo orquesta "arrancar → esperar → capturar" — el comando exacto que arranca
el tráfico depende 100% de cómo tengas armado tu script/CLI de Ostinato en esa máquina; no lo controla
directamente porque la configuración de streams varía mucho de un caso a otro.

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

### Usuarios, login y administración

- **Login obligatorio** (usuario y contraseña, sin registro). Al primer arranque se crea `superadmin` / `superadmin123`
  y **se obliga a cambiar la contraseña al entrar**. Cámbiala de inmediato.
- **Roles**: `superadmin` (todo, crea administradores), `admin` (ve todo, gestiona usuarios) y `user` (solo sus clientes).
- **Por usuario el admin define**: activo/desactivado, vigencia (fechas desde/hasta), horario diario (HH:MM, hora de Lima),
  qué funciones puede usar (Gráfica, Plantillas, CheckList, Fotos, Poder Judicial, Bit/IA, Exportar, Editar catálogos),
  restablecer contraseña y cerrar sus sesiones.
- **Perfil**: cada usuario edita sus datos, foto y contraseña. **Mis clientes**: los suyos (y los compartidos).
- **Clientes de todos** (admin): ver/editar cualquiera, filtrar por usuario o mes, **asociar varios usuarios** a una SOT
  (cada cliente vale 1 punto, repartido en partes iguales) y descargar en Excel, Word, PowerPoint, PDF o TXT.
- **Papelera y copias**: borrar un cliente lo envía a la papelera (recuperable); cada ventana guarda copias anteriores
  («Recuperar copias anteriores») para deshacer errores. Todo se guarda solo, por cliente.
- **Actividad** (admin): inicios de sesión, clientes, reportes, exportaciones y cambios por usuario.
- Variables opcionales: `AUTH_SECRET` (firma de sesiones; si falta se deriva de la base de datos) y `APP_TZ` (por defecto `America/Lima`).
- Nuevas dependencias: `openpyxl`, `python-docx`, `python-pptx` (exportes).

### Gráfica: editor de diagramas (como PowerPoint/Canva)
- Ventana **Gráfica** con un desplegable de diagramas; por ahora **«Internet con ONT y Router Cisco»** (réplica del PPTX de ejemplo: mismos iconos, textos, flechas y cuadro Claro).
- Los datos se piden al inicio y se llenan solos desde el cliente guardado (SOT, CID, proyecto, empresa, dirección…); **«Realizado por»** sale del nombre del perfil de la cuenta.
- Todo es editable: mover, cambiar tamaño, girar, textos (también dentro de la tabla), colores, flechas, cambiar de icono, agregar texto/formas/líneas, duplicar, capas, deshacer/rehacer.
- Pestaña **Iconos**: biblioteca compartida (los del ejemplo vienen cargados; cada usuario sube los suyos, PNG/JPG/WEBP/GIF hasta 4 MB).
- Exporta a **PPTX** (formas, textos y tabla editables en PowerPoint) y **PDF**.

### CheckList: consola y SSH desde tu laptop (puente local)
La app corre en Railway, así que no ve tu cable de consola ni los equipos de tu red. Para eso está **`puente.py`** (se descarga desde la tarjeta de conexión del CheckList):
- Se abre en tu laptop (`python puente.py` / `py puente.py`); la primera vez instala solo `pyserial` y `paramiko`. Muestra un código que se pega una vez en la página.
- **Consola:** detecta solo los puertos COM/USB y los lista; el SSH **sale desde tu laptop**, por eso llega a equipos de tu red local, VPN o cable.
- La página solo habla con `127.0.0.1:8766` y con ese código; la contraseña del equipo no pasa por Railway ni se guarda.
- Sigue existiendo la consola directa del navegador (Web Serial, Chrome/Edge) como alternativa sin el puente.

### Agenda y Bit: recordatorios, tareas y eventos
- Pantalla **Agenda** (Mi cuenta): recordatorios, tareas y eventos propios, con hora editable y vencidos en rojo.
- **Bit** los maneja hablando o escribiendo: «recuérdame mañana a las 9 llamar al cliente», «tarea: subir fotos del SOT», «¿qué tengo pendiente?», «marca como hecho…». Con IA entiende lenguaje libre; sin IA entiende frases sencillas («en 20 minutos», «mañana a las 9», «el lunes a las 8:30»).
- Cuando llega la hora, Bit avisa en voz alta y con una burbuja, y con notificación del navegador si diste permiso (la página debe estar abierta; revisa cada 30 s y al volver a la pestaña).
- Cada usuario ve solo su agenda. Tabla nueva `agenda_items` (se crea sola al desplegar).

### CLI en vivo del CheckList
- **Teclado directo:** marca «Teclado directo» y la terminal envía cada tecla al equipo como MobaXterm/PuTTY: **Tab** completa en el router, **?** muestra ayuda, ↑↓ historial del equipo, Ctrl+C cancela, Ctrl+Shift+V pega.
- **Línea de comandos con autocompletado local:** Tab completa con tus comandos guardados, el historial y los comandos de los ítems del checklist; ↑↓ recorre el historial.
- **Sesión guardada y .txt:** todo lo que se envía y devuelve el equipo se guarda solo en este navegador (hasta ~0,8 MB por tipo de checklist), reaparece al recargar y se baja con «⬇ Descargar .txt» (`consola_<SOT>_<fecha>.txt`), con marcas de hora al conectar/desconectar. «limpiar pantalla» no borra el registro; «borrar registro» sí.
- **Mis comandos:** guarda comandos o secuencias (uno por línea, con `{WAN}`, `{LAN}`… de los parámetros) y envíalos con un clic. Se guardan en este navegador.

### Archivos en Telegram (opcional)
Con las variables de Railway `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` y `TELEGRAM_SESSION` (y opcionalmente `TELEGRAM_CHAT`: `@canal`, id numérico o `me`, por defecto tus *Mensajes guardados*), las fotos subidas y los PDF/ZIP generados se guardan en Telegram con tu propia cuenta (Telethon/MTProto). En Postgres solo queda la referencia (`tg_chat`, `tg_msg`); el backend sirve el archivo por las mismas URLs `/api/files/...`. Si Telegram falla o no está configurado, se guarda en la base como antes.
1. Saca `api_id`/`api_hash` en https://my.telegram.org → *API development tools*.
2. En tu laptop: `pip install telethon` y `python backend/tools/telegram_session.py` (con las dos variables definidas). Copia el resultado a Railway como `TELEGRAM_SESSION`.
3. Admin: `GET /api/files/telegram/status` y `POST /api/files/telegram/migrar` (pasa de a 50 los archivos viejos de la base a Telegram).
Nota: logos, íconos de la Gráfica y fotos de perfil siguen en la base (son pequeños y se usan en cada render).

### Bit como asistente permanente (memoria de trabajo)
- **Memoria de trabajo por usuario** (tabla `bit_memories`): proyectos/clientes, comandos, configuraciones, preferencias y rutinas. Lo repetido pesa más (×n) y se usa sin pedir que lo expliques otra vez. Máximo 200 recuerdos; se olvida lo menos usado. Nunca guarda contraseñas, claves, comunidades SNMP ni tokens (filtro en el servidor).
- **Aprende solo:** de la conversación (`[mem:tipo|texto]`) y de lo que haces (los comandos que escribes o envías desde el CLI del CheckList → `POST /api/mascot/observe`).
- **Rutinas:** se deducen de la actividad real de 60 días (horas y días de más trabajo, qué sueles hacer cada día de la semana). Se ven en el panel de Bit → *Mi memoria de trabajo*, donde también puedes enseñarle algo, quitar recuerdos u olvidar todo.
- **Se adelanta:** una vez al día Bit revisa tu trabajo (`GET /api/mascot/proactive`) y te avisa de pendientes vencidos o de hoy, SOT que tocaste sin generar reporte y lo que sueles hacer ese día, con botón para ir a la pantalla.
- **Mejora con el tiempo:** 👍/👎 en cada respuesta (`POST /api/mascot/feedback`); guarda las 12 valoraciones más recientes y Bit ajusta su estilo.
- Tabla nueva `bit_memories` (se crea sola).

### Editor de imágenes con Gemini
«Transformar con IA» (edición generativa) usa **Gemini** (`GEMINI_API_KEY`, modelo `gemini-2.5-flash-image` por defecto; si Google lo retira, el servidor descubre solo el vigente; ajustable con `GEMINI_IMAGE_MODEL`); si falla y hay `OPENAI_API_KEY`, prueba con OpenAI. «Analizar y ajustar» (brillo, sombras, recortes, difuminado) ya funciona con Gemini y no inventa píxeles. Ojo: el modelo de imagen de Gemini suele requerir facturación activa en tu cuenta de Google AI Studio y devuelve imágenes de ~1024 px.

### Modelos de Gemini que Google retira
Si un modelo de Gemini da 404 («no longer available»), el servidor consulta la lista de modelos de tu clave, elige el flash estable más nuevo (texto o imagen) y reintenta, y lo recuerda hasta el próximo despliegue. Por defecto usa `gemini-3.8-flash`; puedes fijar otro con `GEMINI_MODEL` en Railway.

### Velocidad
- **Ubicación del sello:** la dirección sale en dos fases (zona en ~0,3 s y luego la calle exacta, que queda en caché) y, si el permiso de ubicación ya estaba concedido, la posición se calienta al abrir la página para que la cámara no espere. Una lectura vieja que el navegador tenía guardada nunca se imprime en el sello.
- **Servidor:** caché de 5 s de la sesión en el middleware (antes cada petición consultaba el usuario dos veces), pool de conexiones más grande (10+20) y caché de un día para las fotos subidas (antes `no-store`: se bajaban de nuevo en cada vista).
- **Navegador:** las fuentes de Google ya no bloquean el primer pintado; en equipos modestos (≤4 núcleos, ≤4 GB o «reducir movimiento») arrancan sin gotas animadas ni cristal líquido (se activan en *Aspecto*).
- **Railway (recomendado):** usa en `DATABASE_URL` la referencia interna `${{Postgres.DATABASE_URL}}` (host `postgres.railway.internal`), no la URL pública `*.proxy.rlwy.net`: cada consulta es mucho más rápida. Con `WEB_CONCURRENCY=2` el servidor atiende con 2 procesos y un PDF pesado ya no frena al resto.

### Razonamiento de Bit
Bit usa una guía de razonamiento (contexto de la conversación, pasos y verificación, pregunta de aclaración si es ambiguo) y conocimiento de redes/fibra (Huawei, Cisco, Fortinet, MikroTik, GPON). Con Gemini 2.5 usa razonamiento ligero; recuerda los últimos 20 mensajes y puedes pegarle la salida de un comando (hasta 8000 caracteres) para que la interprete. Con `ANTHROPIC_API_KEY` o con `GEMINI_API_KEY` (búsqueda de Google integrada; solo se activa si el mensaje parece pedirla —«busca», «precio», «último», «hoy»…— para no hacerlo lento) Bit puede buscar en la web; con Groq no hay búsqueda. `MASCOT_WEB=0` la apaga.

### Bit como amigo: memoria por usuario, clientes y reportes para el administrador
- **Memoria en el servidor** (tabla `bit_profiles`): Bit recuerda nombre, gustos, hábitos y lo que le cuentas, en cualquier dispositivo y sin mezclarse con otra persona que use el mismo navegador. Bit también ve tu actividad reciente (clientes, puntos, qué haces más) para tratarte como alguien que te conoce. En su panel se avisa que el administrador puede ver un resumen.
- **Agregar clientes por conversación:** «agrega el cliente SOT 91683098, Maxi Mobility, CID 27348260…» y «guarda la IP WAN 10.31.208.25 del SOT…» (requiere la IA de Bit configurada).
- **Para administradores:** Bit conoce una tabla de todos los usuarios (último ingreso, clientes, puntos del mes, acciones de 7 días, gustos aprendidos). Se le pregunta «¿cómo va Juan?», «¿quién ha trabajado más este mes?» y arma **dashboards en el chat** (barras, líneas, tablas y ficha de usuario). Con **Fijar** quedan en *Admin → Reportes de Bit*, que se recalculan al abrir.
- Tablas nuevas: `bit_profiles`, `bit_reports` (se crean solas).

### Reporte Fotográfico estilo Poder Judicial (secciones y celdas)

- Cada opción (GPON con ONT, GPON con módulo, Fibra convencional) se arma por **secciones con título** (desplegable y editable),
  dentro de cada una **bloques** con los nombres de siempre (EQUIPOS INSTALADOS ACCESO, ETIQUETADO…) y en cada bloque **celdas** (texto + foto). Al abrir se crean con las descripciones de
  siempre; GPON trae solo CLIENTE y SITE se agrega con "Agregar sección". Se pueden agregar/quitar/reordenar
  secciones y celdas, y crear títulos nuevos. El PDF mantiene el mismo formato.
- Nombre del archivo: `ISD-RECORRIDO-<SOT>-<CID>-<versión>.pdf` (versión editable, por defecto `01`).
- Los reportes guardados en el formato anterior se convierten solos.

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

## Mascota «Bit» con inteligencia artificial (opcional)

Sin configurar nada, Bit responde con su cerebro local (palabras clave). Para que converse de forma
inteligente, agrega en Railway (servicio del backend) las variables:

- `ANTHROPIC_API_KEY`: tu clave de la API de Anthropic (solo como variable de entorno, nunca en el repo).
- `MASCOT_MODEL` (opcional): modelo a usar; por defecto `claude-sonnet-5-5`.
- **IA gratis (alternativa):** `GEMINI_API_KEY` (aistudio.google.com) o `GROQ_API_KEY` (console.groq.com) o `OPENROUTER_API_KEY` (openrouter.ai, modelos gratuitos `:free`; por defecto `openrouter/free`, ajustable con `OPENROUTER_MODEL`, acepta varios separados por coma). Se usan si no hay `ANTHROPIC_API_KEY`, tanto para Bit como para «Mejorar con IA» del editor. Modelos con `GEMINI_MODEL`, `GROQ_MODEL`, `GROQ_VISION_MODEL`, `OPENROUTER_MODEL`, `OPENROUTER_VISION_MODEL`. Si uno falla (cuota, error), Bit pasa solo al siguiente.
- **Transformar con IA (editor de imágenes):** usa primero OpenRouter con `OPENROUTER_API_KEY` y el modelo de imagen `OPENROUTER_IMAGE_MODEL` (por defecto `google/gemini-2.5-flash-image`; necesita créditos en OpenRouter). Si falla, prueba Gemini y luego OpenAI. «Analizar y ajustar» también prefiere OpenRouter cuando no hay `ANTHROPIC_API_KEY`.
- `MASCOT_WEB` (opcional): `0` desactiva la búsqueda web de Bit.
- `OPENAI_API_KEY` también activa las **voces naturales** de Bit (modelo con `TTS_MODEL`). Sin ella usa las voces del navegador.
- El micrófono de Bit queda siempre escuchando (se activa/desactiva desde Bit); la memoria de gustos se guarda en cada navegador.

La conversación por voz usa el reconocimiento de voz del navegador (Chrome o Edge) y las voces del
sistema; en Edge las voces «Natural» en español suenan mucho más humanas.

## IA en el editor de imágenes (opcional)

- `ANTHROPIC_API_KEY`: activa «Analizar y ajustar» (Claude mira la foto y decide brillo, sombras, nitidez,
  recortes y zonas a difuminar; no inventa contenido). Modelo con `IMAGE_AI_MODEL` (por defecto `claude-sonnet-5-5`).
- `OPENAI_API_KEY`: activa «Transformar con IA» (edición generativa de la imagen). Modelo con `IMAGE_EDIT_MODEL`
  (por defecto `gpt-image-1`). Modifica el contenido de la foto: no usar en evidencias que no deban alterarse.

## Personalización visual
Menú «Tema» → «Personalizar fondo y colores»: fondo 3D (burbujas, esferas, olas, cristales, estrellas), gotas, color del fondo/gotas/botones, intensidad y efecto «cristal líquido» al pasar el cursor. Se guarda en cada navegador.

## Todo por cliente (SOT)
- Al escribir la SOT en el reporte fotográfico, el CheckList o Poder Judicial, **todo lo de esa ventana se guarda solo** en el servidor (textos, opciones, fotos, capturas) asociado a la SOT. Si la SOT ya tenía datos, la ventana pregunta si quieres traerlos para seguir editando; si es un cliente existente sin nada guardado en esa ventana, trae sus datos base (nombre, CID, IPs, interfaces…).
- En **Datos de cliente → (cliente) → Trabajo guardado** puedes abrir cada ventana tal como la dejaste.
- Las **fotos subidas y los PDF/ZIP generados** se copian a la base de datos (tablas `stored_files` y `client_workspaces`, que se crean solas), así no se pierden en los despliegues de Railway y se pueden volver a descargar desde el cliente.

# NetOps Suite · funcionamiento sin conexión y sincronización

## Idea
Todo cambio se guarda **primero en el equipo** y después se sube. Sin Internet no se pierde nada; al volver la
conexión se sincroniza solo. Cada instalación (web, Windows, Android) tiene su propia base local.

## Piezas
| Pieza | Dónde | Qué hace |
|---|---|---|
| Base local | `frontend/src/sync/db.ts` (IndexedDB `netops-sync`) | cola de operaciones, fotos pendientes, copia de lo descargado |
| Motor | `frontend/src/sync/engine.ts` | cola, reintentos con espera creciente, push/pull, conflictos, fotos |
| Indicador | `components/SyncIndicator.tsx` | Online/Offline, pendientes, fotos, última sync, errores, «Sincronizar ahora», resolver conflictos |
| Service worker | `frontend/public/sw.js` | abre la app sin conexión y sirve las fotos que aún no se subieron |
| API | `backend/app/routers/sync.py` | `/api/sync/push`, `/pull`, `/changes`, `/resolve`, `/photos` |
| Copia temporal de ventanas | `store/localDraft.ts`, `store/workspaces.ts` | lo que hay en pantalla no se pierde (también si se cierra la pestaña) |

## Estados de un registro
`LOCAL` · `PENDING_SYNC` · `SYNCING` · `SYNCED` · `SYNC_ERROR` · `CONFLICT`

## Reglas de seguridad de datos
- Cada operación tiene un `op_id` (UUID): reenviarla no la aplica dos veces.
- Cada registro tiene `version`. Si se editó sobre una versión vieja → `CONFLICT`; **nunca** se pisa en silencio.
- Un guardado que vaciaría casi toda una ventana se trata como conflicto (`shrink`).
- Lo que se reemplaza queda en «Recuperar copias anteriores» (ventanas).
- Nada se borra del equipo hasta que el servidor confirma (`applied`); las fotos se verifican con SHA-256.
- Cada usuario solo sube lo suyo; si otra persona entra en el mismo equipo, lo descargado de la anterior se descarta.

## Entidades sincronizadas
`client`, `workspace` (ventana por cliente: foto, CheckList, Poder Judicial, Gráfica…), `checklist_copy`, fotos.
Pendiente: diagramas publicados y archivos generados (PDF/ZIP se generan en el servidor).

## Pruebas
`cd backend && pip install -r requirements.txt -r requirements-dev.txt && python -m pytest tests -q` (SQLite temporal; corre en GitHub Actions).

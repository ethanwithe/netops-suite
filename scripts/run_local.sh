#!/usr/bin/env bash
# ============================================================
# run_local.sh
# Corre backend + frontend LOCALMENTE (sin Docker), en modo desarrollo.
#
# Requisitos previos:
#   - PostgreSQL accesible (local, o "docker compose -f
#     docker-compose.db-only.yml up -d" para solo la BD en Docker)
#   - Python 3.11+ con las dependencias de backend/requirements.txt
#     (recomendado: crear un venv primero)
#   - Node.js 20+
#
# Uso:
#   ./scripts/run_local.sh
# ============================================================
set -e
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg2://postgres:Yoe1999%21@localhost:5432/config_db}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173}"

echo "== Backend: instalando dependencias (si falta algo) =="
pip install -r backend/requirements.txt --quiet

echo "== Frontend: instalando dependencias (si falta algo) =="
(cd frontend && npm install --silent)

echo "== Iniciando backend en http://localhost:8000 =="
(cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

echo "== Iniciando frontend en http://localhost:5173 =="
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "Backend:  http://localhost:8000/docs"
echo "Frontend: http://localhost:5173"
echo "(Ctrl+C para detener ambos)"
wait

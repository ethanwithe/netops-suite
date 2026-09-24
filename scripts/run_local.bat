@echo off
REM ============================================================
REM run_local.bat
REM Corre backend + frontend localmente (sin Docker) en Windows.
REM Requisitos: Python 3.11+, Node.js 20+, y Postgres accesible
REM (local o "docker compose -f docker-compose.db-only.yml up -d").
REM ============================================================
cd /d "%~dp0\.."

set "DATABASE_URL=postgresql+psycopg2://postgres:Yoe1999%%21@localhost:5432/config_db"
set "CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173"

echo == Backend: instalando dependencias ==
pip install -r backend\requirements.txt

echo == Frontend: instalando dependencias ==
cd frontend
call npm install
cd ..

echo == Iniciando backend (nueva ventana) ==
start "NetOps Backend" cmd /k "cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo == Iniciando frontend (nueva ventana) ==
start "NetOps Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo Backend:  http://localhost:8000/docs
echo Frontend: http://localhost:5173

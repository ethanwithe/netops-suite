#!/bin/bash
# Inicializa el cluster de Postgres y crea la BD/usuario si es la primera vez
# que se monta el volumen (PGDATA vacío).
set -e

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo ">> Inicializando cluster PostgreSQL en $PGDATA ..."
  gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=md5
  echo "host all all 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
  echo "listen_addresses='*'" >> "$PGDATA/postgresql.conf"

  gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start
  gosu postgres psql -v ON_ERROR_STOP=1 --username postgres <<-SQL
    CREATE USER netops WITH PASSWORD 'netops';
    CREATE DATABASE netops OWNER netops;
    GRANT ALL PRIVILEGES ON DATABASE netops TO netops;
SQL
  gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop
  echo ">> Cluster PostgreSQL listo."
fi

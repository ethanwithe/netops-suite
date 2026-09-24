#!/bin/bash
set -e
mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"
/docker-entrypoint-init-db.sh
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf

#!/bin/sh
set -eu
umask 077
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file .env.production -f compose.production.yml exec -T postgres pg_dump -U assessflow -Fc assessflow > "$BACKUP_DIR/assessflow-$STAMP.dump"
docker compose --env-file .env.production -f compose.production.yml exec -T minio tar -C /data -cf - . > "$BACKUP_DIR/assessflow-files-$STAMP.tar"
echo "Database and file snapshots saved. Encrypt and copy to the approved off-site backup store."

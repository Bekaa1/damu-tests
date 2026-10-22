#!/bin/sh
set -eu
umask 077
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
compose() {
  docker compose --env-file .env.production -f compose.production.yml "$@"
}

compose exec -T postgres pg_dump -U assessflow -Fc assessflow > "$BACKUP_DIR/assessflow-$STAMP.dump"
STORE_CONTAINER=$(compose ps -q object-store)
if [ -z "$STORE_CONTAINER" ]; then
  echo "AssessFlow object-store is not running; database backup was saved but file backup was skipped." >&2
  exit 1
fi

# Freeze Garage briefly so its data and metadata volumes are copied consistently.
docker pause "$STORE_CONTAINER" >/dev/null
resume_store() {
  docker unpause "$STORE_CONTAINER" >/dev/null 2>&1 || true
}
trap resume_store EXIT HUP INT TERM

docker run --rm --network none \
  -v assessflow_files:/garage-data:ro \
  -v assessflow_garage_metadata:/garage-meta:ro \
  busybox:1.36 tar -cf - -C /garage-data . -C /garage-meta . \
  | gzip -1 > "$BACKUP_DIR/assessflow-files-$STAMP.tar.gz"
resume_store
trap - EXIT HUP INT TERM

echo "Database and Garage snapshots saved. Encrypt and copy them to the approved off-site backup store."
#!/usr/bin/env bash
# Restores a backup made by backup.sh (docs/deployment.md). THIS REPLACES the
# live database and uploads.   ./restore.sh <stamp>   e.g. 20261101-021500
set -euo pipefail
cd "$(dirname "$0")"
stamp="${1:?usage: restore.sh <stamp>}"
[ -f "backups/db-$stamp.sql.gz" ] || { echo "No such backup" >&2; exit 1; }

read -r -p "Replace the live data with backup $stamp? Type yes: " answer
[ "$answer" = "yes" ] || { echo "Cancelled"; exit 1; }

gunzip -c "backups/db-$stamp.sql.gz" | docker compose exec -T db psql -U booking -d booking
if [ -f "backups/uploads-$stamp.tar.gz" ]; then
  docker run --rm -v booking_uploads:/data -v "$PWD/backups:/in:ro" alpine \
    sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /in/uploads-$stamp.tar.gz -C /data"
fi
echo "Restored $stamp"

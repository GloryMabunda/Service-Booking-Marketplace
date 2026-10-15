#!/usr/bin/env bash
# Backs up the database and the uploads (#87, docs/deployment.md). Run by
# deploy.sh before each migration, and nightly by cron:
#   15 2 * * *  /opt/booking/backup.sh
# Keeps 14 days in /opt/booking/backups. Copy that folder somewhere off this
# server too (see docs/deployment.md): a backup on the same machine does not
# survive losing the machine.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
stamp="$(date -u +%Y%m%d-%H%M%S)"

docker compose exec -T db pg_dump -U booking --clean --if-exists booking \
  | gzip > "backups/db-$stamp.sql.gz"

docker run --rm -v booking_uploads:/data:ro -v "$PWD/backups:/out" alpine \
  tar czf "/out/uploads-$stamp.tar.gz" -C /data .

find backups -type f -mtime +14 -delete
echo "Backed up to backups/ ($stamp)"

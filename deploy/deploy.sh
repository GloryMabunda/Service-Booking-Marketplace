#!/usr/bin/env bash
# Deploys one version of the app (#90). Runs on the server, started by the
# GitHub Actions deploy workflow:   ./deploy.sh ghcr.io/owner/repo:<tag>
#
# 1. Backs up the database and the uploads.
# 2. Applies the database migrations with the NEW version. If that fails, it
#    stops here: the running version is untouched.
# 3. Starts the new version and waits for its health check. If it never gets
#    healthy, it puts the previous version back.
#
# Because the old version keeps running while the migrations are applied, and
# is put back if the new one fails, every migration must work with the
# previous version of the app too (add things first, remove them in a later
# release).
set -euo pipefail
cd "$(dirname "$0")"

NEW_IMAGE="${1:?usage: deploy.sh <image>}"
PREVIOUS_IMAGE=""
if [ -f current-image ]; then PREVIOUS_IMAGE="$(cat current-image)"; fi

export APP_IMAGE="$NEW_IMAGE"
echo "Deploying $NEW_IMAGE (previous: ${PREVIOUS_IMAGE:-none})"

docker compose pull app caddy db
docker compose up -d db --wait

if [ -n "$PREVIOUS_IMAGE" ]; then
  ./backup.sh
else
  echo "First deploy: nothing to back up yet"
fi

echo "Running migrations"
if ! docker compose run --rm --no-deps app node dist/scripts/migrate.js; then
  echo "MIGRATIONS FAILED. The running version has not been changed." >&2
  exit 1
fi

docker compose up -d app caddy

echo "Waiting for the app to be healthy"
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || echo starting)"
  if [ "$status" = "healthy" ]; then
    echo "$NEW_IMAGE" > current-image
    echo "Deployed $NEW_IMAGE"
    exit 0
  fi
  sleep 3
done

echo "The new version did not become healthy." >&2
if [ -n "$PREVIOUS_IMAGE" ]; then
  echo "Putting $PREVIOUS_IMAGE back" >&2
  APP_IMAGE="$PREVIOUS_IMAGE" docker compose up -d app
fi
exit 1

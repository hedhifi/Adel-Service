#!/bin/sh
# Extra Postgres dump for the Compose/VPS install.
# Render and Fly already keep managed backups. Use this when you want a copy
# that does not live on the same disk as the database.
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out=${1:-"backups/adel-${stamp}.sql.gz"}
mkdir -p "$(dirname "$out")"

if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  pg_dump --dbname="$DATABASE_URL" --no-owner --format=plain | gzip -c > "$out"
  echo "$out"
  exit 0
fi

echo "pg_dump is not on this PATH. From a machine with the prod compose stack running:" >&2
echo "  docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U adel --no-owner adel | gzip -c > backups/adel-${stamp}.sql.gz" >&2
exit 1

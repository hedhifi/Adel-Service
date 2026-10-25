#!/bin/sh
# Container entrypoint. `serve` migrates (unless RUN_MIGRATIONS=false) and starts Next.
# Any other command is run as-is so a release step or cron can reuse the image.
set -eu
cd /app

if [ "$#" -gt 0 ] && [ "$1" != "serve" ]; then
  exec "$@"
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations"
  node packages/db/migrate.mjs
fi

# Docker sets HOSTNAME to the container id. Next would bind to that name and miss health checks.
# Call the Next binary directly so startup does not download pnpm.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
echo "Starting Adel Service on ${HOSTNAME}:${PORT}"
cd /app/apps/web
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT"

#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'adel_test'" | grep -q 1 \
  || psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c \
  "CREATE DATABASE adel_test OWNER \"$POSTGRES_USER\""

#!/usr/bin/env bash
# Drops and recreates a LOCAL development/test database, then applies migrations.
# Refuses to run against anything but localhost.
set -euo pipefail
DB_URL="${1:-${DATABASE_URL:?DATABASE_URL not set}}"
case "$DB_URL" in
  *@localhost:*|*@127.0.0.1:*) ;;
  *) echo "Refusing to recreate a non-local database: $DB_URL" >&2; exit 1 ;;
esac
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
cd "$(dirname "$0")/../packages/db"
DATABASE_URL="$DB_URL" npx prisma migrate deploy

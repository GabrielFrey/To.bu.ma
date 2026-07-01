#!/bin/sh
set -e

echo "[tbm] Applying Postgres schema (prisma db push)..."
npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate --accept-data-loss

if [ "${TBM_SEED:-true}" = "true" ]; then
  echo "[tbm] Ensuring demo seed (only if empty)..."
  node dist/ensureSeed.js || echo "[tbm] seed step skipped (continuing)"
fi

echo "[tbm] Starting backend on port ${PORT:-4000}..."
exec node dist/server.js

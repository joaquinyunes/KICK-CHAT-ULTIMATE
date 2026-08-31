#!/usr/bin/env bash
# Deploy / actualización en el VPS. Idempotente: podés correrlo cada vez que
# quieras publicar cambios.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env.production ]; then
  echo "ERROR: falta .env.production (copiá .env.production.example y completá)." >&2
  exit 1
fi

mkdir -p data secrets
# Placeholder para el bind-mount si todavía no generaste el pool de bearers.
[ -f secrets/bearers.enc ] || : > secrets/bearers.enc

echo "==> Build + arranque"
docker compose up -d --build

echo "==> Estado"
docker compose ps
echo
echo "Logs en vivo:  docker compose logs -f app"

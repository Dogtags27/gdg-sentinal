#!/usr/bin/env bash
# Deploy the latest main on the EC2 box. Hriday only.
#   ./infra/deploy.sh            pull, rebuild, restart, warm up
#   ./infra/deploy.sh --no-pull  rebuild what is on disk (for a hotfix edited on the box)
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Missing .env in $(pwd). Copy infra/env.template and fill it in."; exit 1; }

if [ "${1:-}" != "--no-pull" ]; then
  git pull --ff-only
fi
echo "Deploying $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

docker compose --env-file .env -f infra/docker-compose.prod.yml up -d --build
docker compose --env-file .env -f infra/docker-compose.prod.yml ps

python3 infra/warmup.py http://localhost --wait 180 || {
  echo "Warm-up failed. Recent logs:"
  docker compose --env-file .env -f infra/docker-compose.prod.yml logs --tail=40 engine gateway
  exit 1
}
echo "Deployed $(git rev-parse --short HEAD)."

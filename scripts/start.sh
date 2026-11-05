#!/usr/bin/env bash
# One command for a demo: start the Compose stack, make sure it has a warden account and demo
# data, wait until the API is ready, then open the web app in the browser.
#
#   bash scripts/start.sh                 # api + postgres + pgadmin + prometheus + grafana
#   MONITORING=0 bash scripts/start.sh    # without prometheus + grafana
#   NO_BROWSER=1 bash scripts/start.sh    # don't open the browser
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=scripts/open-url.sh
source scripts/open-url.sh

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is not installed or not on PATH"
docker info >/dev/null 2>&1 || die "Docker is not running; start Docker Desktop and try again"
[[ -f .env ]] || { cp .env.example .env; echo "Created .env from .env.example"; }

profile=()
[[ "${MONITORING:-1}" == "1" ]] && profile=(--profile monitoring)

log "Starting the stack (first run builds the image, ~2 min)"
docker compose "${profile[@]}" up -d --build --wait

log "Warden account and demo data (safe to repeat)"
# create_admin reads ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from .env inside the container.
docker compose exec -T api python -m scripts.create_admin
docker compose exec -T api python -m scripts.seed_demo_data

log "Waiting for $BASE_URL/health/ready"
for _ in $(seq 1 60); do
  curl -fsS "$BASE_URL/health/ready" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$BASE_URL/health/ready" >/dev/null || die "the API did not become ready; see: docker compose logs api"

cat <<EOF

Ready.
  Web app:    $BASE_URL
  Swagger:    $BASE_URL/docs
  pgAdmin:    http://localhost:5050
EOF
[[ "${MONITORING:-1}" == "1" ]] && printf '  Grafana:    http://localhost:3000\n  Prometheus: http://localhost:9090\n'
echo
open_url "$BASE_URL"

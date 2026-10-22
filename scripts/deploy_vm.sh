#!/usr/bin/env bash
# Deploy (or update) the API on a single VM with Docker Compose.
# Run this ON the VM, from the deploy directory that holds docker-compose.prod.yml and .env.
#
# Usage:
#   ./deploy_vm.sh                                   # redeploy the IMAGE already set in .env
#   ./deploy_vm.sh ghcr.io/<owner>/hostel-food-rating-api:<sha>   # pin a new image
#
# Optional env:
#   DEPLOY_DIR      directory with the compose file and .env (default: this script's directory)
#   COMPOSE_FILE    compose file name (default: docker-compose.prod.yml)
#   GHCR_USER / GHCR_TOKEN   log in to ghcr.io first (only needed for private packages)
#   API_PORT        published API port used for the health check (default: 8000)
#   HEALTH_TIMEOUT  seconds to wait for /health (default: 90)
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
API_PORT="${API_PORT:-8000}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
NEW_IMAGE="${1:-}"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

cd "$DEPLOY_DIR"
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE not found in $DEPLOY_DIR"
[ -f .env ] || die ".env not found in $DEPLOY_DIR (copy .env.example and fill in production values)"
command -v docker >/dev/null || die "docker is not installed"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

if [ -n "${GHCR_TOKEN:-}" ]; then
    log "logging in to ghcr.io as ${GHCR_USER:?GHCR_USER is required with GHCR_TOKEN}"
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

if [ -n "$NEW_IMAGE" ]; then
    log "pinning IMAGE=$NEW_IMAGE in .env"
    if grep -q '^IMAGE=' .env; then
        sed -i.bak "s|^IMAGE=.*|IMAGE=${NEW_IMAGE}|" .env && rm -f .env.bak
    else
        printf '\nIMAGE=%s\n' "$NEW_IMAGE" >> .env
    fi
fi

log "pulling images"
compose pull --quiet

log "starting services"
compose up -d --remove-orphans

log "waiting up to ${HEALTH_TIMEOUT}s for http://localhost:${API_PORT}/health"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
until curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        compose ps
        compose logs --tail=100 api
        die "API did not become healthy in ${HEALTH_TIMEOUT}s"
    fi
    sleep 3
done

if curl -fsS "http://localhost:${API_PORT}/health/ready" >/dev/null 2>&1; then
    log "API is live and ready"
else
    log "WARNING: /health is up but /health/ready is failing (database?)"
fi

log "removing dangling images"
docker image prune -f >/dev/null

compose ps
log "deploy finished"

#!/usr/bin/env bash
# Rollback demo on the kind cluster: deploy a broken image, watch the rollout stall while the old
# pods keep serving (maxUnavailable: 0), then `kubectl rollout undo` back to the working version.
#
# Usage: bash scripts/rollback-demo.sh        (env overrides: NAMESPACE, DEPLOYMENT, HOST_URL)
set -euo pipefail

NAMESPACE="${NAMESPACE:-hostel-food}"
DEPLOYMENT="${DEPLOYMENT:-hostel-food-api}"
HOST_URL="${HOST_URL:-http://hostel-food.localtest.me:8080}"
BROKEN_IMAGE="hostel-food-rating-api:broken-does-not-exist"

k() { kubectl -n "$NAMESPACE" "$@"; }
log() { printf '\n==> %s\n' "$*"; }
health() { curl -s -o /dev/null -w "GET /health -> HTTP %{http_code}\n" "$HOST_URL/health" || true; }

log "Current state"
k get deployment "$DEPLOYMENT" -o wide
health

log "Deploying a broken image: $BROKEN_IMAGE"
k set image "deployment/$DEPLOYMENT" "api=$BROKEN_IMAGE"
k annotate "deployment/$DEPLOYMENT" kubernetes.io/change-cause="demo: broken image $BROKEN_IMAGE" --overwrite >/dev/null
if k rollout status "deployment/$DEPLOYMENT" --timeout=45s; then
  echo "The broken rollout unexpectedly succeeded" >&2
  exit 1
fi

log "Rollout is stuck; the new pod can't pull its image, the old pods still serve"
k get pods -l app.kubernetes.io/name="$DEPLOYMENT"
health
k rollout history "deployment/$DEPLOYMENT"

log "Rolling back: kubectl rollout undo deployment/$DEPLOYMENT"
k rollout undo "deployment/$DEPLOYMENT"
k rollout status "deployment/$DEPLOYMENT" --timeout=180s

log "Recovered"
k get pods -l app.kubernetes.io/name="$DEPLOYMENT"
k get deployment "$DEPLOYMENT" -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
health

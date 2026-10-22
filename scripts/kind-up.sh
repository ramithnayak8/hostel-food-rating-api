#!/usr/bin/env bash
# Create (or reuse) a local kind cluster and deploy the full stack into it:
#   ingress-nginx + metrics-server (for the HPA) + Postgres + the API built from this checkout.
#
# Usage: scripts/kind-up.sh            (env overrides: CLUSTER_NAME, IMAGE, SKIP_BUILD=1)
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-hostel-food}"
IMAGE="${IMAGE:-hostel-food-rating-api:local}"
NAMESPACE="hostel-food"
INGRESS_NGINX_VERSION="controller-v1.15.1"
METRICS_SERVER_VERSION="v0.9.0"
HOST_URL="http://hostel-food.localtest.me:8080"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

for tool in docker kind kubectl; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is not installed or not on PATH"
done
docker info >/dev/null 2>&1 || die "Docker daemon is not running"

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  log "Reusing existing kind cluster '$CLUSTER_NAME'"
else
  log "Creating kind cluster '$CLUSTER_NAME'"
  kind create cluster --name "$CLUSTER_NAME" --config k8s/kind-config.yaml --wait 120s
fi
kubectl config use-context "kind-$CLUSTER_NAME" >/dev/null

log "Installing ingress-nginx ($INGRESS_NGINX_VERSION)"
kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${INGRESS_NGINX_VERSION}/deploy/static/provider/kind/deploy.yaml"
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=300s

log "Installing metrics-server ($METRICS_SERVER_VERSION)"
kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml"
# kind's kubelets use self-signed serving certs; metrics-server must skip verifying them.
if ! kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' \
  | grep -q -- '--kubelet-insecure-tls'; then
  kubectl -n kube-system patch deployment metrics-server --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
fi
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "Building image $IMAGE"
  docker build -t "$IMAGE" .
fi
log "Loading $IMAGE into the cluster"
kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"

log "Applying k8s/overlays/local"
# The ingress-nginx admission webhook can take a few seconds to accept requests after the
# controller reports ready, so retry the apply briefly instead of failing the whole script.
for attempt in 1 2 3 4 5 6; do
  if kubectl apply -k k8s/overlays/local; then
    break
  fi
  [[ "$attempt" == 6 ]] && die "kubectl apply failed"
  echo "apply failed (attempt $attempt), retrying in 10s..."
  sleep 10
done

# A rebuilt :local image keeps the same tag, so force new pods to pick it up.
kubectl -n "$NAMESPACE" rollout restart deployment/hostel-food-api >/dev/null

log "Waiting for Postgres and the API"
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=300s
kubectl -n "$NAMESPACE" rollout status deployment/hostel-food-api --timeout=300s
kubectl -n "$NAMESPACE" get pods,svc,ingress,hpa

cat <<EOF

Ready.
  API docs:   $HOST_URL/docs
  Health:     $HOST_URL/health
  Metrics:    $HOST_URL/metrics

Create an admin:
  kubectl -n $NAMESPACE exec deploy/hostel-food-api -c api -- \\
    python -m scripts.create_admin --email warden@hostel.example.com --password 'change-me-admin-password' --name Warden
Smoke test:
  BASE_URL=$HOST_URL ADMIN_EMAIL=warden@hostel.example.com ADMIN_PASSWORD='change-me-admin-password' \\
    CREATE_ADMIN_CMD="kubectl -n $NAMESPACE exec -i deploy/hostel-food-api -c api -- python -m scripts.create_admin" \\
    scripts/smoke_test.sh
Watch autoscaling:
  kubectl -n $NAMESPACE get hpa -w
Tear down:
  scripts/kind-down.sh
EOF

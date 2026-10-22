#!/usr/bin/env bash
# Delete the local kind cluster created by scripts/kind-up.sh (all data in it is lost).
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-hostel-food}"

command -v kind >/dev/null 2>&1 || { echo "ERROR: 'kind' is not installed" >&2; exit 1; }

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  kind delete cluster --name "$CLUSTER_NAME"
else
  echo "No kind cluster named '$CLUSTER_NAME'; nothing to do."
fi

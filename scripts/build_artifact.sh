#!/usr/bin/env bash
# Build the release artifacts, the Python counterpart of `mvn clean package`:
#
#   dist/hostel_food_rating_api-<version>-py3-none-any.whl   installable wheel
#   dist/hostel_food_rating_api-<version>.tar.gz             source distribution
#   dist/hostel-food-api-<version>[-<suffix>].pyz            ONE executable file holding the app
#                                                            and every dependency (like a fat JAR)
#
# Run the .pyz with `python3 dist/hostel-food-api-<version>.pyz --port 8000`: it applies the
# database migrations (SQLite by default) and serves the API and the web app.
#
# Usage: bash scripts/build_artifact.sh
#   ARTIFACT_SUFFIX=b42-1a2b3c4   stamp the .pyz name (Jenkins uses build number + commit SHA)
#   PYTHON=python3.12             interpreter to build with (needs `build` and `shiv` installed)
#
# The .pyz bundles compiled dependencies for the OS that builds it. Build on Linux (Jenkins,
# GitHub Actions, or `make package`, which uses a python:3.12-slim container) to run on Linux.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PYTHON="${PYTHON:-python}"

echo "==> clean"
rm -rf dist build ./*.egg-info

echo "==> wheel + sdist (python -m build)"
"$PYTHON" -m build

version="$("$PYTHON" -c 'import tomllib; print(tomllib.load(open("pyproject.toml", "rb"))["project"]["version"])')"
pyz="dist/hostel-food-api-${version}${ARTIFACT_SUFFIX:+-$ARTIFACT_SUFFIX}.pyz"

echo "==> executable bundle (shiv) -> $pyz"
"$PYTHON" -m shiv --compressed --reproducible \
  --python "/usr/bin/env python3" \
  --entry-point app.cli:main \
  --output-file "$pyz" \
  dist/*.whl

echo "==> verify the bundle starts"
"$PYTHON" "$pyz" --help >/dev/null

echo "==> artifacts"
ls -l dist

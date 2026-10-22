# syntax=docker/dockerfile:1.7
# Multi-stage build: wheels are built in a throwaway stage, then only the virtualenv,
# the application code and the migration files are copied into a slim, non-root runtime.

ARG PYTHON_IMAGE=python:3.12.15-slim

# ---------------------------------------------------------------------------
# Stage 1: builder - resolve wheels and install them into an isolated venv
# ---------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build
COPY requirements.txt .

# Every dependency ships manylinux wheels, so no compiler is needed. `--no-compile` keeps
# .pyc files out of the image; pip/setuptools are removed from the venv afterwards because
# nothing installs packages at runtime.
RUN pip wheel --wheel-dir /wheels -r requirements.txt \
 && python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-index --find-links /wheels --no-compile -r requirements.txt \
 && /opt/venv/bin/pip uninstall -y pip setuptools \
 && find /opt/venv -type d -name "__pycache__" -prune -exec rm -rf {} +

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime

ARG VERSION=1.0.0
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="hostel-food-rating-api" \
      org.opencontainers.image.description="Hostel Food Rating API (FastAPI + PostgreSQL)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:${PATH}" \
    RUN_MIGRATIONS=true

# Pick up Debian security fixes published after the base image was built, then drop apt lists.
# The unprivileged user gets a fixed uid/gid so Kubernetes securityContext can match it.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
# Code stays root-owned and read-only for the runtime user.
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*", "--no-access-log", "--timeout-graceful-shutdown", "20"]

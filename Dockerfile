# syntax=docker/dockerfile:1.7
# Multi-stage build: wheels are built in a throwaway stage, the slim base is pruned and
# flattened into a single layer, then only the virtualenv, the application code and the
# migration files are added on top. The result runs as non-root.

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

# psycopg is built as its C extension against Debian's libpq instead of using psycopg[binary]:
# the binary wheel bundles its own libpq, OpenSSL and Kerberos (19 MB) that Debian security
# updates never reach, while the runtime libpq5 package costs about 4 MB. requirements.txt keeps
# psycopg[binary] so local installs and CI tests need no compiler; the swap happens only here.
# Native extensions ship with debug symbols (uvloop alone is 16 MB); `strip` roughly halves the
# size of those libraries. `--no-compile` keeps .pyc files out of the image; pip/setuptools are
# removed from the venv afterwards because nothing installs packages at runtime, and so are
# Cython sources (psycopg_c ships 7 MB of generated .c files) that only matter at compile time.
# Build tools are unpinned on purpose: they never reach the final image, and pinned Debian
# versions break as soon as the archive moves on.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends binutils gcc libc6-dev libpq-dev \
 && rm -rf /var/lib/apt/lists/*

RUN sed -i 's/^psycopg\[binary\]==/psycopg[c]==/' requirements.txt \
 && grep -q '^psycopg\[c\]==' requirements.txt \
 && pip wheel --wheel-dir /wheels -r requirements.txt \
 && python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-index --find-links /wheels --no-compile -r requirements.txt \
 && /opt/venv/bin/pip uninstall -y pip setuptools \
 && find /opt/venv -type d -name "__pycache__" -prune -exec rm -rf {} + \
 && find /opt/venv -type f \( -name "*.c" -o -name "*.pyx" -o -name "*.pxd" \) -delete \
 && find /opt/venv -name "*.so*" -type f -exec strip --strip-unneeded {} +

# ---------------------------------------------------------------------------
# Stage 2: system - patched, pruned base filesystem
# ---------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS system

# Pick up Debian security fixes published after the base image was built, add libpq for the
# psycopg C extension, then drop apt lists.
# The unprivileged user gets a fixed uid/gid so Kubernetes securityContext can match it.
# The interpreter's own pip, ensurepip, IDLE, tkinter, lib2to3 and pydoc data (about 11 MB) are
# never used by the API; deleting them only shrinks the image because the runtime stage copies
# this filesystem as one flattened layer.
# libpq5 is unpinned like the upgrade above: it tracks Debian security updates.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends libpq5 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin app \
 && stdlib="$(python -c 'import sysconfig; print(sysconfig.get_path("stdlib"))')" \
 && rm -rf "$stdlib"/site-packages/pip "$stdlib"/site-packages/pip-*.dist-info \
      "$stdlib"/ensurepip "$stdlib"/idlelib "$stdlib"/tkinter "$stdlib"/turtledemo \
      "$stdlib"/lib2to3 "$stdlib"/pydoc_data \
      /usr/local/bin/pip* /usr/local/bin/idle* /usr/local/bin/2to3* /usr/local/bin/pydoc*

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM scratch AS runtime

# Flatten: files deleted above (and the copies replaced by `apt-get upgrade`) would otherwise
# still ship in the base image's layers. Ownership and modes carry over from the stage.
# hadolint ignore=DL3067
COPY --from=system / /

ARG VERSION=1.0.0
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="hostel-food-rating-api" \
      org.opencontainers.image.description="Hostel Food Rating API (FastAPI + PostgreSQL)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

# FROM scratch inherits no environment, so PATH and LANG from the python base are restated.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin" \
    LANG=C.UTF-8 \
    RUN_MIGRATIONS=true \
    MALLOC_ARENA_MAX=2
# MALLOC_ARENA_MAX: argon2 allocates 19 MiB per hash on uvicorn's worker threads; glibc's default
# per-thread arenas keep that memory after each hash, so a login burst grew RSS until OOMKilled.

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

#!/bin/sh
# Container entrypoint: optionally run database migrations, then exec the main process
# (uvicorn by default) so it becomes PID 1 and receives SIGTERM for graceful shutdown.
#
# RUN_MIGRATIONS=true   run `alembic upgrade head` first (Docker Compose / VM deployments)
# RUN_MIGRATIONS=false  skip it (Kubernetes, where the `migrate` initContainer does it)
set -eu

log() {
    printf '{"level":"%s","logger":"entrypoint","message":"%s"}\n' "$1" "$2"
}

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    max_attempts="${MIGRATION_MAX_ATTEMPTS:-10}"
    delay="${MIGRATION_RETRY_DELAY:-3}"
    attempt=1
    log INFO "running database migrations (alembic upgrade head)"
    until alembic upgrade head; do
        if [ "$attempt" -ge "$max_attempts" ]; then
            log ERROR "migrations failed after ${attempt} attempts; giving up"
            exit 1
        fi
        log WARNING "migration attempt ${attempt}/${max_attempts} failed; retrying in ${delay}s"
        attempt=$((attempt + 1))
        sleep "$delay"
    done
    log INFO "migrations complete"
fi

exec "$@"

# Hostel Food Rating API

[![CI/CD](https://github.com/ramithnayak8/hostel-food-rating-api/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/ramithnayak8/hostel-food-rating-api/actions/workflows/ci-cd.yml)

Students rate every hostel meal (overall score, taste, hygiene, quantity and an optional comment); wardens publish menus and see what's working and what isn't. Daily and weekly stats show trends and the best- and worst-rated dishes. When a meal's average drops below 2.0 across at least 3 ratings, it is automatically flagged as a complaint.

**Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL 16, Pydantic v2, PyJWT, argon2id, slowapi, Prometheus and Grafana. The image is built with Docker and deployed by GitHub Actions to GHCR, then to Kubernetes (kind locally) or a single VM.

---

## Contents

- [Architecture](#architecture)
- [Quickstart (3 commands)](#quickstart-3-commands)
- [Configuration](#configuration)
- [API](#api)
- [Local development without Docker](#local-development-without-docker)
- [Makefile targets](#makefile-targets)
- [Testing](#testing)
- [Docker](#docker)
- [CI/CD pipeline](#cicd-pipeline)
- [Branch protection](#branch-protection)
- [Kubernetes on kind](#kubernetes-on-kind)
- [VM deployment](#vm-deployment)
- [Monitoring](#monitoring)
- [Load test and HPA demo](#load-test-and-hpa-demo)
- [Demo script](#demo-script)
- [Security notes](#security-notes)
- [Decisions](#decisions)
- [Troubleshooting](#troubleshooting)
- [Verification status](#verification-status)

---

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        S[Students / Wardens<br/>Swagger UI, curl, apps]
    end

    subgraph Cluster["Kubernetes (namespace hostel-food) or VM (docker compose)"]
        ING[Ingress nginx]
        subgraph API["API pods (2–6, HPA)"]
            A1[FastAPI + uvicorn<br/>:8000]
            A2[FastAPI + uvicorn<br/>:8000]
        end
        MIG[initContainer<br/>alembic upgrade head]
        PG[(PostgreSQL 16<br/>StatefulSet + PVC)]
    end

    subgraph Observability
        PROM[Prometheus<br/>scrapes /metrics]
        GRAF[Grafana<br/>provisioned dashboard]
    end

    subgraph Delivery
        GH[GitHub Actions<br/>lint · test · scan · build]
        GHCR[(ghcr.io image)]
    end

    S --> ING --> A1 & A2
    A1 & A2 --> PG
    MIG --> PG
    PROM -->|/metrics| A1 & A2
    GRAF --> PROM
    GH -->|push sha + latest| GHCR
    GHCR -->|kubectl set image / compose pull| API
```

Request flow: every request gets an `X-Request-ID` header (generated or propagated). The ID appears in every JSON log line and in every error body. Health probes (`/health`, `/health/ready`) and `/metrics` don't need authentication and aren't rate limited.

---

## Quickstart (3 commands)

Requirements: Docker with the Compose v2 plugin.

```bash
cp .env.example .env
docker compose up -d --build
# open http://localhost:8000/docs
```

Create an admin (warden) account. Students self-register through `POST /auth/register`.

```bash
docker compose exec api python -m scripts.create_admin \
  --email warden@hostel.example.com --password 'change-me-admin-password' --name "Hostel Warden"
```

To load optional demo data (7 days of meals and ratings) and run an end-to-end smoke test:

```bash
docker compose exec api python -m scripts.seed_demo_data
bash scripts/smoke_test.sh
```

To use the API from Swagger, call `POST /auth/login` with `{"email": "...", "password": "..."}` and copy the `access_token`. Then click **Authorize** and paste the token.

pgAdmin runs at http://localhost:5050. The credentials are the `PGADMIN_DEFAULT_*` values in `.env`.

---

## Configuration

All configuration comes from environment variables. `.env.example` lists every variable with a safe, commit-friendly value. Never commit `.env`.

| Variable | Default (app) | Description |
|---|---|---|
| `ENV` | `development` | `development`, `test`, `staging` or `production`. In `production` the app refuses to start without a strong `JWT_SECRET`. |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` or `CRITICAL`. Logs are JSON on stdout. |
| `DOCS_ENABLED` | `true` | `/docs`, `/redoc` and `/openapi.json` are hidden only when `ENV=production` **and** this is `false`. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated list of allowed origins, e.g. `http://localhost:3000,https://hostel.example.com`. |
| `MAX_REQUEST_BODY_BYTES` | `65536` | Larger request bodies are rejected with `413`. |
| `DATABASE_URL` | `sqlite:///./hostel_food.db` | SQLAlchemy URL. Use `postgresql+psycopg://user:pass@host:5432/db`. Bare `postgres://` URLs are accepted. **Required in production.** |
| `DB_POOL_SIZE` | `5` | SQLAlchemy connection pool size per process. |
| `DB_MAX_OVERFLOW` | `10` | Extra connections allowed above the pool size. |
| `DB_POOL_TIMEOUT` | `30` | Seconds to wait for a pooled connection. |
| `DB_POOL_RECYCLE` | `1800` | Recycle connections after this many seconds (`-1` disables recycling). |
| `JWT_SECRET` | dev-only placeholder | HMAC signing key for access tokens. **Required. Must be at least 32 characters when `ENV=production`.** |
| `JWT_ALGORITHM` | `HS256` | `HS256`, `HS384` or `HS512`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Token lifetime, from 1 to 1440 minutes. |
| `RATE_LIMIT_ENABLED` | `true` | Turns slowapi rate limiting on or off. |
| `RATE_LIMIT_AUTH` | `10/minute` | Per-IP limit on `/auth/register` and `/auth/login`. |
| `RATE_LIMIT_RATINGS` | `30/minute` | Per-IP limit on `POST /meals/{id}/ratings`. |
| `RATE_LIMIT_STORAGE_URI` | `memory://` | Rate-limit counter storage. Use `redis://host:6379` to share counters across replicas. |
| `FLAG_THRESHOLD` | `2.0` | A meal is flagged when its average score drops below this value… |
| `FLAG_MIN_RATINGS` | `3` | …and it has at least this many ratings. |
| `RUN_MIGRATIONS` | `true` | Read by the container entrypoint, not the app. Runs `alembic upgrade head` before starting. Set to `false` in Kubernetes, where the initContainer migrates. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | — | Read by `scripts/create_admin.py` and `scripts/smoke_test.sh` only. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | — | Read by the Postgres container. They must match `DATABASE_URL`. |
| `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` | — | pgAdmin login (`docker-compose.yml` only). |
| `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` | — | Grafana login (`monitoring` profile). |
| `IMAGE` | — | Image that `docker-compose.prod.yml` pulls, e.g. `ghcr.io/you/hostel-food-rating-api:latest`. |

---

## API

All request and response bodies are JSON. Errors always look like this:

```json
{ "error": { "code": "not_found", "message": "Meal not found", "request_id": "3f2c…" } }
```

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Liveness check. Returns `200 {"status":"ok","version":"1.0.0"}` without touching the database. |
| `GET` | `/health/ready` | — | Readiness check. Runs `SELECT 1` against the database and returns `503` if the database is unreachable. |
| `GET` | `/metrics` | — | Prometheus metrics. Not rate limited. |
| `POST` | `/auth/register` | — | Registers a student (`name`, `email`, `room_no`, `password` of 8+ characters). Returns `201`. The role is always `student`. |
| `POST` | `/auth/login` | — | JSON body `{email, password}`. Returns `{access_token, token_type: "bearer", expires_in}`. A wrong email and a wrong password get the same generic `401`. |
| `GET` | `/auth/me` | Bearer | Returns the current user. |
| `GET` | `/meals` | — | Lists meals. Filters: `date`, `meal_type`. Paginated with `limit` (capped) and `offset`. |
| `POST` | `/meals` | Admin | Creates a meal: `{date, meal_type, menu_items[]}`. Returns `201`, or `409` if that date and meal type already exist. |
| `GET` | `/meals/{id}` | — | Returns one meal, or `404`. |
| `PUT` | `/meals/{id}` | Admin | Replaces a meal completely. Returns `409` on a date and meal type clash. |
| `DELETE` | `/meals/{id}` | Admin | Deletes a meal and its ratings. Returns `204`. |
| `POST` | `/meals/{id}/ratings` | Bearer | Rates a meal: `{score, taste, hygiene, quantity}` from 1 to 5 plus an optional `comment` of up to 500 characters. Returns `201`, `409` if this user already rated the meal, `422` if a value is out of range, or `404`. |
| `GET` | `/meals/{id}/ratings` | Bearer | Lists a meal's ratings, paginated. Emails are never shown. The rater's name and room are shown to admins only. |
| `GET` | `/stats/daily?date=` | — | For each meal on the date: average score, taste, hygiene and quantity, plus the rating count. |
| `GET` | `/stats/weekly?end_date=` | — | 7-day trend per day, the best- and worst-rated dish, and the top and bottom meals. |
| `GET` | `/admin/flagged-meals` | Admin | Lists meals currently flagged as complaints. |
| `GET` | `/docs`, `/redoc`, `/openapi.json` | — | Interactive OpenAPI docs. |

Every response carries an `X-Request-ID` header. Send your own value in that header to trace a request through the logs.

---

## Local development without Docker

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

export DATABASE_URL=sqlite:///./hostel_food.db   # PowerShell: $env:DATABASE_URL="sqlite:///./hostel_food.db"
alembic upgrade head
python -m scripts.create_admin --email warden@hostel.example.com --password 'change-me-admin-password' --name "Hostel Warden"
uvicorn app.main:app --reload
```

To run against Postgres instead, start one with `docker compose up -d postgres` and set `DATABASE_URL=postgresql+psycopg://hostel:hostel-dev-password@localhost:5432/hostel_food`.

Install the git hooks with `pre-commit install`. They run ruff lint and format checks, plus basic file checks.

To add a migration after changing `app/models.py`:

```bash
alembic revision --autogenerate -m "describe change"   # or: make revision m="describe change"
alembic upgrade head
```

---

## Makefile targets

Run `make help` to list them all. Windows users can use Git Bash or WSL, or run the command each target wraps; they're all plain `python`, `docker` and `kubectl` invocations.

| Target | What it does |
|---|---|
| `install` | Creates `.venv` and installs `requirements-dev.txt`. |
| `lint` | `ruff check .` and `ruff format --check .` |
| `format` | `ruff format .` and `ruff check --fix .` |
| `test` | `pytest` |
| `cov` | `pytest --cov=app --cov-fail-under=85` with a terminal report and `coverage.xml`. |
| `run` | `uvicorn app.main:app --reload` |
| `migrate` | `alembic upgrade head` |
| `revision` | `alembic revision --autogenerate -m "$(m)"` |
| `seed` | Loads demo data. |
| `up` / `down` / `logs` | `docker compose up -d --build --wait` (creates `.env` from the example if missing), `down`, and `logs -f api`. |
| `build` | Builds `hostel-food-rating-api:local`. |
| `scan` | Runs `pip-audit` plus a Trivy image scan, if Trivy is installed. |
| `kind-up` / `kind-down` | Creates or destroys the local kind cluster and deploys into it. |
| `deploy-local` | Rebuilds the image, `kind load`s it, runs `kubectl apply -k k8s/overlays/local` and restarts the rollout. |
| `smoke` | Runs `scripts/smoke_test.sh` against `BASE_URL`. |
| `loadtest` | Runs Locust headless against `BASE_URL`. |
| `monitoring-up` | `docker compose --profile monitoring up -d` |
| `clean` | Removes caches, coverage files and the local SQLite database. |

---

## Testing

```bash
pytest                                        # SQLite in-memory: no services needed
pytest --cov=app --cov-fail-under=85          # coverage gate used in CI
DATABASE_URL=postgresql+psycopg://hostel:hostel-dev-password@localhost:5432/hostel_food pytest   # against real Postgres
```

- When `DATABASE_URL` isn't set in the environment, tests use an in-memory SQLite database. A local `.env` file doesn't affect this. The schema uses portable types (`JSON` with a `JSONB` variant on Postgres), and the database-level `CHECK`/`UNIQUE` constraints apply in both databases.
- CI always runs the suite against a `postgres:16` service container.
- The tests cover registration and login, JWT protection, admin-only enforcement, duplicate-rating `409`s, score-range `422`s, stats arithmetic, flagging logic, health and readiness checks, validation, error format and rate limiting.
- Coverage must stay at or above **85%**. This is enforced by `--cov-fail-under=85` and `[tool.coverage.report] fail_under`.

---

## Docker

- **Multi-stage `Dockerfile`:** the builder stage compiles wheels and installs them into a virtualenv. The final stage is `python:3.12-slim` with only that virtualenv and the app code, and no compilers.
- **Runs as a non-root user** with uid/gid `10001`. The app writes nothing to disk, so it works with a read-only root filesystem.
- **`HEALTHCHECK`** calls `http://127.0.0.1:8000/health` with Python's `urllib`, so curl isn't needed in the image.
- **`entrypoint.sh`** runs `alembic upgrade head` when `RUN_MIGRATIONS=true`, then `exec`s uvicorn so `SIGTERM` reaches the server and shutdown is graceful.
- **Size:** 54 MiB compressed (what GHCR stores and pulls). Uncompressed, the layers total about 191 MB: 134 MB is the `python:3.12-slim` base itself and 57 MB is the virtualenv, whose native extensions are `strip`ped in the builder stage. Because the base alone is close to 150 MB, the 150 MB target is met for the compressed (registry) size, not the unpacked size. `docker images` shows about 249 MB under Docker's containerd image store, which counts stored blobs as well.
- **Memory:** the image sets `MALLOC_ARENA_MAX=2`. Without it, argon2's 19 MiB per-hash allocations spread across uvicorn's worker threads, and a login burst OOM-killed 192Mi pods during load testing.

```bash
docker build -t hostel-food-rating-api:local .
docker run --rm -p 8000:8000 -e DATABASE_URL=sqlite:////tmp/app.db -e RUN_MIGRATIONS=true hostel-food-rating-api:local
docker inspect --format '{{.State.Health.Status}}' <container-id>    # -> healthy
```

Compose files:

| File | Services |
|---|---|
| `docker-compose.yml` | `api` (built locally), `postgres:16` (healthcheck and named volume) and `pgadmin`. The `monitoring` profile adds `prometheus` and `grafana`. |
| `docker-compose.prod.yml` | `api` (pulled from GHCR via `${IMAGE}`) and `postgres`, with `restart: unless-stopped`, resource limits and log rotation. |

---

## CI/CD pipeline

`.github/workflows/ci-cd.yml` runs on pull requests and on pushes to `main`:

| Job | What it does |
|---|---|
| **Lint** | `ruff check .` and `ruff format --check .` |
| **Test** | Migration round-trip (`alembic upgrade head` / `downgrade base`), then `pytest --cov=app --cov-fail-under=85` against a `postgres:16` service container; uploads `coverage.xml` as an artifact. |
| **Security scan** | `pip-audit` on the pinned requirements, plus a Trivy filesystem scan. |
| **Validate manifests** | Renders the kustomize overlay and checks it with kubeconform, runs `promtool` on the Prometheus config and alert rules, and parses both Compose files. |
| **Build & scan image** | Docker Buildx with the GitHub Actions cache. Trivy scans the image and **fails on fixable HIGH or CRITICAL vulnerabilities**. On `main` only, pushes `ghcr.io/<owner>/hostel-food-rating-api` tagged with the git SHA and `latest`, with OCI labels. Authenticates with the built-in `GITHUB_TOKEN`. |
| **Deploy** | Runs on `main` only, in the `production` environment. Picks a strategy from the repository variable `DEPLOY_STRATEGY` (see below), then runs a smoke test against `/health`. |

The workflow uses concurrency groups to cancel superseded runs, least-privilege `permissions:` per job, and pinned action major versions. Dependabot (`.github/dependabot.yml`) updates pip, Docker and GitHub Actions dependencies weekly.

**Deployment configuration** (*Settings → Secrets and variables → Actions*):

| Kind | Name | Used by |
|---|---|---|
| Variable | `DEPLOY_STRATEGY` | `k8s` (default) or `vm`. If the chosen strategy's secrets are missing, the deploy job logs a notice and skips. |
| Secret | `KUBECONFIG` | `k8s` strategy. A kubeconfig for the target cluster, raw or base64. The job runs `kubectl set image deployment/hostel-food-api api=<image>:<sha> migrate=<image>:<sha> -n hostel-food` and waits for `rollout status`. |
| Secrets | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` | `vm` strategy. The job connects over SSH and runs `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`. |
| Variable | `PUBLIC_BASE_URL` | Post-deploy smoke test, e.g. `https://hostel.example.com`. The test is skipped if this is unset. |

Each deploy step is guarded, so a missing secret skips the step instead of failing the pipeline.

---

## Branch protection

In *Settings → Branches → Add branch ruleset* (or a classic rule) for `main`, enable:

1. **Require a pull request before merging**
   - Required approvals: **1**
   - **Dismiss stale pull request approvals when new commits are pushed**
2. **Require status checks to pass before merging**: `Lint`, `Test`, `Security scan`, `Validate manifests`, `Build & scan image`
   - **Require branches to be up to date before merging**
3. **Require conversation resolution before merging**
4. **Require linear history**
5. **Block force pushes**
6. **Restrict deletions**
7. **Do not allow bypassing the above settings** (classic: *Include administrators*)

> A status check only appears in the picker after it has run once, so push a PR first.

---

## Kubernetes on kind

Prerequisites: Docker, [kind](https://kind.sigs.k8s.io/) and `kubectl`.

```bash
bash scripts/kind-up.sh      # or: make kind-up
```

The script:

1. Creates a kind cluster with host ports **8080 → 80** and **8443 → 443** mapped for ingress.
2. Installs ingress-nginx and metrics-server (patched with `--kubelet-insecure-tls` for kind).
3. Builds `hostel-food-rating-api:local` and loads it with `kind load docker-image`.
4. Runs `kubectl apply -k k8s/overlays/local`.

The API is then at **http://hostel-food.localtest.me:8080**. `localtest.me` resolves to 127.0.0.1, so no hosts-file edits are needed.

```bash
curl http://hostel-food.localtest.me:8080/health
kubectl -n hostel-food get pods,svc,ingress,hpa
kubectl -n hostel-food exec deploy/hostel-food-api -c api -- python -m scripts.create_admin \
  --email warden@hostel.example.com --password 'change-me-admin-password' --name "Hostel Warden"
bash scripts/kind-down.sh    # or: make kind-down
```

Manifest layout (`k8s/base` plus `k8s/overlays/local`, managed by kustomize):

- **Namespace and config:** the `hostel-food` namespace, a ConfigMap, and a Secret template. `secret.example.yaml` shows the shape; never commit real secrets.
- **API `Deployment`:**
  - 2 replicas, rolled out with `RollingUpdate` and `maxUnavailable: 0`.
  - An initContainer named `migrate` runs `alembic upgrade head`.
  - Probes: liveness on `/health`, readiness on `/health/ready`, plus a startup probe.
  - Security context: `runAsNonRoot`, `readOnlyRootFilesystem`, all capabilities dropped.
  - Resource requests and limits, plus topology spread.
- **Supporting objects:** a Service, an nginx Ingress, an HPA (CPU 60%, 2–6 replicas) and a PodDisruptionBudget.
- **PostgreSQL:** a StatefulSet with a headless Service and a PVC.
- **NetworkPolicies:** deny by default, then allow ingress-nginx → API and API → Postgres.

---

## VM deployment

This is the alternative to Kubernetes: a single Linux VM with Docker.

```bash
# on the VM, once
git clone https://github.com/ramithnayak8/hostel-food-rating-api.git && cd hostel-food-rating-api
cp .env.example .env    # then edit: ENV=production, strong JWT_SECRET, DB password, IMAGE=ghcr.io/ramithnayak8/hostel-food-rating-api:latest
echo "$GHCR_TOKEN" | docker login ghcr.io -u ramithnayak8 --password-stdin   # only if the package is private

# every deploy (CI does this over SSH when DEPLOY_STRATEGY=vm)
bash scripts/deploy_vm.sh
```

`scripts/deploy_vm.sh` runs `docker compose -f docker-compose.prod.yml pull && up -d` and waits for `/health`. Put a TLS-terminating reverse proxy, such as Caddy, nginx or a cloud load balancer, in front of port 8000.

---

## Monitoring

```bash
docker compose --profile monitoring up -d    # or: make monitoring-up
```

- **Prometheus** runs at http://localhost:9090. It scrapes `api:8000/metrics` every 15 seconds, and its rules are in `monitoring/alerts.yml`.
- **Grafana** runs at http://localhost:3000. The login is `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`. The datasource and the **Hostel Food Rating API** dashboard are provisioned automatically.

The dashboard has these panels:

- request rate by handler
- p50/p95/p99 latency
- error-rate %
- requests by status code
- ratings submitted per meal type
- flagged meals
- in-flight requests
- DB readiness
- app version

Metrics exposed by the API:

| Metric | Type | Notes |
|---|---|---|
| `http_requests_total{handler,method,status}` | counter | From prometheus-fastapi-instrumentator. Exact status codes; `/metrics` and `/health*` are excluded. |
| `http_request_duration_highr_seconds_bucket` | histogram | Fine-grained buckets, used for the latency quantiles. |
| `http_request_duration_seconds_bucket{handler,method}` | histogram | Coarse buckets, per handler. |
| `http_requests_inprogress{handler,method}` | gauge | In-flight requests. |
| `ratings_submitted_total{meal_type}` | counter | Successful rating submissions. |
| `meals_flagged_total{meal_type}` | counter | Counts each time a meal becomes flagged. |
| `flagged_meals` | gauge | Current number of flagged meals, read from the database at scrape time. Every replica reports the same value, so query it with `max()`. |
| `database_up` | gauge | 1 if `SELECT 1` succeeds at scrape time, otherwise 0. |
| `app_info{version,env}` | gauge | Always 1. Used to show the running version. |

The alert rules are:

| Alert | Fires when |
|---|---|
| `InstanceDown` | `up == 0` for 1 minute |
| `DatabaseDown` | `database_up == 0` for 2 minutes |
| `HighErrorRate` | 5xx responses exceed 5% for 5 minutes |
| `HighLatencyP95` | p95 latency exceeds 1 second for 5 minutes |
| `FlaggedMealsPresent` | `flagged_meals > 0` for 1 minute |
| `PodRestarting` | More than 3 restarts in 15 minutes. Only fires if kube-state-metrics is scraped. |

On Kubernetes, the API pods carry `prometheus.io/scrape|port|path` annotations. `monitoring/k8s-scrape-example.yml` is a ready-made scrape job for an in-cluster Prometheus.

---

## Load test and HPA demo

```bash
pip install -r requirements-loadtest.txt
make loadtest BASE_URL=http://hostel-food.localtest.me:8080   # Locust headless; defaults: 50 users, 2 min
# or interactively:
locust -f scripts/loadtest.py --host http://hostel-food.localtest.me:8080   # UI on http://localhost:8089
```

To watch the autoscaler react, open a second terminal:

```bash
kubectl -n hostel-food get hpa -w          # CPU climbs past 60% → replicas 2 → up to 6
kubectl -n hostel-food get pods -w
kubectl top pods -n hostel-food            # needs metrics-server (installed by kind-up.sh)
```

When the load stops, the HPA scales back to 2 replicas after its stabilization window, which is about 5 minutes by default. Locust users browse meals and stats and submit ratings. The auth endpoints are rate limited, so each simulated user logs in once.

---

## Demo script

[`docs/DEMO.md`](docs/DEMO.md) has the full commands and a screenshot checklist. In summary:

1. **Push a change.** Bump `__version__` in `app/__init__.py`, then commit and push or open a PR.
2. **CI runs.** Lint, Test (Postgres) and Security scan go green in the Actions tab.
3. **The image is built.** Trivy scans it, and on `main` it's pushed to GHCR as `:sha` and `:latest`.
4. **Kubernetes rolls out.** The deploy job runs `kubectl set image` and `rollout status`; locally, run `kubectl rollout status` after `make kind-up`.
5. **Grafana moves.** The *App version* panel shows the new version, and request-rate and latency panels react to the load test.

---

## Security notes

- **Passwords:** hashed with **argon2id** (`argon2-cffi`, OWASP parameters: 19 MiB, 2 passes, at most 4 hashes in parallel so login bursts can't exhaust pod memory) and rehashed on login when the parameters change. They must be at least 8 characters.
- **Login:** a wrong email and a wrong password take the same time to check and get the same generic `401 Invalid credentials`. Emails are trimmed and lowercased before they're stored or looked up.
- **Tokens:** HS256 JWTs with `exp` and `iat` claims. The secret comes from the environment only, and the app refuses to start in production with a missing, default or short secret.
- **Roles:** students can't make themselves admins. Request bodies forbid unknown fields, so sending `role` gives a `422`. Admins are created only with `scripts/create_admin.py`.
- **Rate limits:** slowapi limits auth and rating endpoints per client IP. uvicorn runs with `--proxy-headers`, so the real client IP is used behind an ingress.
- **Security headers:** every response sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. CORS origins come from `CORS_ORIGINS`.
- **Request size:** bodies over `MAX_REQUEST_BODY_BYTES` are rejected with `413`.
- **Error responses:** never include stack traces. Unhandled errors return `500 {"error": {"code": "internal_error", …}}` and are logged with the request ID.
- **Containers:** run as non-root with a read-only root filesystem and all capabilities dropped. Network policies deny traffic by default.
- **Secrets:** none are committed. `.env`, kubeconfigs and real k8s secrets are git-ignored. CI uses the built-in `GITHUB_TOKEN` for GHCR, and Trivy and pip-audit gate every build.

---

## Decisions

These choices were made where the brief left room:

| Topic | Decision |
|---|---|
| Primary keys | Integer, for simplicity and readable URLs. |
| Login body | JSON `{email, password}` instead of an OAuth2 password form. Swagger therefore uses an **HTTP Bearer** *Authorize* box: paste the token returned by `/auth/login`. |
| Password hashing | argon2id through `argon2-cffi`. passlib isn't used. |
| `menu_items` storage | `JSON`, with a `JSONB` variant on PostgreSQL. This keeps the SQLite test fallback working. |
| Visibility | Meals and stats are public and read-only. Listing a meal's ratings requires a login, and only admins see who rated. |
| Complaint flag | Recomputed after every rating: `flagged = count >= FLAG_MIN_RATINGS and avg(score) < FLAG_THRESHOLD`. The flag **clears automatically** if the average recovers. `meals_flagged_total` counts transitions into the flagged state. |
| Best and worst dish (weekly) | For the 7-day window ending `end_date`, today by default, each rating's `score` counts toward every menu item of the rated meal. A dish's average is the mean of those scores. Names are merged case-insensitively. Ties go to the dish with more ratings. |
| Top and bottom meals | Meals with at least one rating in the window, ranked by average score. |
| Rate limiting | Per client IP, with in-memory counters by default, so each replica counts separately. Set `RATE_LIMIT_STORAGE_URI=redis://…` for accurate limits across replicas. |
| Request validation | Request bodies use `extra="forbid"`, so a `role` field in `/auth/register` returns `422`. |
| `PUT /meals/{id}` | Full replacement, not a partial update. |
| Migrations | Never auto-created by the app. Alembic runs from the container entrypoint (Compose) or an initContainer (Kubernetes). `alembic/env.py` takes a **Postgres advisory lock**, so replicas migrating at the same moment are safe. |
| Load testing | Locust lives in a separate `requirements-loadtest.txt` so the dev install stays light. |
| Server | Plain uvicorn, no gunicorn. Scale by adding replicas through the HPA. |
| Cluster scraping | No ServiceMonitor. Prometheus scrape annotations are used instead, so the Prometheus Operator isn't required. |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` (8000, 5432, 5050, 3000, 9090) | Stop whatever holds the port, or change the host side of the mapping in `docker-compose.yml`. |
| `entrypoint.sh: not found` or `/bin/sh^M` errors after cloning on Windows | The scripts got CRLF line endings. `.gitattributes` forces LF; re-checkout with `git rm --cached -r . && git reset --hard`, or run `dos2unix entrypoint.sh scripts/*.sh`. |
| `/health/ready` returns `503` | The API can't reach Postgres. Check `docker compose ps` and `docker compose logs postgres`, and that `DATABASE_URL` matches the `POSTGRES_*` values. |
| The app exits with `JWT_SECRET must be set ... when ENV=production` | Set `JWT_SECRET` to a random string of at least 32 characters: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. |
| kind: `curl hostel-food.localtest.me:8080` hangs or returns 404 | Ingress-nginx may still be starting. Run `kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s`, then check `kubectl -n hostel-food get ingress`. |
| kind: pods stuck in `ErrImagePull` | The image wasn't loaded into the cluster. Run `kind load docker-image hostel-food-rating-api:local --name hostel-food`. |
| kind: HPA shows `<unknown>` CPU | metrics-server isn't ready yet. Wait a minute and check `kubectl -n kube-system get deploy metrics-server`. |
| `429 Too Many Requests` during demos or load tests | Raise `RATE_LIMIT_AUTH` or `RATE_LIMIT_RATINGS`, or set `RATE_LIMIT_ENABLED=false` for the test. |
| Grafana dashboard is empty | Check that Prometheus has the target `UP` at http://localhost:9090/targets and that the API has received some traffic. |

---

## Verification status

Everything below was run on the development machine (Windows 11, Docker Desktop 29.9, kind 0.33, kubectl 1.36):

| Check | Result |
|---|---|
| `ruff check .` and `ruff format --check .` | clean |
| `pytest --cov=app --cov-fail-under=85` on the SQLite fallback | **88 passed, 98.3% coverage** |
| The same suite on real PostgreSQL 16 | **88 passed, 97.9% coverage** |
| Alembic `upgrade head` → `check` → `downgrade base` → `upgrade head`, on SQLite and on PostgreSQL | no drift; round-trip clean |
| `docker build` | 54 MiB compressed (about 191 MB unpacked; see [Docker](#docker)) |
| `docker run` with no database | runs as `uid=10001(app)`; HEALTHCHECK turns **healthy** |
| `cp .env.example .env && docker compose up -d --build --wait`, then `bash scripts/smoke_test.sh` | all services healthy, migrations ran in the entrypoint; **PASS: 34 checks** |
| `docker compose --profile monitoring up` | Prometheus target `up`; 6 alert rules loaded (`FlaggedMealsPresent` pending on the seeded flagged meal); Grafana datasource OK; all 16 panel queries return data |
| `bash scripts/kind-up.sh`, then the smoke test through ingress-nginx at `hostel-food.localtest.me:8080` | **PASS: 34 checks** |
| NetworkPolicies on kind | a pod outside the namespace is blocked from Postgres and the API; API → Postgres is allowed |
| `make loadtest`: Locust, 60 users for 3 min, against kind | HPA scaled **2 → 4 → 6**; 0 pod restarts; 0.9% failures (ingress 503s in the first minute while 2 pods were saturated, before scale-out); memory peaked at 188 MiB out of 256 MiB |
| `kubectl apply --dry-run=client` and `--dry-run=server` on the overlay | 15/15 resources accepted |
| kubeconform, actionlint, check-jsonschema (workflow, dependabot, compose), promtool, hadolint, yamllint, shellcheck | clean |
| `pip-audit -r requirements.txt` | no known vulnerabilities |
| Trivy image scan (`--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`) | exit 0 |

Fixes made because of these runs:

- Startup-probe budget: kind pods were killed while still importing under CPU throttling.
- `MALLOC_ARENA_MAX=2`: pods were OOM-killed during login bursts.
- Smoke test: it now retries the per-pod `/metrics` counter behind the load balancer.
- Error-rate panels: they now show 0% instead of "No data" when there are no 5xx responses.
- Uvicorn's duplicate access log is silenced.

**Not run here:** the GitHub Actions pipeline itself (it needs the repo pushed) and the `deploy` job (it needs `KUBECONFIG` or SSH secrets).

---

## License

[MIT](LICENSE)

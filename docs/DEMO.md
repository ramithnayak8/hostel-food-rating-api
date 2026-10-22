# Demo: push a change → CI → image → Kubernetes rollout → Grafana moves

This walkthrough takes about 15 minutes. It shows the whole delivery loop working on a real change: bumping the version number.

## 0. One-time setup (before the audience arrives)

```bash
# GitHub: repo created and pushed (see README "Branch protection"); Actions enabled.
# Optional: for a real cluster deploy, set repo variable DEPLOY_STRATEGY=k8s and secret KUBECONFIG.

# Local cluster + app + monitoring
cp .env.example .env
bash scripts/kind-up.sh                                   # kind cluster, ingress, metrics-server, app
curl -s http://hostel-food.localtest.me:8080/health       # {"status":"ok","version":"1.0.0"}

kubectl -n hostel-food exec deploy/hostel-food-api -c api -- \
  python -m scripts.create_admin --email warden@hostel.example.com \
  --password 'change-me-admin-password' --name "Hostel Warden"
kubectl -n hostel-food exec deploy/hostel-food-api -c api -- python -m scripts.seed_demo_data

# Grafana and Prometheus (compose profile). Point Prometheus at the cluster, or demo against compose:
docker compose --profile monitoring up -d --build         # API :8000, Grafana :3000, Prometheus :9090
docker compose exec api python -m scripts.seed_demo_data
```

> **Which API does Grafana watch?** The compose Prometheus scrapes the compose `api` service. To graph the kind deployment instead, run Prometheus in the cluster with `monitoring/k8s-scrape-example.yml`. For a laptop demo, the simplest option is to run the load test against compose (`BASE_URL=http://localhost:8000`) and show the rollout on kind.

Open these tabs:

- Swagger at http://localhost:8000/docs
- GitHub → Actions
- Grafana at http://localhost:3000, dashboard *Hostel Food / Hostel Food Rating API*
- A terminal running `kubectl -n hostel-food get pods -w`

## 1. Push a change

```bash
git checkout -b demo/bump-version
# app/__init__.py: __version__ = "1.0.0"  ->  "1.1.0"
sed -i 's/__version__ = "1.0.0"/__version__ = "1.1.0"/' app/__init__.py
git commit -am "chore: bump version to 1.1.0"
git push -u origin demo/bump-version
gh pr create --fill          # or open the PR in the browser
```

## 2. CI runs

```bash
gh run watch                 # or watch the Actions tab
```

On the PR, **Lint**, **Test** (pytest against a `postgres:16` service, coverage ≥ 85%), **Security scan** (pip-audit and Trivy fs) and **Build & scan image** (built and Trivy-scanned, but not pushed) all go green. Branch protection blocks the merge until they do.

## 3. The image is built and pushed

```bash
gh pr merge --squash --delete-branch
gh run watch                 # the run on main
```

On `main`, **Build & scan image** pushes `ghcr.io/<owner>/hostel-food-rating-api:<sha>` and `:latest`. Show the package on the repo's *Packages* sidebar.

## 4. Kubernetes rolls out

**With `DEPLOY_STRATEGY=k8s` and `KUBECONFIG` set**, the **Deploy** job runs `kubectl set image … api=…:<sha> migrate=…:<sha>` followed by `kubectl rollout status`, then smoke-tests `/health`.

**On local kind**, do the same by hand with a locally built image:

```bash
git checkout main && git pull
docker build -t hostel-food-rating-api:1.1.0 .
kind load docker-image hostel-food-rating-api:1.1.0 --name hostel-food
kubectl -n hostel-food set image deployment/hostel-food-api \
  api=hostel-food-rating-api:1.1.0 migrate=hostel-food-rating-api:1.1.0
kubectl -n hostel-food rollout status deployment/hostel-food-api
curl -s http://hostel-food.localtest.me:8080/health       # {"status":"ok","version":"1.1.0"}
```

The `get pods -w` terminal shows new pods starting (init `migrate`, then `api` turning Ready) **before** old ones terminate. That's `maxUnavailable: 0`, so there's no downtime.

## 5. Grafana moves

```bash
docker compose up -d --build api                          # compose API now reports 1.1.0 too
pip install -r requirements-loadtest.txt
make loadtest BASE_URL=http://localhost:8000              # or: locust -f scripts/loadtest.py --host http://localhost:8000
```

On the dashboard:

- **App version** changes to `v1.1.0 (development)`.
- **Request rate by handler** and **Latency p50/p95/p99** climb while Locust runs.
- **Ratings submitted per meal type** shows the rating traffic.
- **Flagged meals** goes up if you post three 1-star ratings to a meal (see the bonus below).

To show the HPA, run the load test against kind and watch it scale:

```bash
make loadtest BASE_URL=http://hostel-food.localtest.me:8080 &
kubectl -n hostel-food get hpa -w                         # replicas 2 → up to 6 as CPU passes 60%
```

### Bonus: trigger the complaint flag live

```bash
BASE=http://localhost:8000
ADMIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"warden@hostel.example.com","password":"change-me-admin-password"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
MEAL=$(curl -s -X POST $BASE/meals -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"date\":\"$(date +%F)\",\"meal_type\":\"snacks\",\"menu_items\":[\"Soggy Samosa\"]}" | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')
for i in 1 2 3; do
  curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
    -d "{\"name\":\"Student $i\",\"email\":\"demo$i@hostel.example.com\",\"room_no\":\"A-10$i\",\"password\":\"student-pass-$i\"}" >/dev/null
  TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"demo$i@hostel.example.com\",\"password\":\"student-pass-$i\"}" | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
  curl -s -X POST $BASE/meals/$MEAL/ratings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"score":1,"taste":1,"hygiene":2,"quantity":1,"comment":"cold"}' >/dev/null
done
curl -s $BASE/admin/flagged-meals -H "Authorization: Bearer $ADMIN"
```

Within about 1 minute, Grafana's **Flagged meals** panel turns red and Prometheus shows the `FlaggedMealsPresent` alert firing at http://localhost:9090/alerts.

If the auth rate limit (`RATE_LIMIT_AUTH`, 10 per minute per IP) trips during repeated rehearsals, wait a minute or raise it in `.env`.

---

## Screenshot checklist

**Swagger (http://localhost:8000/docs)**

- [ ] Overview of all tag groups: auth, meals, ratings, stats, admin, health
- [ ] The *Authorize* dialog (HTTP Bearer) with a token pasted
- [ ] `POST /meals/{id}/ratings` returning `201`, then a second attempt returning `409` with the `{"error": {...}}` body
- [ ] `POST /meals/{id}/ratings` with `score: 6` returning `422`
- [ ] `GET /stats/weekly` response showing `best_dish`, `worst_dish` and the 7-day trend
- [ ] Response headers showing `X-Request-ID` and the security headers

**Pipeline (GitHub Actions)**

- [ ] PR checks: Lint, Test, Security scan and Build & scan image, all green
- [ ] Workflow graph on `main` with lint → test → security → build → deploy
- [ ] Test job log tail showing the coverage total ≥ 85%
- [ ] Trivy image scan step showing no fixable HIGH or CRITICAL findings
- [ ] GHCR package page with the `sha` and `latest` tags
- [ ] Deploy job showing `rollout status … successfully rolled out` and the smoke test passing
- [ ] Branch protection settings page

**Kubernetes**

- [ ] `kubectl -n hostel-food get pods -w` mid-rollout, with new pods Ready before old ones terminate
- [ ] `kubectl -n hostel-food get hpa` scaled above 2 replicas during the load test

**Grafana (http://localhost:3000)**

- [ ] The full dashboard during a load test: request rate, p50/p95/p99, error %, in-flight requests
- [ ] The *App version* stat before (1.0.0) and after (1.1.0)
- [ ] The *Flagged meals* stat in red, with the `FlaggedMealsPresent` alert on the Prometheus alerts page
- [ ] The *Database* stat showing Up, and Down after `docker compose stop postgres` (start it again afterwards)

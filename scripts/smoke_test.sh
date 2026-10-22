#!/usr/bin/env bash
# End-to-end smoke test against a running API.
#
#   bash scripts/smoke_test.sh                       # full flow against docker compose
#   SMOKE_MODE=health BASE_URL=https://api.example.com bash scripts/smoke_test.sh   # probes only
#
# Env:
#   BASE_URL          default http://localhost:8000
#   SMOKE_MODE        full (default) | health
#   ADMIN_EMAIL       default warden@hostel.example.com
#   ADMIN_PASSWORD    default change-me-admin-password
#   CREATE_ADMIN_CMD  how to run scripts/create_admin.py; default uses docker compose.
#                     Set SKIP_CREATE_ADMIN=true if the admin already exists.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
BASE_URL="${BASE_URL%/}"
SMOKE_MODE="${SMOKE_MODE:-full}"
ADMIN_EMAIL="${ADMIN_EMAIL:-warden@hostel.example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-admin-password}"
CREATE_ADMIN_CMD="${CREATE_ADMIN_CMD:-docker compose exec -T api python -m scripts.create_admin}"
SKIP_CREATE_ADMIN="${SKIP_CREATE_ADMIN:-false}"

if python3 -c "" >/dev/null 2>&1; then PY=python3; else PY=python; fi
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

STATUS=""
BODY=""
PASSED=0

# request METHOD PATH [JSON_BODY] [TOKEN]  -> sets STATUS and BODY
request() {
  local method="$1" path="$2" data="${3:-}" token="${4:-}"
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$BASE_URL$path"
    -H 'Accept: application/json' --max-time 15)
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data "$data")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  STATUS="$(curl "${args[@]}")" || STATUS="000"
  BODY="$(cat "$BODY_FILE")"
}

# json EXPR -> evaluates a python expression against the parsed BODY, bound to `d`
json() {
  printf '%s' "$BODY" | "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)"
}

fail() {
  echo "FAIL: $1" >&2
  echo "  status: $STATUS" >&2
  echo "  body:   ${BODY:0:500}" >&2
  exit 1
}

expect() {  # expect STATUS_CODE DESCRIPTION
  [[ "$STATUS" == "$1" ]] || fail "$2 (expected HTTP $1)"
  PASSED=$((PASSED + 1))
  echo "ok   $2 -> $STATUS"
}

check() {  # check PYTHON_BOOL_EXPR DESCRIPTION
  [[ "$(json "$1")" == "True" ]] || fail "$2"
  PASSED=$((PASSED + 1))
  echo "ok   $2"
}

echo "Smoke testing $BASE_URL (mode: $SMOKE_MODE)"

# --- Probes (both modes) -----------------------------------------------------------------------
for attempt in $(seq 1 30); do
  request GET /health
  [[ "$STATUS" == "200" ]] && break
  echo "waiting for API ($attempt/30)..."
  sleep 2
done
expect 200 "GET /health"
check 'd["status"] == "ok"' "liveness reports ok (version $(json 'd["version"]'))"

request GET /health/ready
expect 200 "GET /health/ready"
check 'd["database"] == "up"' "database is reachable"

request GET /metrics
expect 200 "GET /metrics"
grep -q '^database_up 1.0' "$BODY_FILE" || fail "metrics report database_up 1"
grep -q '^app_info{' "$BODY_FILE" || fail "metrics include app_info"
PASSED=$((PASSED + 2))
echo "ok   metrics expose database_up and app_info"

if [[ "$SMOKE_MODE" == "health" ]]; then
  echo "PASS: $PASSED checks (health mode)"
  exit 0
fi

# --- Full flow ---------------------------------------------------------------------------------
if [[ "$SKIP_CREATE_ADMIN" != "true" ]]; then
  # shellcheck disable=SC2086  # CREATE_ADMIN_CMD is intentionally word-split
  $CREATE_ADMIN_CMD --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" --name "Smoke Admin"
fi

RUN_ID="$(date +%s)-$RANDOM"
STUDENT_EMAIL="smoke-$RUN_ID@hostel.example.com"
STUDENT_PASSWORD="smoke-password-123"
# A unique far-future date keeps reruns from colliding on UNIQUE(date, meal_type).
MEAL_DATE="$("$PY" -c "import datetime,random; print(datetime.date(2100,1,1)+datetime.timedelta(days=random.randint(0,30000)))")"

request POST /auth/register "{\"name\":\"Smoke Student\",\"email\":\"$STUDENT_EMAIL\",\"room_no\":\"S-1\",\"password\":\"$STUDENT_PASSWORD\"}"
expect 201 "register student"
check 'd["role"] == "student"' "new account is a student"

request POST /auth/register "{\"name\":\"Sneaky\",\"email\":\"x-$STUDENT_EMAIL\",\"room_no\":\"S-1\",\"password\":\"$STUDENT_PASSWORD\",\"role\":\"admin\"}"
expect 422 "self-assigning admin role is rejected"

request POST /auth/login "{\"email\":\"$STUDENT_EMAIL\",\"password\":\"$STUDENT_PASSWORD\"}"
expect 200 "student login"
STUDENT_TOKEN="$(json 'd["access_token"]')"

request POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"wrong-password\"}"
expect 401 "wrong password is rejected"

request POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
expect 200 "admin login"
ADMIN_TOKEN="$(json 'd["access_token"]')"

request GET /auth/me "" "$STUDENT_TOKEN"
expect 200 "GET /auth/me"
check "d['email'] == '$STUDENT_EMAIL'" "token identifies the student"

MEAL_JSON="{\"date\":\"$MEAL_DATE\",\"meal_type\":\"lunch\",\"menu_items\":[\"Dal\",\"Rice\",\"Roti\"]}"
request POST /meals "$MEAL_JSON" "$STUDENT_TOKEN"
expect 403 "student cannot create meals"

request POST /meals "$MEAL_JSON" "$ADMIN_TOKEN"
expect 201 "admin creates meal for $MEAL_DATE"
MEAL_ID="$(json 'd["id"]')"

request GET "/meals?date=$MEAL_DATE"
expect 200 "list meals by date"
check 'd["total"] == 1' "meal is listed"

request POST "/meals/$MEAL_ID/ratings" '{"score":4,"taste":5,"hygiene":4,"quantity":3,"comment":"smoke test"}' "$STUDENT_TOKEN"
expect 201 "student rates meal"

request POST "/meals/$MEAL_ID/ratings" '{"score":4,"taste":5,"hygiene":4,"quantity":3}' "$STUDENT_TOKEN"
expect 409 "duplicate rating is rejected"

request POST "/meals/$MEAL_ID/ratings" '{"score":6,"taste":5,"hygiene":4,"quantity":3}' "$STUDENT_TOKEN"
expect 422 "out-of-range score is rejected"
check 'd["error"]["code"] == "validation_error"' "errors use the standard envelope"

request GET "/meals/$MEAL_ID/ratings" "" "$ADMIN_TOKEN"
expect 200 "admin lists ratings"
check 'd["items"][0]["rated_by"]["name"] == "Smoke Student"' "admin sees rater name"

request GET "/stats/daily?date=$MEAL_DATE"
expect 200 "daily stats"
check 'd["meals"][0]["rating_count"] == 1 and d["meals"][0]["avg_score"] == 4.0 and d["meals"][0]["avg_taste"] == 5.0' "daily averages are correct"

request GET "/stats/weekly?end_date=$MEAL_DATE"
expect 200 "weekly stats"
check 'len(d["days"]) == 7 and d["best_dish"]["avg_score"] == 4.0' "weekly trend has 7 days and a best dish"

request GET /admin/flagged-meals "" "$STUDENT_TOKEN"
expect 403 "students cannot see flagged meals"
request GET /admin/flagged-meals "" "$ADMIN_TOKEN"
expect 200 "admin sees flagged meals"

# Counters are per process; behind a load balancer keep scraping until we hit the pod that
# served the rating.
for _ in $(seq 1 20); do
  request GET /metrics
  grep -q '^ratings_submitted_total{meal_type="lunch"}' "$BODY_FILE" && break
done
expect 200 "GET /metrics after rating"
grep -q '^ratings_submitted_total{meal_type="lunch"}' "$BODY_FILE" || fail "ratings_submitted_total recorded"
PASSED=$((PASSED + 1))
echo "ok   ratings_submitted_total{meal_type=\"lunch\"} recorded"

request DELETE "/meals/$MEAL_ID" "" "$ADMIN_TOKEN"
expect 204 "admin deletes the smoke-test meal"

echo "PASS: $PASSED checks"

# Hostel Food Rating API - developer shortcuts. `make help` lists every target.
# On Windows, run from Git Bash or WSL (or copy the command a target wraps).

SHELL := bash
.DEFAULT_GOAL := help

VENV      ?= .venv
VENV_BIN  := $(if $(wildcard $(VENV)/Scripts),$(VENV)/Scripts,$(VENV)/bin)
PYTHON    := $(VENV_BIN)/python
IMAGE     ?= hostel-food-rating-api:local
BASE_URL  ?= http://localhost:8000
USERS     ?= 50
SPAWN_RATE ?= 5
DURATION  ?= 2m

.PHONY: help install lint format test cov run migrate revision seed up down logs build scan \
        smoke kind-up kind-down deploy-local loadtest monitoring-up clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Create .venv and install dev dependencies + pre-commit hooks
	test -d $(VENV) || python3 -m venv $(VENV) || python -m venv $(VENV)
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements-dev.txt
	-$(VENV_BIN)/pre-commit install

lint: ## Ruff lint + format check
	$(VENV_BIN)/ruff check .
	$(VENV_BIN)/ruff format --check .

format: ## Auto-format and auto-fix lint issues
	$(VENV_BIN)/ruff format .
	$(VENV_BIN)/ruff check --fix .

test: ## Run tests (SQLite in-memory unless DATABASE_URL is set)
	$(PYTHON) -m pytest

cov: ## Run tests with coverage (fails under 85%)
	$(PYTHON) -m pytest --cov=app --cov-report=term-missing --cov-report=xml --cov-fail-under=85

run: ## Run the API locally with auto-reload
	$(VENV_BIN)/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

migrate: ## Apply database migrations (alembic upgrade head)
	$(VENV_BIN)/alembic upgrade head

revision: ## Autogenerate a migration: make revision m="add column x"
	@test -n "$(m)" || (echo 'usage: make revision m="message"' && exit 1)
	$(VENV_BIN)/alembic revision --autogenerate -m "$(m)"

seed: ## Seed a week of demo meals, students and ratings
	$(PYTHON) -m scripts.seed_demo_data

up: ## Start api + postgres + pgadmin with Docker Compose
	test -f .env || cp .env.example .env
	docker compose up -d --build --wait

down: ## Stop the Compose stack (keeps the database volume)
	docker compose --profile monitoring down

logs: ## Follow API logs
	docker compose logs -f api

build: ## Build the container image
	docker build -t $(IMAGE) .
	@docker image inspect $(IMAGE) --format 'image size: {{.Size}} bytes'

scan: ## Audit dependencies (pip-audit) and the image (Trivy, if installed)
	$(VENV_BIN)/pip-audit -r requirements.txt
	@if command -v trivy >/dev/null; then \
		trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 $(IMAGE); \
	else echo "trivy not installed; skipping image scan"; fi

smoke: ## Run the end-to-end smoke test against BASE_URL
	BASE_URL=$(BASE_URL) bash scripts/smoke_test.sh

kind-up: ## Create a kind cluster and deploy everything
	bash scripts/kind-up.sh

kind-down: ## Delete the kind cluster
	bash scripts/kind-down.sh

deploy-local: build ## Rebuild the image and roll it out to the existing kind cluster
	kind load docker-image $(IMAGE) --name hostel-food
	kubectl apply -k k8s/overlays/local
	kubectl -n hostel-food rollout restart deployment/hostel-food-api
	kubectl -n hostel-food rollout status deployment/hostel-food-api --timeout=180s

loadtest: ## Headless Locust run: make loadtest BASE_URL=... USERS=50 DURATION=2m
	$(PYTHON) -m pip install -q -r requirements-loadtest.txt
	$(VENV_BIN)/locust -f scripts/loadtest.py --headless -u $(USERS) -r $(SPAWN_RATE) \
		-t $(DURATION) --host $(BASE_URL)

monitoring-up: ## Start the full stack plus Prometheus + Grafana
	test -f .env || cp .env.example .env
	docker compose --profile monitoring up -d --build

clean: ## Remove caches, coverage output and the local SQLite database
	find . -type d -name __pycache__ -not -path "./$(VENV)/*" -prune -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache htmlcov .coverage coverage.xml hostel_food.db

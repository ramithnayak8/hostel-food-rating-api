## What & why

<!-- One or two sentences: what does this change and why is it needed? Link the issue if there is one. -->

## Type of change

- [ ] feat: new endpoint / behaviour
- [ ] fix: bug fix
- [ ] chore / ci / docs / refactor
- [ ] Database migration included (`alembic/versions/...`)

## How was it tested?

- [ ] `make lint` passes (ruff check + ruff format --check)
- [ ] `make test` passes, coverage >= 85%
- [ ] New/changed behaviour has tests
- [ ] Tried it locally (`docker compose up`, Swagger at http://localhost:8000/docs)

## Checklist

- [ ] No secrets, tokens or real `.env` values committed
- [ ] New config is read from environment variables and documented in `.env.example` + README
- [ ] Migrations are reversible (`alembic downgrade -1` works)
- [ ] k8s / compose / monitoring updated if ports, env vars or metrics changed
- [ ] README / docs updated where behaviour changed

## Deployment notes

<!-- Anything the deployer must do: new secret, manual migration step, feature flag... Write "none" if nothing. -->

"""Application factory: wires settings, logging, middleware, routers, errors and metrics."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app import __version__
from app.config import DEV_JWT_SECRET, get_settings
from app.database import engine
from app.deps import limiter
from app.errors import register_exception_handlers
from app.logging_config import configure_logging
from app.metrics import register_app_metrics
from app.middleware import (
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.routers import admin, auth, health, meals, ratings, stats

logger = logging.getLogger("app")

DESCRIPTION = """
Students rate hostel meals (score, taste, hygiene, quantity); wardens publish menus and
watch the trends.

**Auth:** register with `POST /auth/register`, log in with `POST /auth/login` (JSON body),
then click **Authorize** and paste the `access_token`.

Errors always look like `{"error": {"code", "message", "request_id"}}`.
"""

OPENAPI_TAGS = [
    {"name": "auth", "description": "Register, log in, inspect the current user."},
    {"name": "meals", "description": "Menus per date and meal type. Writes are admin-only."},
    {"name": "ratings", "description": "One rating per student per meal."},
    {"name": "stats", "description": "Daily and weekly aggregates."},
    {"name": "admin", "description": "Warden views, such as flagged meals."},
    {"name": "health", "description": "Kubernetes liveness and readiness probes."},
]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.jwt_secret == DEV_JWT_SECRET:
        logger.warning("JWT_SECRET is the development default; set it before deploying")
    logger.info("startup", extra={"version": __version__, "env": settings.env})
    yield
    # Uvicorn has stopped accepting requests and drained in-flight ones by now.
    engine.dispose()
    logger.info("shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    docs = settings.docs_available
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=DESCRIPTION,
        openapi_tags=OPENAPI_TAGS,
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.limiter = limiter
    register_exception_handlers(app)

    # Starlette runs the last-added middleware first, so the request-ID wrapper is outermost.
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
            expose_headers=["X-Request-ID"],
        )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)

    for module in (health, auth, meals, ratings, stats, admin):
        app.include_router(module.router)

    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
        should_instrument_requests_inprogress=True,
        inprogress_labels=True,
        excluded_handlers=["/metrics", "/health.*"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    register_app_metrics()
    return app


app = create_app()

"""Shared FastAPI dependencies: DB session, pagination and the rate limiter."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db

DbSession = Annotated[Session, Depends(get_db)]

MAX_PAGE_SIZE = 100

# Keyed on client IP. Uvicorn runs with --proxy-headers, so behind the ingress this is the real
# client address. Limits are read from settings on every request, so they can be tuned via env.
limiter = Limiter(
    key_func=get_remote_address,
    # Bucket per endpoint function, not per URL: /meals/1/ratings and /meals/2/ratings share one.
    key_style="endpoint",
    enabled=get_settings().rate_limit_enabled,
    storage_uri=get_settings().rate_limit_storage_uri,
)


def auth_rate_limit() -> str:
    return get_settings().rate_limit_auth


def ratings_rate_limit() -> str:
    return get_settings().rate_limit_ratings


@dataclass(frozen=True)
class Pagination:
    limit: int
    offset: int


def pagination_params(
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Page size")] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000, description="Items to skip")] = 0,
) -> Pagination:
    return Pagination(limit=limit, offset=offset)


PageParams = Annotated[Pagination, Depends(pagination_params)]

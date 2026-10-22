"""Database engine, session factory and the request-scoped session dependency."""

import sqlite3
from collections.abc import Iterator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection: Any, _: Any) -> None:
    # SQLite ignores ON DELETE CASCADE unless foreign keys are switched on per connection.
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def make_engine(settings: Settings) -> Engine:
    """Build an engine; pool settings only apply to real servers, not SQLite."""
    url = settings.database_url
    if url.startswith("sqlite"):
        in_memory = url in ("sqlite://", "sqlite+pysqlite://") or ":memory:" in url
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            # An in-memory database lives in one connection, so every session must share it.
            poolclass=StaticPool if in_memory else None,
        )
    return create_engine(
        url,
        # Fail readiness checks quickly instead of hanging when the database is unreachable.
        connect_args={"connect_timeout": 5},
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_recycle=settings.db_pool_recycle,
    )


engine = make_engine(get_settings())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Yield a session per request and always close it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

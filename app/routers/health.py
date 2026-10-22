"""Liveness and readiness probes."""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import __version__
from app.deps import DbSession
from app.schemas import Liveness, Readiness

router = APIRouter(prefix="/health", tags=["health"])


def database_is_up(db: Session) -> bool:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return False
    return True


@router.get("", response_model=Liveness, summary="Liveness probe")
def liveness() -> Liveness:
    """The process is up and serving requests. Never touches the database."""
    return Liveness(status="ok", version=__version__)


@router.get(
    "/ready",
    response_model=Readiness,
    summary="Readiness probe",
    responses={503: {"model": Readiness, "description": "Database unreachable"}},
)
def readiness(db: DbSession) -> Readiness | JSONResponse:
    """Ready to take traffic: the database answers `SELECT 1`. Returns 503 otherwise."""
    if database_is_up(db):
        return Readiness(status="ready", database="up")
    return JSONResponse(
        Readiness(status="unavailable", database="down").model_dump(),
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )

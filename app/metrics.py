"""Custom Prometheus metrics (HTTP metrics come from prometheus-fastapi-instrumentator)."""

from collections.abc import Iterator

from prometheus_client import REGISTRY, Counter, Gauge
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.config import get_settings
from app.database import SessionLocal
from app.models import Meal

RATINGS_SUBMITTED = Counter(
    "ratings_submitted", "Ratings successfully submitted", labelnames=["meal_type"]
)
MEALS_FLAGGED = Counter(
    "meals_flagged", "Times a meal crossed the complaint threshold", labelnames=["meal_type"]
)
APP_INFO = Gauge("app_info", "Build information", labelnames=["version", "env"])


class AppStateCollector(Collector):
    """Reads state that lives in the database at scrape time.

    Every replica reports the same values, so dashboards and alerts aggregate with max().
    """

    def collect(self) -> Iterator[GaugeMetricFamily]:
        database_up = GaugeMetricFamily("database_up", "1 if the database answered a query")
        try:
            with SessionLocal() as db:
                flagged = db.scalar(
                    select(func.count()).select_from(Meal).where(Meal.flagged.is_(True))
                )
        except SQLAlchemyError:
            database_up.add_metric([], 0)
            yield database_up
            return
        database_up.add_metric([], 1)
        yield database_up
        yield GaugeMetricFamily(
            "flagged_meals", "Meals currently flagged for complaints", value=flagged or 0
        )


_registered = False


def register_app_metrics() -> None:
    """Idempotently register the DB-backed collector and publish build info."""
    global _registered
    if not _registered:
        REGISTRY.register(AppStateCollector())
        _registered = True
    APP_INFO.labels(version=__version__, env=get_settings().env).set(1)

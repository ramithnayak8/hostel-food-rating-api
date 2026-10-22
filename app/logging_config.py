"""JSON structured logging. Every record carries the current request's ID."""

import logging
import sys
from contextvars import ContextVar

from pythonjsonlogger.json import JsonFormatter

# Set by RequestContextMiddleware for the lifetime of each request.
request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


class RequestIdFilter(logging.Filter):
    """Attach the current request ID (or None outside a request) to every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        record.__dict__.pop("color_message", None)  # uvicorn's ANSI-coloured duplicate
        return True


def configure_logging(level: str = "INFO") -> None:
    """Route the app's and uvicorn's logs through one JSON handler on stdout."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter(
            "{levelname}{name}{message}",
            style="{",
            rename_fields={"levelname": "level", "name": "logger"},
            timestamp=True,
        )
    )
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Uvicorn installs its own plain-text handlers; send everything through ours instead.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    # RequestContextMiddleware writes the access log (with request IDs); don't duplicate it.
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = []
    access_logger.propagate = False

"""Exception handlers: every error leaves the API as {"error": {code, message, request_id}}."""

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_config import request_id_ctx

logger = logging.getLogger("app.errors")

ERROR_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def error_response(
    status_code: int,
    message: str,
    *,
    details: list[dict[str, object]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = request_id_ctx.get()
    error: dict[str, object] = {
        "code": ERROR_CODES.get(
            status_code, HTTPStatus(status_code).phrase.lower().replace(" ", "_")
        ),
        "message": message,
        "request_id": request_id,
    }
    if details is not None:
        error["details"] = details
    response_headers = dict(headers or {})
    if request_id:
        response_headers["X-Request-ID"] = request_id
    return JSONResponse({"error": error}, status_code=status_code, headers=response_headers)


async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return error_response(exc.status_code, str(exc.detail), headers=exc.headers)


async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    details: list[dict[str, object]] = [
        {"loc": list(err["loc"]), "msg": err["msg"], "type": err["type"]} for err in exc.errors()
    ]
    return error_response(422, "Request validation failed", details=details)


async def rate_limit_handler(_: Request, exc: RateLimitExceeded) -> JSONResponse:
    return error_response(429, f"Rate limit exceeded: {exc.detail}", headers={"Retry-After": "60"})


async def integrity_error_handler(_: Request, exc: IntegrityError) -> JSONResponse:
    # Routers translate the conflicts they expect; this is the safety net for races.
    logger.warning("integrity error", extra={"error": str(exc.orig)})
    return error_response(409, "Request conflicts with existing data")


async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error", exc_info=exc)
    return error_response(500, "Internal server error")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

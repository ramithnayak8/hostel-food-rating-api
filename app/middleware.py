"""Pure-ASGI middleware: request IDs + access logs, security headers and body size limits."""

import logging
import re
import time
import uuid

from fastapi import HTTPException, status
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import error_response
from app.logging_config import request_id_ctx

access_logger = logging.getLogger("app.access")

_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_QUIET_PATHS = ("/health", "/metrics")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


class RequestContextMiddleware:
    """Assign/propagate X-Request-ID and emit one JSON access log line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        request_id_ctx.set(request_id)
        status_code = 500
        start = time.perf_counter()

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            path = scope["path"]
            access_logger.log(
                logging.DEBUG if path.startswith(_QUIET_PATHS) else logging.INFO,
                "request",
                extra={
                    "method": scope["method"],
                    "path": path,
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                    "client": scope["client"][0] if scope.get("client") else None,
                },
            )


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodyTooLargeError(HTTPException):
    def __init__(self) -> None:
        super().__init__(status.HTTP_413_CONTENT_TOO_LARGE, "Request body too large")


class BodySizeLimitMiddleware:
    """Reject bodies over `max_bytes`, by Content-Length up front or while streaming."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length", "")
        if declared.isdigit() and int(declared) > self.max_bytes:
            response = error_response(413, "Request body too large")
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # An HTTPException, so FastAPI's body parsing re-raises it untouched.
                    raise BodyTooLargeError
            return message

        await self.app(scope, limited_receive, send)

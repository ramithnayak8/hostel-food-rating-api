"""The web app: a static single-page site served from the API's own origin.

Same origin means no CORS and no second container. The page itself is plain HTML, CSS and ES
modules under app/static; it talks to the JSON API with the same bearer tokens as any client.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.responses import HTMLResponse
from starlette.responses import Response
from starlette.staticfiles import StaticFiles

from app import __version__

STATIC_DIR = Path(__file__).parent / "static"

# Scripts, styles and API calls may only come from this origin; the one outside source is
# Google Fonts. No inline scripts or style attributes, so injected markup can't execute.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)
# Browsers revalidate with the ETag on every load, so a new deploy is picked up immediately.
NO_CACHE = "no-cache"

router = APIRouter(include_in_schema=False)


@lru_cache
def _index_html() -> str:
    # The version query string busts caches for the entry CSS/JS on every release.
    return (
        (STATIC_DIR / "index.html").read_text(encoding="utf-8").replace("{{VERSION}}", __version__)
    )


@router.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(
        _index_html(),
        headers={"Content-Security-Policy": CONTENT_SECURITY_POLICY, "Cache-Control": NO_CACHE},
    )


class StaticAssets(StaticFiles):
    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = NO_CACHE
        return response


def register_web(app: FastAPI) -> None:
    app.include_router(router)
    app.mount("/static", StaticAssets(directory=STATIC_DIR), name="static")

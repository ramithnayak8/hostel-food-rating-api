"""Run the API as a standalone program: apply migrations, then serve with uvicorn.

    hostel-food-api [--host 127.0.0.1] [--port 8000] [--no-migrate] [--open | --no-open]

This is the entry point of the packaged artifacts: the wheel's `hostel-food-api` command and
the self-contained `dist/hostel-food-api-*.pyz` (`python hostel-food-api-*.pyz`). With no
DATABASE_URL it uses a local SQLite file, so it runs with no database server. Containers keep
using entrypoint.sh.

Started from a terminal, it opens the web app in the default browser as soon as /health answers
(`--no-open` to skip; never when output is redirected or CI is set).
"""

import argparse
import os
import sys
import threading
import time
import urllib.request
import webbrowser
from collections.abc import Sequence
from importlib.resources import files

from alembic import command
from alembic.config import Config


def migrate() -> None:
    """`alembic upgrade head` using the migrations packaged inside `app`."""
    config = Config()
    config.set_main_option("script_location", str(files("app") / "migrations"))
    command.upgrade(config, "head")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="hostel-food-api", description=__doc__.splitlines()[0])
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument(
        "--no-migrate", action="store_true", help="skip `alembic upgrade head` on start"
    )
    parser.add_argument(
        "--open",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="open the web app in the browser once it is up (default: only from a terminal)",
    )
    args = parser.parse_args(argv)
    if args.open is None:
        args.open = sys.stdout.isatty() and not os.environ.get("CI")
    return args


def browser_url(host: str, port: int) -> str:
    """The address a browser on this machine should use for a server bound to `host`."""
    if host in ("", "0.0.0.0", "::"):  # noqa: S104 - compared, never bound
        host = "127.0.0.1"
    elif ":" in host:
        host = f"[{host}]"
    return f"http://{host}:{port}/"


def open_when_ready(url: str, timeout: float = 60.0) -> threading.Thread:
    """Open `url` in the default browser as soon as its /health answers (background thread)."""

    def wait_then_open() -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(f"{url}health", timeout=2):  # noqa: S310 - http(s) URL built above
                    break
            except OSError:
                time.sleep(0.5)
        else:
            return
        print(f"Opening {url} in your browser", flush=True)
        webbrowser.open(url)

    thread = threading.Thread(target=wait_then_open, name="open-browser", daemon=True)
    thread.start()
    return thread


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.no_migrate:
        migrate()
    if args.open:
        open_when_ready(browser_url(args.host, args.port))

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        proxy_headers=True,
        access_log=False,
        timeout_graceful_shutdown=20,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

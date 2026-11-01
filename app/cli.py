"""Run the API as a standalone program: apply migrations, then serve with uvicorn.

    hostel-food-api [--host 127.0.0.1] [--port 8000] [--no-migrate]

This is the entry point of the packaged artifacts: the wheel's `hostel-food-api` command and
the self-contained `dist/hostel-food-api-*.pyz` (`python hostel-food-api-*.pyz`). With no
DATABASE_URL it uses a local SQLite file, so it runs with no database server. Containers keep
using entrypoint.sh.
"""

import argparse
import os
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
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.no_migrate:
        migrate()

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

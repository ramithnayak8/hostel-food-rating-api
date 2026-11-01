from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

from app import cli


def test_migrate_builds_the_schema_from_the_packaged_migrations(settings, tmp_path: Path) -> None:
    db_file = tmp_path / "standalone.db"
    settings.database_url = f"sqlite:///{db_file.as_posix()}"

    cli.migrate()

    engine = create_engine(settings.database_url)
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert {"users", "meals", "ratings", "alembic_version"} <= tables


def test_args_default_to_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOST", "0.0.0.0")  # noqa: S104 - parsed, never bound
    monkeypatch.setenv("PORT", "9123")

    args = cli.parse_args([])

    assert (args.host, args.port, args.no_migrate) == ("0.0.0.0", 9123, False)  # noqa: S104


def test_main_migrates_then_serves(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[object] = []
    monkeypatch.setattr(cli, "migrate", lambda: calls.append("migrate"))
    monkeypatch.setattr(
        "uvicorn.run", lambda app, **kw: calls.append((app, kw["host"], kw["port"]))
    )

    assert cli.main(["--port", "8123"]) == 0
    assert calls == ["migrate", ("app.main:app", "127.0.0.1", 8123)]


def test_main_can_skip_migrations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "migrate", lambda: pytest.fail("migrated"))
    monkeypatch.setattr("uvicorn.run", lambda *a, **kw: None)

    assert cli.main(["--no-migrate"]) == 0

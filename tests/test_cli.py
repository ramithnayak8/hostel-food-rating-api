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


def test_main_opens_the_browser_only_when_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(cli, "migrate", lambda: None)
    monkeypatch.setattr(cli, "open_when_ready", opened.append)
    monkeypatch.setattr("uvicorn.run", lambda *a, **kw: None)

    cli.main(["--no-open"])
    cli.main([])  # pytest captures stdout, so this is "not a terminal"
    cli.main(["--open", "--host", "0.0.0.0", "--port", "8124"])  # noqa: S104 - never bound

    assert opened == ["http://127.0.0.1:8124/"]


@pytest.mark.parametrize(
    ("host", "url"),
    [
        ("127.0.0.1", "http://127.0.0.1:8000/"),
        ("0.0.0.0", "http://127.0.0.1:8000/"),  # noqa: S104 - never bound
        ("::1", "http://[::1]:8000/"),
        ("localhost", "http://localhost:8000/"),
    ],
)
def test_browser_url(host: str, url: str) -> None:
    assert cli.browser_url(host, 8000) == url


def test_open_when_ready_waits_for_health(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[str] = []
    opened: list[str] = []

    class _Response:
        def __enter__(self) -> "_Response":
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def fake_urlopen(url: str, timeout: float) -> _Response:
        attempts.append(url)
        if len(attempts) < 3:
            raise ConnectionRefusedError
        return _Response()

    monkeypatch.setattr(cli.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    monkeypatch.setattr(cli.webbrowser, "open", opened.append)

    cli.open_when_ready("http://127.0.0.1:8000/").join(timeout=5)

    assert attempts == ["http://127.0.0.1:8000/health"] * 3
    assert opened == ["http://127.0.0.1:8000/"]


def test_open_when_ready_gives_up_quietly(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(url: str, timeout: float) -> None:
        raise ConnectionRefusedError

    monkeypatch.setattr(cli.urllib.request, "urlopen", refuse)
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    monkeypatch.setattr(cli.webbrowser, "open", lambda url: pytest.fail("opened"))

    cli.open_when_ready("http://127.0.0.1:8000/", timeout=0.05).join(timeout=5)

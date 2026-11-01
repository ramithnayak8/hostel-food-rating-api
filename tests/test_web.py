from fastapi.testclient import TestClient

from app import __version__


def test_index_serves_the_web_app_with_a_strict_csp(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert f"/static/js/main.js?v={__version__}" in response.text
    assert "{{VERSION}}" not in response.text
    csp = response.headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "unsafe-inline" not in csp
    assert "frame-ancestors 'none'" in csp
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-frame-options"] == "DENY"


def test_index_answers_head_requests(client: TestClient) -> None:
    response = client.head("/")

    assert response.status_code == 200
    assert response.headers["content-security-policy"]


def test_static_assets_are_served_and_revalidated(client: TestClient) -> None:
    for path, media_type in [
        ("/static/js/main.js", "javascript"),
        ("/static/css/app.css", "text/css"),
        ("/static/icon.svg", "image/svg+xml"),
    ]:
        response = client.get(path)

        assert response.status_code == 200, path
        assert media_type in response.headers["content-type"]
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["etag"]


def test_static_assets_honour_etags(client: TestClient) -> None:
    etag = client.get("/static/js/main.js").headers["etag"]

    assert client.get("/static/js/main.js", headers={"If-None-Match": etag}).status_code == 304


def test_missing_static_file_is_a_json_404(client: TestClient) -> None:
    response = client.get("/static/js/nope.js")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_static_files_cannot_escape_their_folder(client: TestClient) -> None:
    for path in ["/static/../config.py", "/static/%2e%2e/config.py", "/static/..%2fconfig.py"]:
        response = client.get(path)

        assert response.status_code == 404, path
        assert "jwt_secret" not in response.text


def test_unknown_api_paths_still_get_json_errors(client: TestClient) -> None:
    response = client.get("/definitely-not-a-route")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_web_routes_stay_out_of_the_openapi_schema(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]

    assert "/" not in paths
    assert not any(path.startswith("/static") for path in paths)

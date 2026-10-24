"""Acceptance tests for the SDK contract; mirrors the original Next.js smoke test, plus extras."""

import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.projects import Project, ProjectRegistry
from app.sessions import SessionStore

KEY = {"X-Public-Key": "pk_dev_demo"}
OK = {"Origin": "http://localhost:3000"}
H = {**KEY, **OK}


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path))  # no OPENAI key -> mock agent
    with TestClient(app) as c:
        yield c


@pytest.fixture
def session_id(client):
    r = client.post(
        "/api/v1/sessions",
        headers=H,
        json={"url": "http://localhost:3000/demo", "user": {"userId": "u1"}},
    )
    assert r.status_code == 201
    return r.json()["sessionId"]


def upload_url(client, sid, seq):
    r = client.post(
        f"/api/v1/sessions/{sid}/upload-url",
        headers=H,
        json={"seq": seq, "contentType": "video/webm"},
    )
    assert r.status_code == 200
    return r.json()["url"]


def test_auth_gates(client):
    assert client.post("/api/v1/sessions", headers=OK, json={}).status_code == 401
    assert (
        client.post("/api/v1/sessions", headers={**OK, "X-Public-Key": "nope"}, json={}).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/sessions", headers={**KEY, "Origin": "http://localhost:3001"}, json={}
        ).status_code
        == 403
    )
    assert client.post("/api/v1/sessions", headers=KEY, json={}).status_code == 403
    # auth failures must not carry CORS headers
    r = client.post("/api/v1/sessions", headers={**KEY, "Origin": "http://evil.example"}, json={})
    assert "access-control-allow-origin" not in r.headers


def test_create_session_contract(client):
    r = client.post(
        "/api/v1/sessions", headers=H, json={"url": "u", "user": {"userId": "u1", "evil": "x"}}
    )
    body = r.json()
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert body["sessionId"].startswith("ses_") and body["maxSessionSeconds"] == 180
    rt = body["realtime"]
    assert set(rt) == {
        "provider",
        "model",
        "clientSecret",
        "expiresAt",
        "connectUrl",
        "instructions",
    }
    assert rt["provider"] == "mock"
    detail = client.get(f"/api/v1/admin/sessions/{body['sessionId']}").json()
    assert detail["endUser"] == {"userId": "u1"}  # unknown keys dropped


def test_upload_and_signatures(client, session_id):
    url = upload_url(client, session_id, 0)
    assert url.startswith("/api/v1/storage/")
    assert client.put(url[:-2] + "00", content=b"x").status_code == 403  # tampered
    assert client.put(url, content=b"chunk0").status_code == 200
    assert client.get(url).status_code == 403  # PUT signature can't GET
    assert (
        client.post(
            f"/api/v1/sessions/{session_id}/upload-url", headers=H, json={"seq": -1}
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/v1/sessions/{session_id}/upload-url", headers=H, json={"seq": "1"}
        ).status_code
        == 400
    )
    assert (
        client.post("/api/v1/sessions/ses_nope/upload-url", headers=H, json={"seq": 0}).status_code
        == 404
    )


def test_expired_signature_and_path_traversal(client, session_id):
    store = client.app.state.local_storage
    exp = int(time.time()) - 5
    sig = store._sign("a/b", "PUT", exp)
    assert client.put(f"/api/v1/storage/a/b?exp={exp}&sig={sig}", content=b"x").status_code == 403
    exp = int(time.time()) + 60
    key = "../../escape"
    sig = store._sign(key, "PUT", exp)
    assert client.put(f"/api/v1/storage/{key}?exp={exp}&sig={sig}", content=b"x").status_code in (
        403,
        404,
    )
    assert not (store.root.parent / "escape").exists()


def test_events(client, session_id):
    ok = client.post(
        f"/api/v1/sessions/{session_id}/events",
        headers=H,
        json={"seq": 0, "events": [{"type": 4}, {"type": 2}]},
    )
    assert ok.status_code == 200
    assert (
        client.post(f"/api/v1/sessions/{session_id}/events", headers=H, json={"seq": 0}).status_code
        == 400
    )
    assert (
        client.post(f"/api/v1/sessions/{session_id}/events", headers=H, content=b"nope").status_code
        == 400
    )
    big = client.post(
        f"/api/v1/sessions/{session_id}/events",
        headers=H,
        json={"seq": 1, "events": ["x" * 1_100_000]},
    )
    assert big.status_code == 413


def test_end_media_and_dashboard(client, session_id):
    for seq, data in enumerate([b"chunk0", b"chunk1"]):
        assert client.put(upload_url(client, session_id, seq), content=data).status_code == 200
    r = client.post(
        f"/api/v1/sessions/{session_id}/end",
        headers=H,
        json={
            "transcript": [
                {"role": "agent", "text": "Hello!", "at": 10},
                {"role": "weird", "text": 5},
            ],
            "context": {"consoleErrors": [], "failedRequests": [], "clicks": list(range(30))},
            "usage": {
                "responses": 2,
                "input": {"text": 5, "bad": "x"},
                "n": float("nan") if False else 1,
            },
        },
    )
    assert r.status_code == 200
    assert client.get(f"/api/v1/sessions/{session_id}/media").content == b"chunk0chunk1"

    detail = client.get(f"/api/v1/admin/sessions/{session_id}").json()
    assert detail["status"] == "ended" and detail["endedAt"]
    assert detail["transcript"][1] == {"role": "user", "text": "5", "at": 0}
    assert detail["context"]["clicks"] == list(range(20, 30))
    assert detail["usage"] == {"responses": 2, "input": {"text": 5}, "n": 1}
    assert detail["mediaChunks"] == 2
    assert [s["id"] for s in client.get("/api/v1/admin/sessions").json()] == [session_id]


def test_rate_limit(tmp_path):
    reg = ProjectRegistry([Project("p", "pk_dev_demo", ("http://localhost:3000",), 180, 2)])
    with TestClient(create_app(Settings(data_dir=tmp_path), projects=reg)) as c:
        codes = [c.post("/api/v1/sessions", headers=H, json={}).status_code for _ in range(3)]
    assert codes == [201, 201, 429]


def test_session_cap_grace(tmp_path):
    reg = ProjectRegistry([Project("p", "pk_dev_demo", ("http://localhost:3000",), 1, 30)])
    app = create_app(Settings(data_dir=tmp_path), projects=reg)
    with TestClient(app) as c:
        sid = c.post("/api/v1/sessions", headers=H, json={}).json()["sessionId"]
        assert (
            c.post(f"/api/v1/sessions/{sid}/upload-url", headers=H, json={"seq": 0}).status_code
            == 200
        )
        # age the session past cap + grace
        app.state.store._db.execute("UPDATE sessions SET started_at='2000-01-01T00:00:00.000Z'")
        assert (
            c.post(f"/api/v1/sessions/{sid}/upload-url", headers=H, json={"seq": 0}).status_code
            == 410
        )


def test_other_projects_session_is_404(tmp_path):
    reg = ProjectRegistry(
        [
            Project("p1", "pk_dev_demo", ("http://localhost:3000",), 180, 30),
            Project("p2", "pk_other", ("http://localhost:3000",), 180, 30),
        ]
    )
    with TestClient(create_app(Settings(data_dir=tmp_path), projects=reg)) as c:
        sid = c.post("/api/v1/sessions", headers=H, json={}).json()["sessionId"]
        other = {"X-Public-Key": "pk_other", **OK}
        assert c.post(f"/api/v1/sessions/{sid}/end", headers=other, json={}).status_code == 404


def test_preflight_and_production_guards(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as c:
        ok = c.options(
            "/api/v1/sessions",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
        )
        assert (
            ok.status_code == 204
            and ok.headers["access-control-allow-origin"] == "http://localhost:3000"
        )
        evil = c.options("/api/v1/sessions", headers={"Origin": "http://evil.example"})
        assert evil.status_code == 204 and evil.headers["access-control-allow-origin"] == ""
    with TestClient(create_app(Settings(data_dir=tmp_path, environment="production"))) as c:
        assert c.get("/api/v1/admin/sessions").status_code == 404
        assert c.put("/api/v1/storage/a?exp=9999999999&sig=x", content=b"x").status_code == 404


def test_store_persists(tmp_path):
    s = SessionStore(str(tmp_path / "x.db"))
    s.create(
        id="ses_1",
        project_id="p",
        url="u",
        user_agent="ua",
        end_user=None,
        realtime_provider="mock",
        prefix="p/ses_1",
    )
    assert SessionStore(str(tmp_path / "x.db")).get("ses_1").status == "active"


def test_end_keeps_navigations(client, session_id):
    navs = [
        {"url": f"http://localhost:3000/p{i}", "from": "/", "title": "T", "at": i, "evil": "x"}
        for i in range(40)
    ]
    r = client.post(
        f"/api/v1/sessions/{session_id}/end",
        headers=H,
        json={
            "context": {
                "consoleErrors": [],
                "failedRequests": [],
                "clicks": [],
                "navigations": ["junk", *navs],
            }
        },
    )
    assert r.status_code == 200
    saved = client.get(f"/api/v1/admin/sessions/{session_id}").json()["context"]["navigations"]
    assert (
        len(saved) == 30
        and saved[-1]["url"].endswith("/p39")
        and set(saved[0]) == {"url", "from", "title", "at"}
    )


@pytest.mark.parametrize("env", ["production", "Production", "prod", "staging", "PRODUCTION "])
def test_dev_routes_fail_closed_outside_development(tmp_path, env):
    with TestClient(create_app(Settings(data_dir=tmp_path, environment=env))) as c:
        assert c.get("/api/v1/admin/sessions").status_code == 404


def test_upload_url_ignores_client_content_type(client, session_id):
    r = client.post(
        f"/api/v1/sessions/{session_id}/upload-url",
        headers=H,
        json={"seq": 0, "contentType": "text/html"},
    )
    assert r.status_code == 200
    assert r.json()["key"].endswith(".webm")
    assert "text%2Fhtml" not in r.json()["url"] and "text/html" not in r.json()["url"]


def test_oversized_and_malformed_bodies(client, session_id):
    url = f"/api/v1/sessions/{session_id}/events"
    assert client.post(url, headers=H, content=b"x" * 1_000_001).status_code == 413
    assert client.post(url, headers=H, content=b"[" * 100_000).status_code == 400
    assert client.post(url, headers=H, content=b'{"seq":0,"events":[{"x":NaN}]}').status_code == 400
    assert (
        client.post(url, headers=H, content=b'{"seq":0,"events":[{"t":"\\ud800"}]}').status_code
        == 200
    )


def test_session_quota_is_atomic(tmp_path):
    import asyncio

    import httpx

    from app.realtime.mock import MockProvider

    class SlowProvider(MockProvider):
        async def create_client_session(self, *, instructions):
            await asyncio.sleep(0.05)
            return await super().create_client_session(instructions=instructions)

    registry = ProjectRegistry([Project("proj_q", "pk_q", ("http://localhost:3000",), 180, 5)])
    app = create_app(Settings(data_dir=tmp_path), projects=registry, realtime=SlowProvider())

    async def go():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://t"
        ) as c:
            rs = await asyncio.gather(
                *[
                    c.post("/api/v1/sessions", headers={"X-Public-Key": "pk_q", **OK}, json={})
                    for _ in range(20)
                ]
            )
            return [r.status_code for r in rs]

    codes = asyncio.run(go())
    assert codes.count(201) == 5 and codes.count(429) == 15

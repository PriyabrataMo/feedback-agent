"""Admin replay endpoint: concatenated rrweb events for the dashboard player."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

H = {"X-Public-Key": "pk_dev_demo", "Origin": "http://localhost:3000"}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as c:
        yield c


@pytest.fixture
def sid(client):
    r = client.post("/api/v1/sessions", headers=H, json={"url": "http://localhost:3000/demo"})
    assert r.status_code == 201
    return r.json()["sessionId"]


def post_events(client, sid, seq, events):
    r = client.post(
        f"/api/v1/sessions/{sid}/events", headers=H, json={"seq": seq, "events": events}
    )
    assert r.status_code == 200


def test_events_empty_when_none_recorded(client, sid):
    r = client.get(f"/api/v1/admin/sessions/{sid}/events")
    assert r.status_code == 200 and r.json() == []


def test_events_concatenated_in_segment_order(client, sid):
    post_events(client, sid, 1, [{"type": 3, "timestamp": 3}, {"type": 3, "timestamp": 4}])
    post_events(client, sid, 0, [{"type": 4, "timestamp": 1}, {"type": 2, "timestamp": 2}])
    r = client.get(
        f"/api/v1/admin/sessions/{sid}/events", headers={"Origin": "http://localhost:3000"}
    )
    assert [e["timestamp"] for e in r.json()] == [1, 2, 3, 4]
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_events_skips_corrupt_lines_and_non_objects(client, sid):
    key = client.app.state.store.get(sid).prefix + "/events/000000.ndjson"
    body = b'{"type":4,"timestamp":1}\nnot json\n\n[1,2]\n{"type":2,"timestamp":2}'
    import asyncio

    asyncio.run(client.app.state.local_storage.put_object(key, body, "application/x-ndjson"))
    r = client.get(f"/api/v1/admin/sessions/{sid}/events")
    assert [e["type"] for e in r.json()] == [4, 2]


def test_events_cors_only_for_allowed_origins(client, sid):
    ok = client.get(
        f"/api/v1/admin/sessions/{sid}/events", headers={"Origin": "http://localhost:3000"}
    )
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
    evil = client.get(
        f"/api/v1/admin/sessions/{sid}/events", headers={"Origin": "http://evil.example"}
    )
    assert "access-control-allow-origin" not in evil.headers
    none = client.get(f"/api/v1/admin/sessions/{sid}/events")
    assert "access-control-allow-origin" not in none.headers


def test_events_404_unknown_session(client):
    assert client.get("/api/v1/admin/sessions/ses_nope/events").status_code == 404


def test_events_404_in_production(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as c:
        real = c.post("/api/v1/sessions", headers=H, json={}).json()["sessionId"]
    with TestClient(create_app(Settings(data_dir=tmp_path, environment="production"))) as c:
        assert c.get(f"/api/v1/admin/sessions/{real}/events").status_code == 404


def test_media_supports_byte_ranges(client, sid):
    import asyncio

    prefix = client.app.state.store.get(sid).prefix
    store = client.app.state.local_storage
    asyncio.run(store.put_object(f"{prefix}/media/000000.webm", b"0123456789", "video/webm"))
    asyncio.run(store.put_object(f"{prefix}/media/000001.webm", b"ABCDEFGHIJ", "video/webm"))
    url = f"/api/v1/sessions/{sid}/media"
    full = client.get(url)
    assert (
        full.status_code == 200
        and full.content == b"0123456789ABCDEFGHIJ"
        and full.headers["accept-ranges"] == "bytes"
    )
    part = client.get(url, headers={"Range": "bytes=8-11"})
    assert (
        part.status_code == 206
        and part.content == b"89AB"
        and part.headers["content-range"] == "bytes 8-11/20"
    )
    assert client.get(url, headers={"Range": "bytes=15-"}).content == b"FGHIJ"
    assert client.get(url, headers={"Range": "bytes=-3"}).content == b"HIJ"
    assert client.get(url, headers={"Range": "bytes=99-"}).status_code == 416

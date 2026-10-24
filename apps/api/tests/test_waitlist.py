"""Landing-page waitlist: signup contract, storage, rate limit and owner-only listing."""

import csv
import io
import logging
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.waitlist import RateLimiter, csv_cell, mask_email, normalize_email

TOKEN = "test-admin-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path):
    settings = Settings(data_dir=tmp_path, waitlist_admin_token=TOKEN)
    with TestClient(create_app(settings)) as c:
        yield c


def rows(client):
    return client.app.state.waitlist.list()


def join(client, email, **extra):
    return client.post("/v1/waitlist", json={"email": email, **extra})


def test_new_email_stored_and_normalized(client):
    r = join(client, "  Ada.Lovelace@Example.COM \t", source="hero")
    assert r.status_code == 200 and r.json() == {"ok": True}
    (entry,) = rows(client)
    assert entry.email == "ada.lovelace@example.com"
    assert entry.source == "hero"
    assert entry.created_at.endswith("Z")


def test_ip_is_stored_only_as_salted_hash(client):
    r = client.post(
        "/v1/waitlist",
        json={"email": "a@example.com"},
        headers={"X-Forwarded-For": "203.0.113.9, 10.0.0.1"},
    )
    assert r.status_code == 200
    (entry,) = rows(client)
    assert entry.ip_hash and "203.0.113.9" not in entry.ip_hash
    db = sqlite3.connect(client.app.state.settings.data_dir / "sessions.db")
    dump = "\n".join(db.iterdump())
    assert "203.0.113.9" not in dump


def test_source_is_truncated_and_cleaned(client):
    join(client, "a@example.com", source="x" * 200)
    join(client, "b@example.com", source="he\nro\x00")
    by_email = {e.email: e.source for e in rows(client)}
    assert by_email["a@example.com"] == "x" * 64
    assert by_email["b@example.com"] == "hero"


def test_duplicate_is_ok_and_keeps_one_row(client):
    first = join(client, "dup@example.com", source="hero")
    second = join(client, "  DUP@Example.com ")
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == {"ok": True}
    (entry,) = rows(client)
    assert entry.source == "hero"  # the original row is untouched


@pytest.mark.parametrize(
    "email",
    [
        "",
        "   ",
        "plainaddress",
        "no-at.example.com",
        "@example.com",
        "a@",
        "a@example",
        "a@@example.com",
        "a b@example.com",
        "a@exa mple.com",
        "a..b@example.com",
        ".a@example.com",
        "a@-example.com",
        "a@example.c",
        "a\nb@example.com",
        "a@example.com\nBcc: x@evil.com",
        "a\x00@example.com",
        "x" * 250 + "@example.com",
        "a" * 65 + "@example.com",
        123,
        None,
        ["a@example.com"],
    ],
)
def test_invalid_email_rejected(client, email):
    r = join(client, email)
    assert r.status_code == 422
    assert rows(client) == []


def test_non_object_or_garbage_body_rejected(client):
    for body in (b"not json", b"[]", b'"a@b.co"', b""):
        r = client.post("/v1/waitlist", content=body, headers={"Content-Type": "application/json"})
        assert r.status_code == 422
    assert rows(client) == []


def test_oversized_body_rejected(client):
    r = client.post("/v1/waitlist", json={"email": "a@example.com", "source": "x" * 10_000})
    assert r.status_code == 413
    assert rows(client) == []


def test_honeypot_returns_ok_but_stores_nothing(client):
    r = join(client, "bot@example.com", website="http://spam.example")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert rows(client) == []
    # An empty honeypot is a normal signup.
    assert join(client, "human@example.com", website="").status_code == 200
    assert [e.email for e in rows(client)] == ["human@example.com"]


def test_rate_limited_per_ip_not_globally(client):
    headers = {"X-Forwarded-For": "198.51.100.1"}
    codes = [
        client.post(
            "/v1/waitlist", json={"email": f"u{i}@example.com"}, headers=headers
        ).status_code
        for i in range(7)
    ]
    assert codes == [200] * 5 + [429] * 2
    assert len(rows(client)) == 5
    other = client.post(
        "/v1/waitlist",
        json={"email": "other@example.com"},
        headers={"X-Forwarded-For": "198.51.100.2"},
    )
    assert other.status_code == 200


def test_invalid_requests_also_count_against_the_limit(client):
    codes = [join(client, "nope").status_code for _ in range(6)]
    assert codes == [422] * 5 + [429]


def test_limiter_windows():
    now = [0.0]
    lim = RateLimiter(per_minute=2, per_day=3, global_per_minute=100, clock=lambda: now[0])
    assert [lim.allow("k") for _ in range(3)] == [True, True, False]
    now[0] = 61  # minute window slid
    assert lim.allow("k") is True
    now[0] = 130
    assert lim.allow("k") is False  # daily cap (3) reached
    now[0] = 86_401
    assert lim.allow("k") is True


def test_limiter_global_bucket():
    lim = RateLimiter(per_minute=5, per_day=50, global_per_minute=3, clock=lambda: 0.0)
    assert [lim.allow(f"ip{i}") for i in range(4)] == [True, True, True, False]


def test_table_creation_is_idempotent(tmp_path):
    settings = Settings(data_dir=tmp_path, waitlist_admin_token=TOKEN)
    with TestClient(create_app(settings)) as c:
        join(c, "keep@example.com")
    with TestClient(create_app(settings)) as c:
        assert [e.email for e in rows(c)] == ["keep@example.com"]


def test_signup_log_is_masked(client, caplog):
    with caplog.at_level(logging.INFO):
        join(client, "ada@example.com")
    assert "a***@e***.com" in caplog.text
    assert "ada@example.com" not in caplog.text


def test_mask_email():
    assert mask_email("ada@mail.example.co.uk") == "a***@m***.uk"
    assert normalize_email("A@B.io") == "a@b.io"


# --- owner access -------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/admin/waitlist", "/admin/waitlist.csv"])
def test_admin_requires_token(client, path):
    join(client, "a@example.com")
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get(path, headers={"Authorization": TOKEN}).status_code == 401
    assert client.get(path, headers=AUTH).status_code == 200


@pytest.mark.parametrize("path", ["/admin/waitlist", "/admin/waitlist.csv"])
def test_admin_disabled_without_configured_token(tmp_path, path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as c:
        assert c.get(path).status_code == 404
        assert c.get(path, headers={"Authorization": "Bearer "}).status_code == 404


def test_no_public_listing_on_the_signup_path(client):
    assert client.get("/v1/waitlist").status_code == 405


def test_admin_list_newest_first_with_count(client):
    for i in range(3):
        join(client, f"user{i}@example.com", source="footer")
    r = client.get("/admin/waitlist", headers=AUTH)
    body = r.json()
    assert body["count"] == 3
    assert [e["email"] for e in body["entries"]] == [f"user{i}@example.com" for i in (2, 1, 0)]
    assert set(body["entries"][0]) == {"id", "email", "source", "createdAt", "ipHash"}
    assert r.headers["cache-control"] == "no-store"


def test_admin_csv_lists_entries(client):
    join(client, "one@example.com", source="hero")
    join(client, "two@example.com")
    r = client.get("/admin/waitlist.csv", headers=AUTH)
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    parsed = list(csv.DictReader(io.StringIO(r.text)))
    assert [p["email"] for p in parsed] == ["two@example.com", "one@example.com"]
    assert parsed[1]["source"] == "hero"
    assert list(parsed[0]) == ["id", "email", "source", "created_at", "ip_hash"]


def test_csv_neutralises_formula_injection(client):
    join(client, "+cmd@example.com", source='=HYPERLINK("http://evil","x")')
    join(client, "-1@example.com", source="@SUM(A1)")
    join(client, "ok@example.com", source='has,comma "quote"')
    parsed = {
        p["email"]: p
        for p in csv.DictReader(io.StringIO(client.get("/admin/waitlist.csv", headers=AUTH).text))
    }
    assert "'+cmd@example.com" in parsed
    assert parsed["'+cmd@example.com"]["source"] == '\'=HYPERLINK("http://evil","x")'
    assert parsed["'-1@example.com"]["source"] == "'@SUM(A1)"
    assert parsed["ok@example.com"]["source"] == 'has,comma "quote"'


def test_csv_cell():
    assert csv_cell("=1+1") == "'=1+1"
    assert csv_cell("\tx") == "'\tx"
    assert csv_cell("plain") == "plain"
    assert csv_cell(None) == ""

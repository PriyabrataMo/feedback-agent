import asyncio
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, parse_qsl, quote, urlparse

import boto3
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from moto import mock_aws

from app.config import S3Config, Settings
from app.main import create_app
from app.storage import (
    ByobConfig,
    LocalStorage,
    S3Storage,
    StorageConfigError,
    reset_storage_cache,
    storage_for,
)

BUCKET = "fa-test-bucket"
REGION = "us-east-1"


@pytest.fixture(autouse=True)
def aws_env(monkeypatch):
    for k in (
        "AWS_PROFILE",
        "AWS_SESSION_TOKEN",
        "S3_BUCKET",
        "S3_REGION",
        "S3_ENDPOINT_URL",
        "STORAGE_BACKEND",
    ):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    reset_storage_cache()
    yield
    reset_storage_cache()


@pytest.fixture
def s3():
    with mock_aws():
        boto3.client("s3", region_name=REGION).create_bucket(Bucket=BUCKET)
        yield S3Storage.managed(BUCKET, region=REGION)


def run(coro):
    return asyncio.run(coro)


def test_put_get_roundtrip_and_content_type(s3):
    run(s3.put_object("proj/sess/events/000001.ndjson", b"hello", "application/x-ndjson"))
    assert run(s3.get_object("proj/sess/events/000001.ndjson")) == b"hello"
    head = boto3.client("s3", region_name=REGION).head_object(
        Bucket=BUCKET, Key="proj/sess/events/000001.ndjson"
    )
    assert head["ContentType"] == "application/x-ndjson"


def test_get_missing_returns_none(s3):
    assert run(s3.get_object("nope/missing")) is None


def test_list_sorted_directory_semantics_and_pagination(s3):
    for i in (10, 2, 33, 1):
        run(s3.put_object(f"p/s/media/{i:06d}.webm", b"x", "video/webm"))
    run(
        s3.put_object("p/s2/media/000000.webm", b"x", "video/webm")
    )  # sibling with a shared name prefix
    assert run(s3.list("p/s")) == [f"p/s/media/{i:06d}.webm" for i in (1, 2, 10, 33)]
    assert run(s3.list("p/none")) == []


def test_list_over_1000_keys(s3):
    client = boto3.client("s3", region_name=REGION)
    for i in range(1005):
        client.put_object(Bucket=BUCKET, Key=f"big/{i:06d}", Body=b"")
    keys = run(s3.list("big"))
    assert len(keys) == 1005 and keys == sorted(keys)


def test_delete(s3):
    run(s3.put_object("a/b", b"1", "text/plain"))
    run(s3.delete("a/b"))
    assert run(s3.get_object("a/b")) is None
    run(s3.delete("a/b"))  # deleting a missing key is not an error


def test_key_prefix_applied_and_stripped():
    with mock_aws():
        boto3.client("s3", region_name=REGION).create_bucket(Bucket=BUCKET)
        st = S3Storage.managed(BUCKET, region=REGION, key_prefix="showbug")
        run(st.put_object("p/s/1", b"x", "text/plain"))
        raw = boto3.client("s3", region_name=REGION).list_objects_v2(Bucket=BUCKET)["Contents"]
        assert [o["Key"] for o in raw] == ["showbug/p/s/1"]
        assert run(st.list("p")) == ["p/s/1"]
        assert run(st.list("")) == ["p/s/1"]


@pytest.mark.parametrize("bad", ["", "/abs", "a/../b", "../x"])
def test_rejects_bad_keys(s3, bad):
    with pytest.raises(ValueError):
        run(s3.put_object(bad, b"x", "text/plain"))


def test_presign_put_url_shape_and_content_type_is_signed(s3):
    url = run(
        s3.presign_put("p/s/media/000001.webm", content_type="video/webm", expires_in_sec=300)
    )
    u = urlparse(url)
    q = parse_qs(u.query)
    assert u.scheme == "https" and u.netloc.startswith(f"{BUCKET}.s3")
    assert u.path == "/p/s/media/000001.webm"
    assert q["X-Amz-Expires"] == ["300"]
    assert q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert "content-type" in q["X-Amz-SignedHeaders"][0]
    assert "testing" not in url.replace("X-Amz-Credential=testing", "")  # secret never in URL


def test_presigned_put_and_get_work_end_to_end(s3):
    # moto intercepts `requests`/botocore, not httpx, so exercise the URLs through requests.
    import requests

    put = run(
        s3.presign_put("p/s/media/000001.webm", content_type="video/webm", expires_in_sec=300)
    )
    r = requests.put(put, data=b"chunk", headers={"Content-Type": "video/webm"})
    assert r.status_code == 200
    get = run(s3.presign_get("p/s/media/000001.webm", expires_in_sec=300))
    assert requests.get(get).content == b"chunk"


def _sigv4_query_signature(url: str, headers: dict[str, str], secret: str) -> tuple[str, str]:
    """
    (signature in the URL, signature S3 would compute for a PUT sent with `headers`).

    moto does not verify signatures, so a header mismatch passes every moto test and fails only on
    real S3. This redoes the check S3 does: rebuild the canonical request from what the browser
    sends, and re-derive the signature with the secret key. moto replaces the credentials inside
    `mock_aws()`, so read the secret from the environment there, not from `aws_env`.
    """
    u = urlparse(url)
    query = dict(parse_qsl(u.query, keep_blank_values=True))
    in_url = query.pop("X-Amz-Signature")
    signed = query["X-Amz-SignedHeaders"].split(";")
    sent = {k.lower(): " ".join(v.split()) for k, v in headers.items()} | {"host": u.netloc}
    unreserved = "-_.~"
    canonical = "\n".join(
        [
            "PUT",
            quote(u.path, safe="/" + unreserved),
            "&".join(
                f"{quote(k, safe=unreserved)}={quote(v, safe=unreserved)}"
                for k, v in sorted(query.items())
            ),
            "".join(f"{h}:{sent.get(h, '')}\n" for h in signed),
            ";".join(signed),
            "UNSIGNED-PAYLOAD",
        ]
    )
    scope = "/".join(query["X-Amz-Credential"].split("/")[1:])  # date/region/s3/aws4_request
    to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            query["X-Amz-Date"],
            scope,
            hashlib.sha256(canonical.encode()).hexdigest(),
        ]
    )
    key = f"AWS4{secret}".encode()
    for part in scope.split("/"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    return in_url, hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()


# What Chrome's MediaRecorder reports, and what the SDK used to send as Content-Type.
RECORDER_TYPE = "video/webm;codecs=vp8,opus"


def test_signature_binds_content_type_exactly(s3):
    secret = os.environ["AWS_SECRET_ACCESS_KEY"]
    url = run(
        s3.presign_put("p/s/media/000001.webm", content_type="video/webm", expires_in_sec=300)
    )
    in_url, recomputed = _sigv4_query_signature(url, {"Content-Type": "video/webm"}, secret)
    assert in_url == recomputed  # the verifier agrees with botocore
    in_url, recomputed = _sigv4_query_signature(url, {"Content-Type": RECORDER_TYPE}, secret)
    assert in_url != recomputed  # a codecs suffix is a different signed value: S3 would refuse it


def test_upload_url_headers_satisfy_the_signature(tmp_path, monkeypatch):
    """Regression: the SDK must send the headers the API signed, not the recorder's own type."""
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_BUCKET", BUCKET)
    monkeypatch.setenv("S3_REGION", REGION)
    h = {"X-Public-Key": "pk_dev_demo", "Origin": "http://localhost:3000"}
    with mock_aws():
        secret = os.environ["AWS_SECRET_ACCESS_KEY"]
        boto3.client("s3", region_name=REGION).create_bucket(Bucket=BUCKET)
        with TestClient(create_app(Settings(data_dir=tmp_path))) as c:
            created = c.post("/api/v1/sessions", headers=h, json={"url": "http://localhost:3000/"})
            r = c.post(
                f"/api/v1/sessions/{created.json()['sessionId']}/upload-url",
                headers=h,
                json={"seq": 0, "contentType": RECORDER_TYPE},
            )
    assert r.status_code == 200
    body = r.json()
    assert body["headers"] == {"Content-Type": "video/webm"}
    in_url, recomputed = _sigv4_query_signature(body["url"], body["headers"], secret)
    assert in_url == recomputed
    in_url, recomputed = _sigv4_query_signature(
        body["url"], {"Content-Type": RECORDER_TYPE}, secret
    )
    assert in_url != recomputed


def test_presign_get_shape(s3):
    url = run(s3.presign_get("p/s/x.webm", expires_in_sec=120))
    q = parse_qs(urlparse(url).query)
    assert q["X-Amz-Expires"] == ["120"] and "X-Amz-Signature" in q


def test_endpoint_url_uses_path_style():
    st = S3Storage.managed(BUCKET, region=REGION, endpoint_url="http://localhost:9000")
    url = run(st.presign_put("k/1", content_type="video/webm", expires_in_sec=60))
    u = urlparse(url)
    assert u.netloc == "localhost:9000" and u.path == f"/{BUCKET}/k/1"


def test_test_connection_success_leaves_no_probe_behind(s3):
    assert run(s3.test_connection()) == (True, None)
    assert run(s3.list("_probe")) == []


def test_test_connection_failure_missing_bucket():
    with mock_aws():
        st = S3Storage.managed("does-not-exist", region=REGION)
        ok, err = run(st.test_connection())
    assert ok is False
    assert "NoSuchBucket" in err and "bucket does not exist" in err


def test_test_connection_failure_access_denied():
    class Denied:
        def put_object(self, **kw):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "PutObject")

    st = S3Storage(BUCKET, lambda: Denied())
    ok, err = run(st.test_connection())
    assert not ok and "AccessDenied" in err and "access denied" in err


# --- BYOB ------------------------------------------------------------------------------------

BYOB = ByobConfig(
    bucket=BUCKET,
    region=REGION,
    role_arn="arn:aws:iam::123456789012:role/ShowbugAccess",
    external_id="ext-secret-123",
    key_prefix="showbug",
)


def test_byob_repr_hides_external_id():
    assert "ext-secret-123" not in repr(BYOB)


def test_byob_assume_role_roundtrip():
    with mock_aws():
        boto3.client("s3", region_name=REGION).create_bucket(Bucket=BUCKET)
        st = S3Storage.byob(BYOB)
        assert run(st.test_connection()) == (True, None)
        run(st.put_object("p/s/1", b"x", "text/plain"))
        assert run(st.list("p")) == ["p/s/1"]
        keys = [
            o["Key"]
            for o in boto3.client("s3", region_name=REGION).list_objects_v2(Bucket=BUCKET)[
                "Contents"
            ]
        ]
        assert keys == ["showbug/p/s/1"]
        # presigned URLs are signed by the temporary credentials
        q = parse_qs(urlparse(run(st.presign_get("p/s/1", expires_in_sec=60))).query)
        assert "X-Amz-Security-Token" in q


class FakeSts:
    def __init__(self, ttl_sec: int):
        self.calls: list[dict] = []
        self.ttl = ttl_sec

    def assume_role(self, **kw):
        self.calls.append(kw)
        return {
            "Credentials": {
                "AccessKeyId": f"ASIA{len(self.calls)}",
                "SecretAccessKey": "s",
                "SessionToken": "t",
                "Expiration": datetime.now(UTC) + timedelta(seconds=self.ttl),
            }
        }


def test_byob_passes_external_id_and_caches_credentials():
    sts = FakeSts(ttl_sec=3600)
    st = S3Storage.byob(BYOB, sts_client_factory=lambda: sts)
    for _ in range(3):
        run(st.presign_get("k", expires_in_sec=60))
    assert len(sts.calls) == 1
    assert sts.calls[0]["ExternalId"] == "ext-secret-123"
    assert sts.calls[0]["RoleArn"] == BYOB.role_arn
    assert sts.calls[0]["RoleSessionName"].startswith("showbug-")


def test_byob_refreshes_credentials_near_expiry():
    sts = FakeSts(ttl_sec=300)  # inside the refresh margin, so every call re-assumes
    st = S3Storage.byob(BYOB, sts_client_factory=lambda: sts)
    run(st.presign_get("k", expires_in_sec=60))
    run(st.presign_get("k", expires_in_sec=60))
    assert len(sts.calls) == 2


def test_byob_assume_role_denied_surfaces_trust_policy_hint():
    class DenySts:
        def assume_role(self, **kw):
            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "not authorized"}}, "AssumeRole"
            )

    st = S3Storage.byob(BYOB, sts_client_factory=lambda: DenySts())
    ok, err = run(st.test_connection())
    assert not ok and "trust policy" in err and "ext-secret-123" not in err


# --- storage_for -----------------------------------------------------------------------------


def _local(tmp_path):
    return LocalStorage(tmp_path / "objects", "secret")


def test_storage_for_defaults_to_local(tmp_path):
    local = _local(tmp_path)
    assert storage_for(local, "proj_dev") is local


def test_storage_for_s3_managed_cached(tmp_path):
    local = _local(tmp_path)
    settings = Settings(storage_backend="s3", s3=S3Config(bucket=BUCKET, region=REGION))
    a = storage_for(local, "p1", settings=settings)
    assert isinstance(a, S3Storage) and a.bucket == BUCKET
    assert storage_for(local, "p2", settings=settings) is a


def test_storage_for_reads_env(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_BUCKET", BUCKET)
    monkeypatch.setenv("S3_REGION", REGION)
    st = storage_for(_local(tmp_path), "p1")
    assert isinstance(st, S3Storage) and st.bucket == BUCKET


def test_storage_for_s3_without_bucket_errors(tmp_path):
    with pytest.raises(StorageConfigError):
        storage_for(_local(tmp_path), "p", settings=Settings(storage_backend="s3"))
    with pytest.raises(StorageConfigError):
        storage_for(_local(tmp_path), "p", settings=Settings(storage_backend="gcs"))


def test_storage_for_byob_overrides_backend(tmp_path):
    st = storage_for(_local(tmp_path), "p", byob=BYOB, settings=Settings(storage_backend="local"))
    assert isinstance(st, S3Storage) and st.bucket == BUCKET
    assert storage_for(_local(tmp_path), "p", byob=BYOB) is st

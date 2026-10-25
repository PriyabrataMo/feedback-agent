# S3 storage (managed and BYOB)

Code: `apps/api/app/storage/s3.py` (adapter), `apps/api/app/storage/__init__.py` (`storage_for`), `apps/api/app/config.py` (env). Design background: `docs/architecture.md` "Storage modes".

Browsers PUT media straight to the bucket with presigned URLs minted by the API. Small event segments are written server-side with `put_object`. Media bytes never pass through the API.

## How the backend is chosen

`storage_for(local_storage, project_id, *, byob=None, settings=None)`:

| Situation | Result |
|---|---|
| `byob` (a `ByobConfig`) passed for the project | customer bucket via STS AssumeRole + ExternalId, regardless of `STORAGE_BACKEND` |
| `STORAGE_BACKEND=s3` | managed bucket from env |
| `STORAGE_BACKEND=local` or unset | local disk adapter (dev) |

Callers that pass only `(local_storage, project_id)` keep working. Wiring `byob` from the projects table is not done yet: `Project` has no storage fields, so nothing passes `byob` today. When projects move to Postgres, build a `ByobConfig` from the project row and pass it.

S3 adapters (and their boto3 clients / assumed-role credentials) are cached per config. `reset_storage_cache()` clears them (tests).

## Environment (managed mode)

| Var | Meaning |
|---|---|
| `STORAGE_BACKEND` | `local` (default) or `s3` |
| `S3_BUCKET` | required when `s3` |
| `S3_REGION` | bucket region (needed for correct SigV4 presigning) |
| `S3_ENDPOINT_URL` | only for S3-compatible stores (MinIO, R2, localstack); switches to path-style URLs |
| `S3_KEY_PREFIX` | optional prefix inside the managed bucket (keys already start with the tenant prefix) |

Credentials are not config. boto3's default chain supplies them (env `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, shared profile, or the ECS/EKS/EC2 role). Prefer a role in production. Nothing logs credentials, and `ByobConfig.__repr__` masks the ExternalId.

BYOB role ARN, ExternalId, bucket, region and prefix are per project (`ByobConfig`), never global env.

## Managed bucket setup

1. Create a private bucket (Block Public Access on, default encryption SSE-S3 or KMS).
2. Give the API's role this policy (replace the bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::showbug-media/*"
    },
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::showbug-media"
    }
  ]
}
```

3. Add a lifecycle rule for retention (our rules in managed mode), and abort incomplete multipart uploads after 1 day.
4. Add the CORS block below.
5. Set `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION`.

## Bucket CORS (browser PUTs)

Needed on the managed bucket and on every BYOB bucket. Allow only the customer's app origins.

```json
[
  {
    "AllowedOrigins": ["https://app.customer.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply: `aws s3api put-bucket-cors --bucket BUCKET --cors-configuration file://cors.json` (wrap the array as `{"CORSRules": [...]}` for the CLI).

## Content-Type on presigned PUTs

The presign signs `Content-Type`, and the value is chosen by the API, not the browser: it is `video/webm` or `video/mp4`, never the recorder's own type (which carries codecs, for example `video/webm;codecs=vp9`). `upload-url` returns the exact headers to send as `headers` (`{"Content-Type": "video/webm"}`), and the SDK sends those, otherwise S3 returns `SignatureDoesNotMatch`. The `contentType` the SDK posts only decides webm versus mp4. No other headers are signed, so no `x-amz-*` headers are needed from the browser.

Until 2026-10-25 the SDK sent the recorder's type instead, which could never match; moto and the local backend do not check signatures, so nothing caught it. `tests/test_s3.py` now recomputes the SigV4 signature from the `upload-url` response to guard against it. That check is offline: no upload to real S3 has been made yet.

URL lifetime: `upload-url` uses 300 s. In BYOB mode a presigned URL also dies when the assumed-role session expires; credentials are refreshed when fewer than 15 minutes remain, so any URL we hand out is valid for at least its requested lifetime (up to 15 minutes).

## BYOB (customer bucket)

The customer creates, in their AWS account:

1. A bucket with the CORS block above.
2. An IAM role trusted by our AWS account, requiring our ExternalId.
3. A permissions policy scoped to one prefix.

We generate a per-project random `ExternalId` (store it server-side; show it to the customer once in the wizard; never reuse across projects).

### Trust policy (on the customer's role)

Replace `OUR_ACCOUNT_ID` with the AWS account (or the specific role ARN) the API runs as, and `EXTERNAL_ID` with the project's value.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::OUR_ACCOUNT_ID:root" },
      "Action": "sts:AssumeRole",
      "Condition": { "StringEquals": { "sts:ExternalId": "EXTERNAL_ID" } }
    }
  ]
}
```

Tighter: use `arn:aws:iam::OUR_ACCOUNT_ID:role/showbug-api` as the principal so only the API role can assume it. The API's own role needs `sts:AssumeRole` on `*` (or on the customer role ARNs).

### Permissions policy (on the customer's role)

Scoped to the prefix the customer chose (here `showbug/`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::CUSTOMER_BUCKET/showbug/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::CUSTOMER_BUCKET",
      "Condition": { "StringLike": { "s3:prefix": ["showbug/*"] } }
    }
  ]
}
```

`DeleteObject` is used for the connection probe and, only if the customer asks, cleanup. Drop it and the probe reports a failure; keep it unless you accept that.

The onboarding wizard should emit this as CloudFormation/Terraform too (not built yet).

### Project config passed to the adapter

```python
ByobConfig(
    bucket="CUSTOMER_BUCKET",
    region="eu-west-1",
    role_arn="arn:aws:iam::CUSTOMER_ACCOUNT:role/ShowbugAccess",
    external_id="<per-project secret>",
    key_prefix="showbug",   # must match the policy prefix
)
```

Session credentials last 1 hour and are cached in memory only.

## "Test connection" flow

For the BYOB wizard (and later a periodic health check):

1. Customer pastes bucket, region, role ARN, prefix. Server builds a `ByobConfig` with the project's ExternalId.
2. `ok, error = await storage_for(local, project_id, byob=cfg).test_connection()`.
3. The adapter assumes the role, writes `_probe/<ts>-<id>` under the prefix, reads it back, deletes it.
4. Returns `(True, None)` or `(False, message)`. Messages are short and credential-free, for example:
   - `AssumeRole denied: check the role's trust policy (our account id and ExternalId)`
   - `PutObject failed: AccessDenied - access denied (check the role/bucket policy and key prefix)`
   - `PutObject failed: NoSuchBucket - bucket does not exist (check name and region)`
5. CORS is not exercised by this probe (it is server-to-S3). The wizard should also tell the customer to verify CORS, or do a browser-side PUT test from the widget origin.

An admin route for this is not built (that file belongs to another work stream); the adapter method is ready.

## Local testing

Tests use moto (`cd apps/api && uv run pytest -q`), no network. For manual runs against MinIO/localstack set `STORAGE_BACKEND=s3 S3_ENDPOINT_URL=http://localhost:9000 S3_BUCKET=... S3_REGION=us-east-1` plus dummy `AWS_*` keys, create the bucket, and set its CORS.

## Not verified

Never run against real AWS: actual SigV4 presigned PUT from a browser with CORS, real STS AssumeRole with a customer trust policy, KMS-encrypted buckets (the role would need `kms:GenerateDataKey`/`kms:Decrypt`), and S3-compatible vendors. moto does not enforce IAM policies or trust policies, so those JSON blocks are untested.

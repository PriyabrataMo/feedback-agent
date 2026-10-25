# Auth0 identity plan

**Status: plan only, nothing built.** Decided by the user on 2026-10-25: use Auth0 for identity and multi-tenancy,
with machine-to-machine (M2M) where required. This plan replaces the custom-auth parts of `docs/tenancy.md`
(listed under [What changes in tenancy.md](#what-changes-in-tenancymd)). The tenant-isolation kernel itself
(scopes, guarded views, storage prefixes, quotas, purge) is **unchanged**.

**Interpretation to confirm.** "Auth0 for multi-tenancy" is read here as: Auth0 answers *who is this person*; our
database keeps answering *which organisations they belong to and with what role*. Auth0 Organizations is not
used yet (see [Why not Auth0 Organizations yet](#why-not-auth0-organizations-yet)). If you meant Auth0
Organizations as the source of membership, say so: it changes sections 2, 3 and 6.

Contents: [Split](#1-who-owns-what) · [Organizations](#why-not-auth0-organizations-yet) · [Flows](#2-architecture) ·
[Token rules](#3-token-verification-rules) · [Users](#4-user-lifecycle-invite-only) · [M2M](#5-m2m-inventory) ·
[Environments](#6-environments-and-tenants) · [Code changes](#7-data-model-and-code-changes) ·
[Phases](#8-phases) · [Tests](#9-test-plan) · [Free plan](#10-free-plan-limits-and-upgrade-triggers) ·
[Risks](#11-risks) · [Decisions](#12-open-decisions) · [Evidence](#13-evidence)

## 1. Who owns what

| Concern | Owner | Why |
|---|---|---|
| Login, password storage, reset, email verification, MFA, brute-force defence, later SSO | **Auth0** | Removes the highest-risk code we would otherwise write and run |
| Is this person a member of org X, and with which role | **Our MongoDB** (`memberships`) | Revocation is instant, the kernel stays unchanged, no 5-organization cap, no second source of truth |
| Org and project scopes, isolation, quotas, purge | **Our kernel** (`app/tenancy`, `app/db`) | Unchanged |
| SDK access (public key, Origin, session token) | **Ours** | Not user login; Auth0 is not in this path, so an Auth0 outage does not stop recording |
| Customer machines calling our API (exports, CI) | **Ours** (hashed API keys, later) | See [M2M inventory](#5-m2m-inventory) |
| Our backend provisioning, blocking or erasing Auth0 users | **Auth0 M2M** (Management API) | The one place a machine must call Auth0 |

### Why not Auth0 Organizations yet

- The Free plan allows 5 Organizations. One per customer would stop pilots at the fifth customer.
- Role Management is listed as not available on Free, so roles would live in our database anyway.
- Membership would exist in two places (Auth0 and `memberships`) and could disagree. A removed member must lose
  access on the next request; a database check does that, a token claim lives until the token expires.
- **Revisit** when a customer needs enterprise SSO: add an optional `orgs.auth0_org_id`, enable Organizations
  for that customer only (paid plan), and keep `memberships` as the authority.

## 2. Architecture

```
Browser ──► Dashboard server (Next.js, @auth0/nextjs-auth0)            Auth0 tenant (one per environment)
              │  Authorization Code + PKCE ──────────────────────────►  Universal Login
              │◄─ tokens stay server-side; the browser holds one httpOnly session cookie
              │  Authorization: Bearer <access token, aud = our API>
              ▼
           FastAPI ─ verify JWT (cached JWKS) ─► users[auth0_sub] ─► membership_check(org from URL) ─► OrgScope ─► handler
              │
              └─ M2M: client credentials, token cached ───────────────►  Management API (create / block / delete users only)

SDK in a customer page ─► X-Public-Key + Origin + session token ─► ProjectScope        (no Auth0 involved)
```

- The dashboard routes still send no CORS headers: the browser reaches them only through the dashboard server.
- The organisation still comes from the URL and is proven by a membership row, never from a token claim.
- A user with a valid token but no `users` row and no invite can call only `GET /me` (answers "no organisations")
  and `POST /invites/accept`.
- Host layout (proposal): `app.<domain>` dashboard, `api.<domain>` API, `login.<domain>` Auth0 custom domain
  (production only). The dashboard gets its own host so its session cookie is not shared with the marketing
  site and its waitlist form.

## 3. Token verification rules

Implemented once, in `app/tenancy/jwt_verify.py` (new). Every rule has a test.

1. Access token only. An ID token is refused (wrong `aud`).
2. Algorithm RS256 only. `none`, `HS*` and anything else is refused before any key lookup.
3. `iss` equals `https://<AUTH0_DOMAIN>/` exactly. `aud` contains `AUTH0_AUDIENCE`. `azp` equals the dashboard
   application's client id, so a token issued to a different application for the same API is refused.
4. `exp` and `nbf` enforced with 60 s leeway; `sub` required.
5. Key selection by `kid` from a cached JWKS. The JWKS URL comes from configuration, never from the token. An unknown
   `kid` triggers at most one refetch per minute. If a refetch fails, the last good key set is used for up to 24 h
   and then requests fail closed with 503.
6. **M2M tokens are refused on every user route.** A token whose `sub` ends in `@clients`, or whose `gty` is
   `client-credentials`, can never act as a user. There is no service-principal concept in the dashboard API.
7. Email and `email_verified` come from namespaced claims added by one Post-Login Action
   (`https://<api>/email`, `https://<api>/email_verified`), not from a `/userinfo` call per request.
8. Lifetime: access token 15 minutes, refreshed by the dashboard server. A disabled or blocked user is also
   stopped within one request by `users.status`, not only by token expiry.

## 4. User lifecycle (invite-only)

There is still **no public signup**. Auth0's database connection has public sign-ups disabled.

**First owner.** The operator CLI `create-org` (direct database, unchanged) creates the org and an `ivt_` invite
and prints the token once.

**Accepting an invite.** Proposed flow, with the one invariant that decides every detail: *accepting requires a
verified email equal to the invite's email, and any link that can set a password goes only to the invitee's
mailbox, never to the browser that presented the token.*

1. Invitee opens `https://app.<domain>/invite/<token>`.
2. `POST /invites/prepare` (public, token in body, rate-limited) checks the invite is pending and unexpired. If no
   Auth0 user exists for the invite's email, the API creates one through the Management API (M2M) with a random
   server-side password that is never shown, and emails a password-set link to that address. If a user already
   exists (member of another org) nothing is created.
3. The invitee sets a password from the emailed link and signs in through Universal Login.
4. `POST /invites/accept` with their access token and `{token}`. In one transaction: consume the invite
   (single atomic update, as today), upsert `users` by `auth0_sub`, create the membership. Refused unless
   `email_verified` is true and the email equals `invites.email_lc`.

Public sign-up on, with access gated only by membership, is simpler but rejected: anyone could create
accounts and make Auth0 send verification email to arbitrary addresses, and bot protection is a paid feature.

**Other lifecycle events**

| Event | What happens |
|---|---|
| Member removed from one org | `memberships` row deleted; access to that org ends on the next request. Auth0 untouched |
| Operator disables a person | `users.status = disabled` (checked every request), then Management API `blocked: true` and session revocation |
| Last membership gone and the person asks for erasure | Management API delete, then delete our `users` row. An org purge never deletes users (as today) |
| Email changes in Auth0 | `sub` is the identity; `email_lc` is informational and refreshed at login. It stops being unique |
| Forgotten password, MFA enrolment | Auth0's flows. We build none of it |

## 5. M2M inventory

M2M is used only where a machine must authenticate to Auth0 or to us on its own authority.

| Machine | Auth0 M2M? | Detail |
|---|---|---|
| **Our API → Auth0 Management API** | **Yes (required)** | One M2M application per environment, `showbug-api-mgmt`. Least-privilege scopes: `create:users`, `read:users`, `update:users`, `delete:users` (plus a ticket scope if the spike chooses tickets over email). Token cached in process until 5 minutes before expiry, single-flight refresh, honours `x-ratelimit-*` and 429. No API route proxies Management API calls |
| Dashboard server → our API | No | Carries the **user's** access token. Using M2M here would lose who the user is |
| Ticket worker, sweeper, purge | No | In-process jobs. No tokens, no HTTP |
| SDK | No | Public key plus session token, unchanged |
| **Customer systems → our API** (exports, CI) | **No, deliberately** | Our own hashed API keys (`sk_…`, 256-bit, SHA-256 stored, org-bound), the same pattern as `sst_` and `ivt_`. Auth0 M2M is quota-limited (1,000 tokens per month on Free) and needs a client per customer, and the kernel needs a principal that is already bound to one org |
| CI end-to-end tests | No | Dedicated test users in the dev and pre-prod tenants. The password grant is enabled on non-production tenants only. Production credentials never enter CI |
| Tenant configuration as code | Optional | `auth0-deploy-cli` or Terraform with an M2M client that has management scopes, run by an operator or a protected pipeline |

Token budget: the Free plan allows about 1,000 M2M tokens per month, and a community answer says
usage across all of one account's free tenants shares that pool. With caching, one process asks for roughly one
token a day, so three environments with two replicas is about 180 a month. Alert at 80%, because exhaustion blocks
invites. (Both figures are from community answers, not official documentation: confirm in the spike.)

## 6. Environments and tenants

Auth0's guidance is one tenant per environment; running several environments in one tenant shares rate limits.

| | dev | pre-prod | prod |
|---|---|---|---|
| Tenant | `showbug-dev` | `showbug-preprod` | `showbug` (tagged **Production** before go-live: rate limits depend on the tag) |
| Region | one region for all three, chosen once (it cannot be changed later) | same | same |
| API (resource server) | identifier = that environment's API origin, RS256, token lifetime 15 min | same | same |
| Dashboard application | regular web app; callbacks for that environment's dashboard host | same | same |
| M2M application | `showbug-api-mgmt` | same | same |
| Custom domain | none | none | `login.<domain>` (Free plan: 1, credit-card verification) |
| Email provider | custom SMTP/provider; a sink in dev | real provider | real provider |
| Test users | yes, password grant on | yes, password grant on | none |

Auth0's built-in email provider is for testing only (fixed sender, 10 emails per minute), so a real provider
(SES, Resend or similar) is needed before the first invite is sent outside the team. The same provider can send our
own invite emails.

**Configuration** (API unless noted; production-like refuses to start without all of them, `scripts/env_check.py`
gains these checks): `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_DASHBOARD_CLIENT_ID`, `AUTH0_MGMT_CLIENT_ID`,
`AUTH0_MGMT_CLIENT_SECRET`. Dashboard server: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
`AUTH0_SECRET`, `AUTH0_AUDIENCE`, `APP_BASE_URL`. Secrets live in the host's secret store, never in git; the
management secret is held only by the API.

**Local development and CI stay offline.** A development-only issuer (`scripts/dev-issuer`) serves a local JWKS and
mints tokens for seeded users. The API accepts a non-Auth0 issuer only when `APP_ENV` is development or test; a
test proves a production-like process refuses it. Tests build their own keys. Real Auth0 is exercised in pre-prod.

## 7. Data model and code changes

**`users`** (identity door): add `auth0_sub` (unique), `status` (`active` or `disabled`), `name`. Remove
`password_hash`, `failed_logins`, `locked_until`. `email_lc` becomes a non-unique index. Lookups are by `auth0_sub`
or `_id` only. **`auth_tokens`** and the `dbt_` token kind are removed, so the identity door shrinks to one collection.
Migration `m0002` does this.

**Dead code from the custom design** (confirm before deleting): `app/tenancy/passwords.py` and its tests
(207 lines, plus 393 lines in `test_tenancy_passwords.py`), the hasher and its concurrency gate, lockout, `POST /auth/login`
and `/auth/logout`, the planned `accounts.py` password paths. `tokens.py` keeps `sst` and `ivt`.

**New**

| Module | Purpose |
|---|---|
| `app/tenancy/jwt_verify.py` | The [token rules](#3-token-verification-rules). PyJWT with a JWKS cache, thin and fully testable. The official `auth0-fastapi-api` package is described as beta, so it is not used for now |
| `app/tenancy/auth0_mgmt.py` | M2M client: token cache, rate-limit handling, create, block and delete user, send password-set link |
| `app/tenancy/dashboard_auth.py` (rewritten) | verify JWT → `users` by `sub` → `membership_check` → `OrgScope` and role |
| `app/tenancy/invites.py` (reshaped) | create, prepare, accept, revoke |
| `app/tenancy/email.py` | one sender interface; SES or similar behind it |
| `scripts/dev-issuer` | local JWKS and token minting, development only |

**Web:** `@auth0/nextjs-auth0` v4 in the dashboard, mounted through `proxy.ts` (its docs list `proxy.ts` as valid
on Next 16: confirm in the spike). Add invite pages, token forwarding, the Origin check on every mutating request
that the tenancy doc already requires, and federated logout. `/demo` stays development-only.

### What changes in tenancy.md

For whoever owns that file (another session is editing it now): the Principals table (dashboard row and invitee
row); Threat T5 and T6 (scrypt and hasher gate no longer ours); Invariant I5 (credentials are verified JWTs, plus
hashed `sst`, `ivt`, `sk`); Data model (`users`, drop `auth_tokens`); Dashboard API (remove login and logout, add
`prepare`); Credentials section (dashboard tokens and passwords go, add Auth0 and M2M); Module map; Operations
(new environment variables, `create-org` output); Known gaps (login throttling is now Auth0's).

## 8. Phases

Sizes are rough: S about a day, M a few days, L about a week.

| # | Phase | Exit criteria |
|---|---|---|
| 0 | **Spike on a dev tenant (S–M).** Create the tenant, API, web app, M2M app. Confirm the [assumptions](#13-evidence) | `docs/auth0-spike.md` with what worked, and a go or no-go on the invite flow variant |
| 1 | **Verification kernel (M).** `jwt_verify.py`, dev issuer, full negative tests | Every rule in section 3 has a failing-then-passing test |
| 2 | **Identity model (M).** `m0002`, `dashboard_auth.py`, `GET /me`, remove password and lockout code, update architecture tests (identity door only from `dashboard_auth`/`accounts`) | Two-tenant tests pass with JWTs instead of `dbt_` tokens |
| 3 | **Invites and provisioning (M–L).** `auth0_mgmt.py`, prepare and accept, email sender, `create-org` CLI, audit events | Invite → password → login → membership works end to end against the dev tenant; replay and wrong-email cases refused |
| 4 | **Dashboard (L).** `nextjs-auth0`, invite pages, host split, session and logout behaviour | A signed-in member sees only their org's sessions; no cookie on the marketing host |
| 5 | **Environments (M).** Pre-prod and prod tenants as code, secrets, `env_check.py`, email provider, custom domain, Production tag | A fresh pre-prod deploy boots only with correct Auth0 settings |
| 6 | **Proof and hardening (M).** Extend the two-tenant proof to real tokens, add M2M quota alert, mirror auth events into `audit_events` | The proof passes in pre-prod |

Order matters: phases 1 and 2 are independent of Auth0's service and can start now; phase 0 decides the shape of
phase 3.

## 9. Test plan

- **Token verifier:** forged signature, `alg: none`, HS256 signed with the public key, wrong `iss`, wrong `aud`,
  wrong `azp`, expired, not-yet-valid, ID token presented as access token, M2M token on a user route, unknown
  `kid`, key rotation, JWKS endpoint down (cached keys then fail closed), garbage and oversized headers (refused
  before any network call).
- **Identity:** a valid token with no `users` row reaches nothing except `GET /me` and invite accept; a disabled
  user is stopped on the next request; a removed member loses the org immediately; two Auth0 identities with
  the same email do not merge.
- **Invites:** wrong email, unverified email, expired, revoked, replayed (second accept refused), concurrent
  accepts (one wins), token presented by someone else; no response ever contains a password-set link.
- **Management client:** token cached and refreshed once under concurrency, 429 and 5xx handling, secret never
  logged (extends the existing no-secret-in-logs test).
- **Isolation:** the existing two-tenant matrix, rerun with JWT principals.
- **Environment:** production-like refuses the dev issuer and missing Auth0 settings.

## 10. Free plan limits and upgrade triggers

From Auth0's pricing page: 25,000 monthly active users (same for B2C and B2B), 5 Organizations, 1 enterprise
connection, 1 custom domain, no Pro or Enterprise MFA, Role Management not available, 1-day log
retention, no log streaming, community support only.

| Limit | Effect on us | Upgrade when |
|---|---|---|
| MFA not offered (basic factors to be checked in the spike) | The weakest point for a product that records screens | Before a design partner with sensitive data signs in, either confirm a usable basic factor or upgrade |
| 1-day log retention, no streaming | Auth events vanish quickly | Day one: mirror login and accept events into our `audit_events`; upgrade only if that is not enough |
| 5 Organizations | Not used (membership is ours) | A customer needs enterprise SSO through Organizations |
| Community support only | No help during an outage | First paying customers |
| 1,000 M2M tokens per month | Management API only, cached | Never expected, unless customer machine access is moved to Auth0 |
| Auth0 startup program (one year of the B2B Professional plan, per Auth0's startup pages) | Would lift most limits | Worth applying early; eligibility terms unverified |

## 11. Risks

- **Auth0 outage:** dashboard login and invites stop; the SDK and recording keep working. Signed-in sessions last until their token expires.
- **Invite-only on Auth0 is awkward.** Community threads disagree on whether disabled sign-ups break invitation
  acceptance and on creating a user without a password. The plan creates users through the Management API with a random password and
  sends the password-set link ourselves; phase 0 must prove it.
- **Free-plan terms move.** Third-party sources disagree on the Free plan's monthly-active-user limit (Auth0's own pricing page says 25,000). Keep identity behind standard
  OIDC and the `sub`-to-user mapping so a provider swap touches `jwt_verify.py`, `auth0_mgmt.py` and the web
  integration only.
- **New subprocessor:** add Auth0 and the email provider to the subprocessor list required by `mvp-security-plan.md`; choose the tenant region with
  customer data residency in mind.
- **Wasted work:** the built password code is no longer needed (section 7).
- **Email deliverability** gates every invite; set up SPF, DKIM and DMARC for the sending domain.

## 12. Open decisions

1. Confirm the split in the interpretation note above (identity in Auth0, membership in our database).
2. Invite flow: create the Auth0 user through the Management API (recommended) or allow public sign-up and gate by invite.
3. Tenant region (permanent) and the hostnames in section 2.
4. Email provider, which also decides which AWS account hosts SES if SES is chosen (the S3 bucket needs the same decision).
5. Whether to delete the built password code now or after phase 2.
6. Whether to apply to Auth0's startup program before pilots.

## 13. Evidence

What the plan rests on, and how far each point was checked (2026-10-25).

| Claim | Basis | Confidence |
|---|---|---|
| Free plan: 25,000 monthly active users, same for B2C and B2B; 5 Organizations; no Pro or Enterprise MFA; Role Management not available; 1 custom domain; 1-day logs | [Auth0 pricing page](https://auth0.com/pricing), read through a summarising fetch | Good; other sources disagree on MAUs |
| About 1,000 M2M tokens per month, shared across an account's free tenants, Management API calls themselves not counted | Auth0 community answers, e.g. [Machine to Machine Authentication Limit on Free Plan](https://community.auth0.com/t/machine-to-machine-authentication-limit-on-free-plan/19365) | Medium: verify in the spike |
| Built-in email provider is test-only, 10 emails per minute | [Auth0 test SMTP page](https://auth0.com/docs/customize/email/configure-test-smtp-email-servers) | Good |
| One tenant per environment | [Auth0: set up multiple environments](https://auth0.com/docs/get-started/auth0-overview/create-tenants/set-up-multiple-environments.md) | Good. How many free tenants one account may hold was **not** confirmed |
| Invite-only sign-up quirks (disabled sign-ups, password required on Management API create) | Community threads, e.g. [prevent sign up but allow invitation acceptance](https://community.auth0.com/t/universal-login-prevent-sign-up-but-allow-invitation-acceptance/117671) | Low: phase 0 must prove the flow |
| `@auth0/nextjs-auth0` v4 works with `proxy.ts` on Next 16; `auth0-fastapi-api` is beta | Mirrored copies of Auth0's agent skills, not official docs | Low: check the SDK's own docs |
| Refresh-token rotation, basic MFA factors, Post-Login Actions (and how many) on Free | Not checked | Unknown: phase 0. The claims in section 3 rely on a Post-Login Action; if Free cannot run one, read the email from `/userinfo` instead |

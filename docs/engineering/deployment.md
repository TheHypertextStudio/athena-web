# Deployment — Cloudflare Workers + GCP Cloud Run

Docket uses a gated hybrid production topology backed by Neon Postgres. The product web app deploys
to Cloudflare Workers; the API, admin app, and scheduled/background work deploy to GCP Cloud Run. GitHub Actions
authenticates to GCP with Workload Identity Federation, runs migrations from the API image, and deploys only
after formatting, lint, types, tests, build, and browser E2E are green.

---

## Architecture

| Service        | Domain                     | Platform  | Notes                                                   |
| -------------- | -------------------------- | --------- | ------------------------------------------------------- |
| `docket` web   | `clearthedocket.com`       | Workers   | Next.js product + marketing; same-origin API/auth proxy |
| `docket-api`   | `api.clearthedocket.com`   | Cloud Run | Hono API, Better Auth, MCP, webhooks, cron endpoints    |
| `docket-admin` | `admin.clearthedocket.com` | Cloud Run | Next.js operator back office                            |

**Passkey RP ID:** `clearthedocket.com`. During the native passkey migration window,
`BETTER_AUTH_PASSKEY_LEGACY_RP_ID=hypertext.studio` mounts a separate assertion-only bridge
for credentials enrolled on the old RP. The Hypertext Studio site must publish the paid-team Docket
identifier directly from `hypertext.studio/.well-known/apple-app-site-association`. The old Docket
Web host can redirect because it is not the historical RP ID. Remove the legacy variable and old associated-domain
entitlement only after the signed-device migration canary and migration window finish. The full
security and removal contract lives in [Native credential integration](./specs/native-credentials.md).

All services use `--max-instances=10` and `--memory=512Mi`. Services scale to zero by default.
`docket-api` keeps one warm instance while `LINEAR_AGENT_ENABLED=true` so Linear's five-second
[webhook acknowledgement and first-response deadlines](https://linear.app/developers/agent-interaction)
do not depend on a cold start.

### Lattice staging boundary

The protected Workers frontend is `https://docket-staging.hypertext.studio`.
Its passkey RP ID is that exact hostname. The staging API
must run as a separate `docket-api-staging` Cloud Run service with `APP_MODE=staging`, its own
Neon schema-only branch, and separate `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, and
`CREDENTIALS_ENCRYPTION_KEY` secrets. Never copy production Docket account or grant rows into
that branch. Do not point the staging frontend at `api.clearthedocket.com`.

Set the API's `WEB_URL` to the Workers origin, place that origin first in
`BETTER_AUTH_TRUSTED_ORIGINS`, and include the exact frontend and native API
hostnames in `BETTER_AUTH_ALLOWED_HOSTS`. Keep `BETTER_AUTH_URL` at the staging
API origin. Leave `BETTER_AUTH_COOKIE_DOMAIN` unset: the existing same-origin
Worker gateway forwards `/api/auth`, so the browser receives host-only frontend
cookies. Retain the prior public configuration for reversal. Passkeys enrolled
on the old Vercel RP require the existing recovery/sign-in path and reenrollment;
changing configuration does not migrate their credentials.

Staging uses real OAuth, Lattice, and mail adapters. The `local` and `test` modes use mocks and
cannot establish a staging round trip. Set its public Lovelace client ID to
`https://docket-staging.hypertext.studio/.well-known/lattice-client.json` only
after Lovelace can fetch and verify that public document without a staff login.
Keep the rest of the preview protected. Preserve the previous actual identity
in `LATTICE_LEGACY_CLIENT_ID` before switching. The metadata document must
publish the staging API callback. Lovelace's issuer, gateway, and the existing Studio daemon may
be shared as the external device under test; their grant in staging belongs only to the staging
Docket account. Disable optional Docket integrations unless their staging credentials and callback
URLs are configured. Set `ATHENA_ASYNC_RUNNER_ENABLED=false` unless a separate staging runner and
both directional HMAC secrets exist.

Before calling staging accepted, read back the Cloud Run service environment and secret bindings,
verify the Neon branch has no production account rows, fetch the public Lattice client metadata,
and complete Settings link → Studio selection → interactive Athena reply → one durable assignment
and sealed proposal. Correlate the Docket request, Lattice work ID, Studio daemon, and LM Studio
inference. A health check or a successful deploy alone is insufficient.

### Manual Lattice acceptance audit

The `Lattice acceptance audit` workflow reuses the production environment's deployment WIF identity
to read the two recorded October 3 production assignments or the two September 30 staging fixtures.
It accepts only `production` or `staging`, resolves each deployed service's actual secret references,
and runs parameterized reads inside a read-only PostgreSQL transaction. It does not refresh OAuth,
link an account, approve a proposal, or change runtime configuration. Its seven-day artifact contains
IDs, status, return counts, and credential timing metadata; it excludes tokens, sealed keys, literal
environment values, and provider payloads. Decoded JWT claims are inspection metadata, not signature
verification. Missing log-read permission is reported without changing IAM.

Dispatch from main with `gh workflow run lattice-acceptance-audit.yml -f target=production` (or
`staging`). This workflow has no schedule or push trigger: one dispatch starts one Ubuntu runner,
normally 3–5 minutes, with a ten-minute timeout. Its limited dependency install and explicit manual
trigger keep this evidence collection outside the every-push release graph.

The separate `Lattice staging hygiene` manual workflow rejects only the two audited synthetic
proposals through the existing approval service. It checks the synthetic owner, workspace, task,
session, work, and action identities, and verifies that rejection clears reply keys without changing
task fields or inserting comments. It then rotates the existing `docket-staging-resend-api-key`
Secret Manager secret and pins that version on staging. It never grants IAM permissions. The
prepared sending-only replacement is supplied through the temporary production environment secret
`DOCKET_STAGING_MAIL_REPLACEMENT`, which the operator removes after the run. Its report contains
only fixture metadata, operation status, the mounted version, and production revision/binding
stability. A failed mail operation does not undo the independent proposal rejection. This workflow
also has no schedule or push trigger and uses one ten-minute-capped Ubuntu runner per dispatch.

---

## One-time bootstrap

Run once per GCP project. Idempotent — safe to re-run.

```bash
pnpm bootstrap
```

When the infrastructure already exists and only production providers need configuration, use the
short provider-only path:

```bash
pnpm bootstrap -- --skip-local --production --skip-infrastructure
```

Prompts for: GCP project ID, region, GitHub repo (`owner/repo`), passkey domain, Neon credentials. Then:

1. Enables GCP APIs: Cloud Run, Artifact Registry, Secret Manager, IAM, IAM Credentials
2. Creates service account `docket-deploy` with the four roles listed in [GCP resources](#gcp-resources)
3. Creates Artifact Registry repository `docket`
4. Creates WIF pool `github` + OIDC provider `github-actions`, bound to your specific repo
5. Creates Secret Manager secrets: `docket-database-url`, `docket-auth-secret`, `docket-cron-secret`,
   then grants the Cloud Run runtime identity `roles/secretmanager.secretAccessor` on each secret
6. Lets the operator select the environment and providers before resolving provider URLs or opening
   unrelated consoles
7. Reads latest cloud secret payloads without printing them, preserves ready values, and identifies
   missing, placeholder, or inaccessible fields for repair
8. Guides each provider through short console steps, then shows one reviewed write point per provider
9. Validates credentials before the first cloud write, writes them to Secret Manager, and publishes
   `API_SECRET_BINDINGS`
10. Writes a `.env.local` skeleton with independent generated development secrets

The production infrastructure pass provisions private API artifacts and the Turbo cache client
identity/signing-key distribution described below. `--skip-infrastructure` skips these resources.
The cache Worker and private R2 bucket deploy separately through the native Cloudflare commands in
[the cache package](../../apps/turbo-cache/README.md#deployment).

### Prerequisites

The bootstrap script checks for these and exits if any are missing or unauthenticated:

| Tool      | Install                                                           | Auth check          |
| --------- | ----------------------------------------------------------------- | ------------------- |
| `gcloud`  | [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install) | `gcloud auth login` |
| `gh`      | [cli.github.com](https://cli.github.com)                          | `gh auth login`     |
| `openssl` | `brew install openssl`                                            | —                   |
| `docker`  | [docs.docker.com](https://docs.docker.com/get-docker/)            | —                   |

---

## Production bootstrap and rollout

1. Authenticate locally with `gcloud auth login`; every command must pass
   `--project=athena-services --region=us-central1` rather than changing the global project.
2. Create `docket-database-url-unpooled` in Secret Manager. The deploy workflow runs migrations
   from the exact API image before deploying that image to Cloud Run.
3. Bootstrap sets the production GitHub environment variables `API_URL`, `WEB_URL`, `ADMIN_URL`,
   `PASSKEY_RP_ID`, `BETTER_AUTH_ALLOWED_HOSTS`, `GOOGLE_OAUTH_PUBLIC`, and
   `API_SECRET_BINDINGS`; the integrations wizard collects `GOOGLE_OAUTH_TEST_EMAILS` as a
   separate Docket access-policy value after the Google Console flow.
4. Keep `GOOGLE_OAUTH_PUBLIC=false` and set
   `GOOGLE_OAUTH_TEST_EMAILS=willieechalmers@gmail.com` while Google verification is pending.
5. Configure the Hypertext Studio Mapbox account through `pnpm integrations -- --production
--provider=mapbox`. Confirm that the account can store permanent geocoding results before adding
   `MAPBOX_ACCESS_TOKEN`. The wizard writes `docket-mapbox-access-token` to Secret Manager and adds
   its Cloud Run binding.
6. Publish the validated backend commit through the ordinary main release workflow. CI migrates
   the database, deploys the API, verifies health/session/signup routes, refreshes Scheduler jobs,
   and deploys admin. Keep all backend release gates intact.
7. Publish the frontend separately through the approved native production Worker operation with
   matching public build inputs and runtime bindings. Follow
   [Workers operations](workers-compatibility.md#production-and-recovery); backend success alone
   does not accept or publish the frontend.

Cloudflare owns frontend domain administration and the independently configured API/admin DNS.
Read back the exact managed Custom Domain, zone, Worker/environment and selected version after
an approved change. Preserve backend, Publishing and legacy association routes and their records.
Do not restore retired Vercel frontend DNS or ownership TXT records as a deployment prerequisite.
Keep managed-domain provisioning separate from restricted Worker build/deploy credentials and
configuration. Cloudflare SSL/TLS remains **Full** for the existing proxied Cloud Run origins;
frontend cutover does not alter their origin routing.

---

## GitHub Actions reference

### Variables (`vars.*`)

Set by `pnpm bootstrap`. Add missing ones with `gh variable set NAME --body "VALUE" --repo owner/repo`.

| Variable                           | Set by                             | Description                                                                                                               |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`                   | bootstrap                          | GCP project ID (e.g. `my-project-123`)                                                                                    |
| `GCP_REGION`                       | bootstrap                          | Deployment region (e.g. `us-central1`)                                                                                    |
| `GCP_SERVICE_ACCOUNT`              | bootstrap                          | Full SA email: `docket-deploy@<project>.iam.gserviceaccount.com`                                                          |
| `GCP_WIF_PROVIDER`                 | bootstrap                          | Full WIF provider resource name: `projects/<num>/locations/global/workloadIdentityPools/github/providers/github-actions`  |
| `GCP_TURBO_CACHE_WIF_PROVIDER`     | bootstrap                          | Dedicated cache federation provider; kept separate from application deployment WIF                                        |
| `GCP_TURBO_CACHE_SERVICE_ACCOUNT`  | bootstrap                          | Dedicated cache invoker: `docket-turbo-cache-client@<project>.iam.gserviceaccount.com`                                    |
| `TURBO_API`                        | bootstrap                          | Private Workers/R2 endpoint: `https://turbo-cache.hypertext.studio`                                                       |
| `TURBO_TEAM`                       | bootstrap                          | `docket`; an artifact namespace within the shared Studio cache                                                            |
| `GCS_BLOB_BUCKET`                  | bootstrap (production environment) | Private API artifact bucket: `<project>-docket-artifacts`                                                                 |
| `PASSKEY_RP_ID`                    | bootstrap/manual                   | WebAuthn relying-party domain. Production uses `clearthedocket.com`.                                                      |
| `BETTER_AUTH_PASSKEY_LEGACY_RP_ID` | manual                             | Temporary previous RP for native passkey migration. Unset removes the bridge.                                             |
| `NEON_PROJECT_ID`                  | bootstrap                          | Neon project ID (from Neon console)                                                                                       |
| `API_URL`                          | manual (post-deploy)               | Public custom-domain origin of `docket-api`                                                                               |
| `WEB_URL`                          | manual (post-deploy)               | Public custom-domain origin of the production web Worker                                                                  |
| `ADMIN_URL`                        | manual (post-deploy)               | Public custom-domain origin of `docket-admin`                                                                             |
| `BETTER_AUTH_ALLOWED_HOSTS`        | manual                             | Canonical web, API, and admin hosts plus old hosts during the migration window.                                           |
| `GOOGLE_OAUTH_PUBLIC`              | manual                             | `false` during review; `true` only after Google approval                                                                  |
| `GOOGLE_OAUTH_TEST_EMAILS`         | manual                             | Staged Docket user allowlist, initially `willieechalmers@gmail.com`                                                       |
| `GCP_API_RUNTIME_SERVICE_ACCOUNT`  | bootstrap                          | Runtime identity for `docket-api`: `docket-api@<project>.iam.gserviceaccount.com`. Unset ⇒ Cloud Run's default compute SA |
| `ADMIN_GOOGLE_SSO_ENABLED`         | manual                             | `false` until the Workspace groups exist AND the runtime SA can read them; `true` enables console Google sign-in          |
| `ADMIN_GOOGLE_GROUP_ROLES`         | manual                             | CSV of `group-email:staff-role` pairs, e.g. `docket-support@…:support,docket-admins@…:superadmin`                         |
| `GOOGLE_WORKSPACE_DOMAIN`          | manual                             | Workspace domain operator sign-in is confined to                                                                          |
| `WORK_LOCATION_PROJECTION_ENABLED` | manual                             | `false` during canonical bootstrap; `true` enables outbound linked-account projection                                     |
| `LINEAR_AGENT_ENABLED`             | manual                             | `false` until the signed Linear Agent sandbox matrix passes; `true` enables install, webhook, and relay surfaces          |
| `API_SECRET_BINDINGS`              | bootstrap                          | Non-secret multiline Cloud Run env-to-Secret Manager mapping; includes only configured providers                          |

### Secrets (`secrets.*`)

| Secret                             | Set by    | Description                                                                                                                  |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NEON_API_KEY`                     | bootstrap | Neon API key — used by `neon-branch.yml` to create/delete PR preview branches                                                |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | bootstrap | HMAC signing key, synchronized from the cache's pinned Secret Manager version; supplied only to trusted main cache workflows |

---

## GCP resources

Everything created by `pnpm bootstrap`:

| Resource                          | Name / Path                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Service account                   | `docket-deploy@<project>.iam.gserviceaccount.com`                                                                            |
| SA roles                          | `roles/run.developer`, `roles/artifactregistry.writer`, `roles/secretmanager.secretAccessor`, `roles/iam.serviceAccountUser` |
| Artifact Registry                 | `<region>-docker.pkg.dev/<project>/docket`                                                                                   |
| WIF pool                          | `projects/<project>/locations/global/workloadIdentityPools/github`                                                           |
| WIF provider                      | `…/providers/github-actions` (OIDC, scoped to your GitHub repo)                                                              |
| Secret Manager: database URL      | `docket-database-url`                                                                                                        |
| Secret Manager: migration URL     | `docket-database-url-unpooled`                                                                                               |
| Secret Manager: auth secret       | `docket-auth-secret` (generated by bootstrap)                                                                                |
| Secret Manager: cron secret       | `docket-cron-secret` (generated by bootstrap)                                                                                |
| Cloud Run: API                    | `docket-api`                                                                                                                 |
| Cloud Run: admin                  | `docket-admin`                                                                                                               |
| GCS: API artifacts                | `<project>-docket-artifacts`; private, uniform access, public access prevention, soft delete disabled                        |
| R2: Turbo cache                   | `studio-turbo-cache`; private Standard storage, native 14-day expiration                                                     |
| Worker: Turbo cache               | `studio-turbo-cache`; direct R2 binding and short-lived Google OIDC                                                          |
| Cache client service account      | `docket-turbo-cache-client@<project>.iam.gserviceaccount.com`                                                                |
| Secret Manager: cache signing key | `docket-turbo-cache-signing-key`; client-only signing-key distribution                                                       |

---

## Private storage and signed Turbo cache

The Hypertext Studio plugin provides the discoverable `remote-cache-doctor` skill and its native-CLI
setup/diagnostic script. Its [runbook](https://github.com/TheHypertextStudio/product-standards/tree/main/skills/remote-cache-doctor)
explains credentials, costs, diagnosis and repair; this repository's native configuration remains
canonical for deployment values.

The production bootstrap provisions private API storage and cache-client identity/signing-key
distribution through `scripts/bootstrap/gcp-storage.ts`, using native `gcloud` and `gh` commands.
The cache package owns its native Cloudflare deployment and R2 lifecycle configuration; follow
[its deployment commands](../../apps/turbo-cache/README.md#deployment) with the Studio account.
Existing resources and signing keys are preserved.

The API runs as `docket-api@athena-services.iam.gserviceaccount.com` and receives
`GCS_BLOB_BUCKET=athena-services-docket-artifacts`. Its bucket grants that runtime identity
`roles/storage.objectUser` at bucket scope. The adapter uses Application Default Credentials;
there is no downloaded service-account key or storage access token. Objects remain private, and
application routes authorize access before returning their bytes. Stored `gs://` locators are not
public download links. Retained artifacts have no automatic age cleanup. When moving existing
storage, copy every retained object and verify bytes and database references before retiring the
old store or its credentials.

The Turbo cache runs at `https://turbo-cache.hypertext.studio` as the `studio-turbo-cache`
Cloudflare Worker with a direct private R2 binding. Its protocol/storage implementation is based
on the pinned MIT-licensed upstream recorded in `apps/turbo-cache/UPSTREAM.md`; the managed
adaptations provide Google OIDC authentication, exact registered-client namespace isolation and private
streaming responses. No upload or download passes through Google Cloud or Vercel.

The Worker verifies RS256 Google ID tokens against Google's JWKS, the exact endpoint audience,
expiry and the registered cache-client service-account numeric subject. CI impersonates that
identity through the exact WIF subject `repo:TheHypertextStudio/athena-web:ref:refs/heads/main`.
Local operators receive Token Creator only on that identity. The Worker has no static access token,
S3 key or signing secret. R2 is accessed through its binding, and artifact tags are preserved in
object metadata for Turbo clients to verify with HMAC.

The pinned `TheHypertextStudio/release-engineering/actions/turbo-cache` action mints an audience-bound token immediately before each cacheable task. Callers supply `GCP_TURBO_CACHE_WIF_PROVIDER`, `GCP_TURBO_CACHE_SERVICE_ACCOUNT`, `TURBO_API`, and `TURBO_TEAM`; application deployment keeps its own `GCP_WIF_PROVIDER`.

`apps/turbo-cache/cache-clients.json` registers each Studio namespace and its distinct identity, repository trust and signing-key reference. Docket uses `docket`, Curfew web uses `curfew-web`, LogDate web uses `logdate-web`, and private Product Admin uses `studio-product-admin` with its own exact-main WIF provider. No client can read or write another client's artifact prefix. See the plugin runbook for registration and local setup.

Untrusted refs remain local-only and receive neither the cache token nor the HMAC key. Trusted
main with incomplete cache configuration stays local-only; it cannot mint a cache token. Native `turbo.json` defaults select the Studio endpoint and `docket` namespace;
`TURBO_API` and `TURBO_TEAM` can override those addresses for a separately provisioned cache.

The R2 Standard bucket is private and applies native 14-day expiration. There is no cleanup cron,
Cloud Run cache instance, Google cache bucket or public bucket URL. Storage/read/write usage
shares the account's R2 allowance; R2 and Workers charge no Internet egress. This design targets
zero additional cost within existing allowances, not unlimited free service. Cloudflare's current
zone limit bounds uploads to 100 MB; larger artifacts cannot be uploaded through this endpoint.
Cache writes stream directly to R2 and reads stream back without buffering entire artifacts.

The existing `docket-turbo-cache-signing-key` Secret Manager entry distributes the client HMAC key
to local operators; GitHub holds the same value in `TURBO_REMOTE_CACHE_SIGNATURE_KEY`. Bootstrap
reuses the key without rotating it. The Worker never reads it. A missing Google copy alongside an
existing unknown GitHub value is preserved rather than silently rotating the key.

For local cache access, authenticate the Studio account and mint a short-lived token using native
commands in the current shell:

```sh
export TURBO_API=https://turbo-cache.hypertext.studio
export TURBO_TEAM=docket
export TURBO_REMOTE_CACHE_SIGNATURE_KEY="$(gcloud secrets versions access latest \
  --secret=docket-turbo-cache-signing-key --project=athena-services \
  --account=willie@hypertext.studio)"
export TURBO_TOKEN="$(gcloud auth print-identity-token \
  --account=willie@hypertext.studio \
  --impersonate-service-account=docket-turbo-cache-client@athena-services.iam.gserviceaccount.com \
  --audiences="$TURBO_API" --include-email)"
export TURBO_CACHE=local:rw,remote:rw
pnpm turbo run build --filter=@docket/turbo-cache
```

Do not print or commit either value. Google ID tokens expire after one hour; mint a fresh token
when needed. Local-only work can set `TURBO_CACHE=local:rw` and unset both secret variables.

Cache acceptance requires two real Turbo runs of the same cacheable task/hash using distinct
empty local caches, a remote HIT, restored matching output and native R2 object readback. Check
wrong-principal/expired-token rejection, missing or invalid signature rejection, namespace isolation
and a streamed artifact larger than 32 MiB. `CI` is part of the task hash, so local and CI artifacts
can intentionally differ.

---

## Runtime environment

### API service

Runtime env vars are split between Secret Manager (sensitive) and Cloud Run env vars (non-sensitive). See `deploy.yml` jobs `deploy-api` for the full list.

**From Secret Manager** (injected by Cloud Run at startup through bootstrap's
`API_SECRET_BINDINGS` manifest):

| Secret                       | Env var               |
| ---------------------------- | --------------------- |
| `docket-database-url`        | `DATABASE_URL`        |
| `docket-auth-secret`         | `BETTER_AUTH_SECRET`  |
| `docket-cron-secret`         | `CRON_SECRET`         |
| `docket-mapbox-access-token` | `MAPBOX_ACCESS_TOKEN` |

The deployment runner reads `docket-database-url-unpooled` and passes it to the migration process as
`DATABASE_URL_UNPOOLED`; the pooled application URL must not be used for schema migrations.
Configured provider secrets are appended to the same manifest under their canonical runtime env
names. Legacy `docket-github-client-*` secrets remain readable as `GITHUB_APP_CLIENT_*` until the
guided GitHub App flow rotates them to canonical secret names.

Production API startup requires a real `MAPBOX_ACCESS_TOKEN`. Local and test modes use the
deterministic geocoder and do not call Mapbox. The deploy secret gate rejects a missing,
inaccessible, or placeholder Mapbox binding before Cloud Run changes. The browser never receives
this token.

**From Cloud Run env vars** (set at deploy time from GitHub `vars.*`):

`NODE_ENV`, `APP_MODE`, `API_URL`, `WEB_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_ALLOWED_HOSTS`,
`BETTER_AUTH_PASSKEY_RP_ID`, `BETTER_AUTH_PASSKEY_LEGACY_RP_ID`,
`BETTER_AUTH_PASSKEY_RP_NAME`,
`APPLE_APP_CLIENT_ID`,
`GOOGLE_CALENDAR_WEBHOOK_URL`, `GOOGLE_OAUTH_PUBLIC`, `GOOGLE_OAUTH_TEST_EMAILS`,
`ADMIN_GOOGLE_SSO_ENABLED`, `ADMIN_GOOGLE_GROUP_ROLES`, `GOOGLE_WORKSPACE_DOMAIN`,
`BILLING_ENABLED`, `BILLING_RECONCILIATION_MODE`,
`STRIPE_SINGLE_SUBSCRIPTION_REDIRECT_VERIFIED_AT`, and `MCP_TASKS_ENABLED`.
The production `API_SECRET_BINDINGS` manifest supplies Stripe credentials, the Docket Pro lookup
key and price id, and the portal configuration id under their canonical runtime names.

The MCP OAuth authorization server is **on by default in every deploy** — it needs no MCP-specific
client-list variables. `MCP_ISSUER_URL`, `MCP_RESOURCE_URL`, and `OIDC_LOGIN_PAGE_URL` derive
mechanically from `API_URL`/`WEB_URL` (`packages/env/src/api.ts`); set one only to override its
derivation (for example, a non-standard sign-in route). When a request includes an `Origin`, the
protocol boundary validates the origin itself; client vendors are not configured in deployment.

Stripe product, price, portal, and webhook configuration is reconciled by `pnpm integrations` in
test mode before production. The same standard workflow writes the reviewed live credentials and
non-secret product values to the production targets; there is no manual Vercel configuration path.

### Transactional email and notification delivery providers

Passwordless account creation requires transactional email in production. Docket uses Resend's
native HTTPS API on the existing verified `service.hypertext.studio` sending domain so root-domain
Google Workspace mail routing remains unchanged:

| Env var          | Production value/source                                           |
| ---------------- | ----------------------------------------------------------------- |
| `RESEND_API_KEY` | `docket-resend-api-key` → domain-restricted Resend sending key    |
| `MAIL_FROM`      | `docket-mail-from` → `Docket <no-reply@service.hypertext.studio>` |

Both are Secret Manager values mounted by the API deployment. Missing mail configuration is a
startup error in production; the service must never claim to send verification codes through an
in-memory capture adapter.

The notification service always writes durable intents, recipient snapshots, delivery rows, web
inbox rows, preferences, contact points, and inbound-event rows. External delivery adapters light
up only when their provider env is real-shaped; blank, `mock`, `placeholder`, or `changeme` values
select capture adapters.

| Channel | Env vars                                                                | Runtime behavior                                                                         |
| ------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Email   | Production: `RESEND_API_KEY`, `MAIL_FROM`; local: `SMTP_*`, `MAIL_FROM` | Production requires Resend HTTPS; local uses Mailpit when configured, otherwise capture. |
| SMS     | `SMS_ENDPOINT`, `SMS_API_KEY`, `SMS_FROM`                               | All three select the HTTP SMS adapter; otherwise `CaptureSmsSender` is used.             |
| Push    | `PUSH_ENDPOINT`, `PUSH_API_KEY`, `PUSH_APP_ID`                          | All three select the HTTP push adapter; otherwise `CapturePushSender` is used.           |

The generated `API_SECRET_BINDINGS` manifest injects email values collected by the integration
wizard into Cloud Run. SMS and push are not wizard providers yet; configure their complete variable
sets separately before enabling those adapters.

Provider callbacks land under `/internal/notifications/*`:

| Route                                        | Purpose                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `POST /internal/notifications/events/email`  | Email delivery, bounce, complaint, and unsubscribe events.            |
| `POST /internal/notifications/events/sms`    | SMS delivery and STOP/START events.                                   |
| `POST /internal/notifications/events/push`   | Push delivery and invalid-token events.                               |
| `POST /internal/notifications/inbound/email` | Email replies correlated to the original notification where possible. |
| `POST /internal/notifications/inbound/sms`   | SMS replies correlated to the original notification where possible.   |

Callbacks must include `x-docket-signature`, an HMAC-SHA256 over the raw JSON body formatted either
as raw hex or `sha256=<hex>`. The route currently defaults to `BETTER_AUTH_SECRET` as the signing
secret; if a provider-specific secret is introduced later, wire it through
`createInternalNotificationRoutes(secret)` and update this deployment section in the same change.

Quiet hours and user category/channel preferences are enforced before external sends. Web delivery
is always the canonical in-product record; email/SMS/push are sibling delivery rows whose status is
visible to the staff notification monitor and compactly hinted in the user's inbox row.

### Next.js services (Workers web, Cloud Run admin)

`NEXT_PUBLIC_*` vars are **baked into each bundle at build time**. Supply the reviewed web inputs
explicitly to the native Worker build, matching the public production Wrangler bindings; the admin
image receives them as Docker build arguments. They cannot be changed without rebuilding.

---

## PR preview databases

`neon-branch.yml` runs on every pull request:

- **Opened / reopened / synchronised:** creates a Neon branch `preview/pr-<N>-<branch>`, runs `pnpm db:migrate` against it, expires in 14 days.
- **Closed:** deletes the Neon branch.

The branch database URL is available as a workflow output (`db_url`, `db_url_with_pooler`) for downstream jobs that need a disposable database (e.g. E2E tests against a preview deploy).

---

## Production migrations

The reusable deployment workflow builds the immutable API image, reads the unpooled migration URL
from Secret Manager without logging it, and runs the migration entry point inside that exact image.
An unsuccessful migration automatically blocks API and admin deployment. Separately approved
frontend publication must require acceptance of its compatible backend and schema before attaching
production domains. Migrations must be additive and must first pass against a fresh PGlite database
plus a disposable Neon branch. Never roll production schema backward during an application
rollback; route traffic to the prior compatible revision instead.

Before migration, inspect for duplicate `(user_id, provider_id, account_id)` account rows. Migration
`0029` intentionally stops on duplicates rather than deleting credentials ambiguously.

## Operations

### Verifying the documentation site after a release

`/docs` is not a route in `apps/web`. It resolves only through the `next.config.ts` rewrites to
`DOCS_MINTLIFY_ORIGIN` (`https://docket.mintlify.dev` — the proxy origin Mintlify publishes the
"Host at" subpath from, not `docket.mintlify.app`, which serves from its root and 404s every
proxied path). Whether it works is therefore a deployment fact, not a property any test can hold:
both branches of `docsRewrites()` are covered and both stayed green through a period when the
configured origin named a hostname with no DNS record and every `/docs` page answered
`502 BAD_GATEWAY` on the live domain.

`.github/workflows/verify-docs.yml` closes that gap by asking the running site. It runs after every
production release (called from `deploy-main.yml`) and once a day on a schedule, and it can be
dispatched by hand. The daily trigger is the one that catches what a release-triggered check cannot:
that outage came from a project-configuration change rather than a commit, so nothing would have
run until the next push to main.

Only the documentation checks fail the run. The rest of the public surface — app, API health and
config, OpenAPI, Scalar, OAuth and MCP metadata, one immutable asset — is reported alongside them as
advisory, so an unrelated API-contract regression does not turn a release red for shipping working
docs. Run the same thing locally:

```bash
pnpm launch:verify-docs
```

This post-deployment/scheduled workflow observes the currently published frontend, independently
of backend publication. A failure reports broken live delivery; it does not replace release gates
or authorize a deployment. `pnpm launch:verify-prod` remains the on-demand pass that checks the
whole surface.

### Viewing logs

```bash
gcloud run services logs read docket-api --region=<REGION> --project=<PROJECT_ID> --limit=50
```

Scheduler state:

```bash
gcloud scheduler jobs describe docket-sync-calendars --location=<REGION> --project=<PROJECT_ID>
```

### Forcing a redeploy without a code change

```bash
git commit --allow-empty -m "chore: force redeploy" && git push
```

### Checking a project for drift

```bash
GCP_PROJECT_ID=<project> GCP_REGION=<region> GITHUB_REPOSITORY=<owner/repo> pnpm doctor
```

Read-only. Compares the live project against what `pnpm bootstrap` provisions — enabled APIs,
service accounts, project and organization IAM, Artifact Registry, Workload Identity, the GitHub
variables the deploy reads, and whether the API runs as its own account rather than the project's
default compute account. Expectations are imported from `scripts/bootstrap.ts` rather than restated,
so the two cannot disagree.

A check whose boundary could not be read reports `UNKNOWN`, not `FAIL`: an expired `gh` token makes
every variable look absent, and calling that drift would name the wrong cause. Only a definite
difference fails. The same check runs in `deploy.yml` before the rollout.

### Rolling back

Traffic-only. Migrations are additive by policy precisely so the previous revision keeps working
against the newer schema — never roll the schema backward.

Migration `0130` creates the authority records that bind OAuth credentials to one resource and
record live revocation. A revision from before that migration's application support is not a safe
API rollback target. That revision ignores the retained grant state and can accept or issue an
unbound credential after a user revoked access. Keep a Task 2-or-newer token verifier and OAuth
lifecycle wrapper active during a rollback. If no compatible revision is ready, disable OAuth
issuance, MCP bearer access, and REST bearer access before shifting traffic. Cookie-session routes
may remain available. Do not treat the nullable additive columns as proof that the old binary is
security-compatible.

```bash
GCP_PROJECT_ID=<project> pnpm rollback --service docket-api          # list revisions + traffic
GCP_PROJECT_ID=<project> pnpm rollback --service docket-api --to <revision>
```

Listing marks each revision `ready` or `NOT READY`, so a failed deploy is visible as a revision
that exists but never became healthy. The rollback refuses a revision that does not exist, one that
never became ready, and one already serving all traffic — the three mistakes that are easiest to
make while something is broken. API deployments also stamp immutable revisions with
`docket-oauth-grants=v1`. The rollback command refuses an API revision without that marker, which
prevents an operator from bypassing the resource-grant boundary described above. Add `--dry-run`
to print the `gcloud` command instead of running it.

### Rotating a Secret Manager secret

```bash
# Write new version
echo -n "new-value" | gcloud secrets versions add docket-auth-secret \
  --project=<PROJECT_ID> --data-file=-

# Cloud Run picks up the latest version on the next deploy (`:latest` pin in deploy.yml).
# To take effect immediately without a code deploy, update the Cloud Run service:
gcloud run services update docket-api --region=<REGION> --project=<PROJECT_ID>
```

### Adding a new runtime env var to the API

1. Add the var to the `env_vars:` block in the `deploy-api` job in `.github/workflows/deploy.yml`.
2. If it's sensitive, create the Secret Manager secret and add it to the `secrets:` block instead.
3. Push to `main` — the next deploy picks it up.

### OAuth connector providers (GitHub / Linear / Google)

Connectors (and social sign-in) only work when the provider's OAuth client id **and** secret are
present and real — `buildAuthOptions` mounts each provider only when `isRealValue()` is true, so a
missing/`placeholder` value leaves the provider cleanly **un**mounted (no fake "connected"). The
six vars (`{GOOGLE,GITHUB,LINEAR}_CLIENT_{ID,SECRET}`, all optional, API-only) are already wired:
their Secret Manager secrets exist (seeded with `placeholder`) and the `deploy-api` `secrets:`
block injects them as `:latest`. So the deploy is green today with connectors honestly dormant.

**To activate a provider**, register an OAuth app, then replace its placeholder secret value(s)
and redeploy. Browser linking uses the product origin so Better Auth's session cookie remains
first-party through the frontend's same-origin gateway:

| Provider | Register at                                                  | Callback URL                                                   | Secrets to set                                                                                                                               |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub   | GitHub → Settings → Developer settings → GitHub Apps         | `https://docket.hypertext.studio/api/auth/callback/github`     | `docket-github-app-client-id`, `docket-github-app-client-secret`; connector additionally needs App ID, slug, private key, and webhook secret |
| Linear   | Linear → Settings → API → OAuth applications                 | `https://docket-api.hypertext.studio/api/auth/callback/linear` | `docket-linear-client-id`, `docket-linear-client-secret`, `docket-linear-webhook-secret`                                                     |
| Google   | Google Cloud Console → APIs & Services → Credentials → OAuth | `https://docket.hypertext.studio/api/auth/callback/google`     | `docket-google-client-id`, `docket-google-client-secret`                                                                                     |

```bash
# Prefer the reviewed, environment-aware writer so values are classified and bound correctly:
pnpm integrations -- --env production --provider github

# Pick up the new :latest values (either re-run the deploy workflow, or update in place):
gcloud run services update docket-api --region=us-central1 --project=athena-services
```

Google sign-in requests only `openid email profile`. Connector actions add scopes incrementally:

| Connector | Scopes                                              |
| --------- | --------------------------------------------------- |
| Calendar  | `calendar.calendarlist.readonly`, `calendar.events` |
| Tasks     | `tasks`                                             |
| Drive     | `drive.readonly`                                    |
| Gmail     | `gmail.modify`                                      |

Keep the external consent screen in **Testing**, list `willieechalmers@gmail.com` as a test user,
and keep `GOOGLE_OAUTH_PUBLIC=false` until brand, sensitive-scope, restricted-scope, and required
security-assessment reviews are approved. The public home, privacy, and terms URLs must be entered
in Google Cloud. Existing plaintext Google bearer tokens are invalidated by migration `0029` and
surface as needs-reauth; the next consent stores encrypted tokens.

Linear's OAuth application webhook is separate from its OAuth credential. Configure it to send at
least Issue events to `https://docket-api.hypertext.studio/internal/ingest/linear`, then store the
signing secret shown on the webhook detail page as `docket-linear-webhook-secret`. Mount it on the
API as `LINEAR_WEBHOOK_SECRET=docket-linear-webhook-secret:latest`. `pnpm integrations` collects and
writes this value for local, staging, or production without placing it in the repository. Create the
Secret Manager entry before adding the Cloud Run mount: referencing a missing secret fails deploy.

### Operator SSO — Google Workspace groups gate the admin console

The operator console (`docket-admin`) accepts a Google Workspace sign-in alongside its passkey
flow, and Workspace **group membership** decides the staff tier. Google only establishes identity;
the `staff_user` row remains the sole runtime authority, and `staffMiddleware` never calls Google.

Two things write that row: the OAuth callback (so a sign-in takes effect immediately) and the
`docket-staff-google-sync` Cloud Scheduler job every 15 minutes. **The cron is what makes
revocation real** — sessions last 30 days, so without it, removing someone from a group would not
lock them out of the console until their session happened to expire.

`pnpm bootstrap` does all of this — it prompts for the Workspace domain, creates the groups,
grants the IAM role, and writes the variables. The steps below are what it does, for a project
that was bootstrapped before operator SSO existed and is being brought up to date by hand:

1. `pnpm bootstrap` creates the runtime service account `docket-api@<project>.iam.gserviceaccount.com`
   and publishes it as `vars.GCP_API_RUNTIME_SERVICE_ACCOUNT`. The deploy workflow then passes
   `--service-account`, so the API stops running as the broadly-privileged default compute account.
2. Create the groups you want to map, as **security** groups. The group type is load-bearing, not
   cosmetic: the IAM role in step 3 governs security groups only, and the same lookup against a
   discussion-forum group answers `PERMISSION_DENIED`.

   ```bash
   gcloud identity groups create docket-support@<domain> --organization=<org-id> \
     --group-type=security --display-name="Docket operators — support"
   ```

   Repeat for `docket-finance@` and `docket-admins@`. Add people with
   `gcloud identity groups memberships add --group-email=… --member-email=…`. Note that whoever
   creates a group is automatically a member of it.

3. `pnpm bootstrap` grants the runtime service account `roles/cloudidentity.groupsReader` on the
   organization, which is all the read access the lookup needs — there is no Workspace admin
   console step, no admin role to assign, no domain-wide delegation, and no admin user to
   impersonate. It also enables `cloudidentity.googleapis.com`. To grant it by hand:

   ```bash
   gcloud organizations add-iam-policy-binding <org-id> \
     --member="serviceAccount:docket-api@<project>.iam.gserviceaccount.com" \
     --role="roles/cloudidentity.groupsReader" --condition=None
   ```

4. Set `GOOGLE_WORKSPACE_DOMAIN` and `ADMIN_GOOGLE_GROUP_ROLES` **on the `production`
   environment**, not at repository scope — `pnpm bootstrap` writes every policy value there, and
   an environment variable shadows a repository one of the same name, so a repo-scoped value looks
   correct in the UI while the deploy keeps reading the environment's:

   ```bash
   gh variable set GOOGLE_WORKSPACE_DOMAIN --env production --body "<domain>" --repo <owner/repo>
   ```

   Then flip `ADMIN_GOOGLE_SSO_ENABLED=true` (also `--env production`) **last** — the console hides the Google button until the API
   reports it configured, so an operator never sees a button that cannot work. Both values are
   load-bearing: with either missing the sync grants nothing at all, which is deliberate — an
   unset domain would otherwise widen operator SSO to every Google account on earth.

Two safety properties worth knowing before you rely on this:

- **A manually granted operator is never auto-revoked.** `staff_user.managed_by` distinguishes
  `manual` from `google_group`, and the sync only ever touches the latter. Keep at least one
  `manual` superadmin with a passkey — that is your way back in when the Workspace configuration
  is itself what broke. The sync additionally refuses to revoke or demote the last superadmin.
- **Nothing revokes on a failure.** A directory outage, or a malformed `ADMIN_GOOGLE_GROUP_ROLES`,
  leaves every row exactly as it was. Only a _successful_ lookup that returns no matching group
  revokes, so one typo in a deployment variable cannot empty the operator table.

The live lookup authenticates through the GCP metadata server, so it answers only on Cloud Run.
Locally, leave `ADMIN_GOOGLE_SSO_ENABLED=false` and use `STAFF_BOOTSTRAP_EMAILS` as before.

### Retired provider compatibility

Slack is not an active provider. Historical integration records and adapter code may remain
readable for compatibility, but new Slack connections, setup prompts, OAuth callbacks, webhook
mounts, and secret bindings are intentionally disabled. Do not create Slack app credentials or
raise the API minimum instance count for Slack. Re-enabling it requires an explicit product change
that restores the provider catalog, runtime routes, setup flow, deployment configuration, and tests
together.

### Sign in with Apple — web and native

Apple is a sign-in provider for the web and native clients. It does **not** follow the id+secret
pattern. The native app sends Apple's ID token and its raw nonce to Better Auth, while the web flow
uses the Services ID and callback. Both paths use the same Docket account and session.

Two things make Apple different:

- **No static client secret.** Apple's `client_secret` is a short-lived ES256 JWT the API **mints at
  boot** from the `.p8` key (`generateAppleClientSecret`), so there is no `APPLE_CLIENT_SECRET` to
  store. You supply four **durable** vars instead — `APPLE_CLIENT_ID` (the **Services ID**, e.g.
  `com.docket.web`), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the downloaded `.p8`) —
  and the provider mounts only when **all four** are real (`isRealValue`).
- **HTTPS-only + form_post callback.** Apple rejects `localhost`/non-HTTPS and posts the callback
  from `appleid.apple.com`; `buildAuthOptions` adds that origin to `trustedOrigins` automatically
  when Apple is configured, so no extra origin var is needed.

Use the provider-only bootstrap path for an existing production deployment:

```bash
gcloud auth login
gh auth status
pnpm integrations -- --env production --provider apple
```

The wizard confirms the Google Cloud account, project, GitHub account, repository, and environment
before it writes anything. Complete the Apple console checkpoint in this order:

1. Open **Certificates, Identifiers & Profiles → Identifiers → App IDs**. Create or open the
   explicit App ID `studio.hypertext.docket`. Enable **Associated Domains** and **Sign in with
   Apple**. Open the Sign in with Apple configuration and select **Enable as a primary App ID**.
2. Open **Identifiers → Services IDs**. Create `studio.hypertext.docket.web`. Enable **Sign in with
   Apple**, select `studio.hypertext.docket` as the primary App ID, and register the bare web and API
   hostnames. Production uses `clearthedocket.com` and `api.clearthedocket.com`.
3. Register both production return URLs:
   `https://clearthedocket.com/api/auth/callback/apple` and
   `https://api.clearthedocket.com/api/auth/callback/apple`. Save the modal, continue, and save the
   Services ID itself. Staging needs its own HTTPS hostnames and callback URLs on the same Services
   ID before a staging canary can work.
4. Open **Keys**, create a key named `Docket Sign In`, enable **Sign in with Apple**, configure it
   for the `studio.hypertext.docket` primary App ID, and register it. Record the 10-character Key ID
   and download the `.p8` immediately. Apple permits one download. Keep the file outside the
   repository.
5. Open **Services → Sign in with Apple for Email Communication**. Register the domain that sends
   production account mail. Docket currently uses `service.hypertext.studio`; Apple must report its
   existing SPF or DKIM record before private-relay addresses can receive Docket mail.
6. Give the wizard `studio.hypertext.docket.web` as `APPLE_CLIENT_ID`, `studio.hypertext.docket` as
   `APPLE_APP_CLIENT_ID`, the paid team's 10-character Team ID as `APPLE_TEAM_ID`, the new Key ID as
   `APPLE_KEY_ID`, and the complete `.p8` contents as `APPLE_PRIVATE_KEY`.
7. Review the wizard's write summary. It creates or rotates the four server secrets in Secret
   Manager, grants the Cloud Run runtime access to each secret, writes `APPLE_APP_CLIENT_ID` as a
   GitHub environment variable, and regenerates `API_SECRET_BINDINGS`. Do not hand-edit the binding
   manifest for a normal setup.
8. Deploy a validated `main` commit. Confirm that `GET /v1/config` lists `apple` and returns
   `appleAppClientId: "studio.hypertext.docket"`. Then test web sign-in and native sign-in on signed
   hardware. Apple returns name and email only on the first authorization, so use a fresh canary or
   revoke Docket under Apple Account sign-in settings when the first-use payload must be retested.

The bootstrap stores these four server values:

```bash
# Emergency manual recovery only. Prefer `pnpm integrations` above.
printf '%s' 'studio.hypertext.docket.web' | gcloud secrets create docket-apple-client-id --project=athena-services --replication-policy=automatic --data-file=-
printf '%s' '<TEAM_ID>'       | gcloud secrets create docket-apple-team-id     --project=athena-services --replication-policy=automatic --data-file=-
printf '%s' '<KEY_ID>'        | gcloud secrets create docket-apple-key-id      --project=athena-services --replication-policy=automatic --data-file=-
# The .p8 is multiline; store it verbatim (a file), NOT one line — Cloud Run injects it as-is:
gcloud secrets create docket-apple-private-key --project=athena-services --replication-policy=automatic --data-file=AuthKey_XXXX.p8

# Add these lines to the production `API_SECRET_BINDINGS` GitHub environment variable:
#      APPLE_CLIENT_ID=docket-apple-client-id:latest
#      APPLE_TEAM_ID=docket-apple-team-id:latest
#      APPLE_KEY_ID=docket-apple-key-id:latest
#      APPLE_PRIVATE_KEY=docket-apple-private-key:latest
# Deploy main so Cloud Run mounts them.
```

> Publishing `API_SECRET_BINDINGS` **before** the secrets exist breaks the deploy because Cloud Run
> cannot mount a missing secret. Create the secrets first. Apple returns the user's email only on
> the first authorization; Better Auth persists it then.

### Native Google Sign-In

`pnpm integrations -- --env production --provider google` creates or imports the web OAuth client.
That web client ID is also `GIDServerClientID`, because Better Auth verifies it as the native ID
token audience. The iOS app also needs a public iOS OAuth client in the same Google Cloud project:

1. Open **Google Auth Platform → Clients** in the project selected by the bootstrap preflight.
2. Create an **iOS** client named `Docket iOS` with bundle ID `studio.hypertext.docket`. Google does
   not issue a client secret for this client.
3. Copy its client ID into `GOOGLE_IOS_CLIENT_ID`. Derive `GOOGLE_REVERSED_CLIENT_ID` by reversing
   the dot-separated client ID exactly as Google shows in its downloaded plist. Set
   `GOOGLE_SERVER_CLIENT_ID` to the web client ID that the bootstrap stored as `GOOGLE_CLIENT_ID`.
4. Supply all three values together when building a different environment. The wrapper rejects a
   partial override:

   ```bash
   GOOGLE_IOS_CLIENT_ID='<ios-client>.apps.googleusercontent.com' \
   GOOGLE_REVERSED_CLIENT_ID='com.googleusercontent.apps.<ios-client>' \
   GOOGLE_SERVER_CLIENT_ID='<web-client>.apps.googleusercontent.com' \
   scripts/build-environment.sh staging -destination 'platform=iOS Simulator,name=iPhone 17'
   ```

5. Keep `GOOGLE_OAUTH_PUBLIC=false` until the native canary is ready. A signed-out native client
   cannot apply an email allowlist before Google identifies the person, so production will not
   publish `googleServerClientId` under that gate. Set `GOOGLE_OAUTH_PUBLIC=true`, deploy, confirm
   `/v1/config` returns the web client ID, and run the Google ID-token, restoration, and sign-out
   canaries. Set the gate back to `false` immediately if the exchange fails.

### Scheduled jobs (Cloud Scheduler)

Cloud Run is scale-to-zero, so there is no in-process worker — scheduled work is driven by
**Cloud Scheduler** POSTing to a secret-guarded cron endpoint on the API. Each endpoint checks
`CRON_SECRET` (sent as `Authorization: Bearer …` or `x-cron-secret`) and is idempotent.

| Endpoint (all under `/internal/cron/`) | Purpose                                                                                                                                             | Cadence (as provisioned) |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `sync-connectors`                      | Re-mirror every due connector integration (`task_sync` purpose on the leased spine)                                                                 | every 15 min             |
| `email-suggestions`                    | Email-to-task ingest: cursored mailbox pull → funnel → Athena synthesis → suggestions, for every opted-in mail integration (`email_ingest` purpose) | every 15 min             |
| `process-events`                       | Drain inbound webhook events into canonical events (fires automation rules)                                                                         | every 5 min              |
| `daily-digests`                        | Email each opted-in user's end-of-day summary at their local time                                                                                   | every 15 min             |
| `lifecycle-sweep`                      | Advance orgs through the data-lifecycle deletion state machine (also expires/purges resolved email suggestions from M7)                             | daily 03:00              |
| `account-deletion-sweep`               | Purge accounts past their 14-day grace window                                                                                                       | daily 03:30              |
| `account-export-sweep`                 | Generate pending personal-data exports + email the link                                                                                             | every 10 min             |
| `sync-calendars`                       | Re-sync every connected user's calendars, drain the write outbox, renew push watches                                                                | every 10 min             |
| `sync-work-locations`                  | Bootstrap linked accounts, converge canonical work-location edits, drain projection writes, renew watches                                           | every 10 min             |
| `run-linear-agent-sessions`            | Drive queued Linear Agent session runs and relay the activity back to Linear                                                                        | every 5 min              |
| `expired-sessions-sweep`               | Delete session rows past their `expiresAt` (Better Auth only prunes lazily)                                                                         | hourly                   |
| `expired-drafts-sweep`                 | Delete saved composer drafts past their `expiresAt` (six months after the last edit; reads already leave them out)                                  | daily at 03:30           |
| `staff-google-sync`                    | Reconcile operator access against Google Workspace groups; revoke members removed from a mapped group                                               | every 15 min             |
| `athena-triggers`                      | Run due user-owned triggers, collect Lattice results, and recover missed submissions (user triggers retain their five-minute minimum)               | every 1 min              |
| `elicitation-deadlines`                | Auto-answer derivable overdue Athena questions, park the rest                                                                                       | every 5 min              |
| `search-index`                         | Drain durable search-projection jobs from entity writes and backfills                                                                               | every 5 min              |
| `legacy-mentions`                      | Convert prose still holding the legacy shortcode mention form (self-limiting)                                                                       | hourly at :15            |
| `unfurl-resources`                     | Resolve titles/icons/previews for pending referenced URLs                                                                                           | every 5 min              |
| `directive-posture`                    | Recompute each configured Hub's daily posture and notify subscribed clients only on change                                                          | every 5 min              |
| `day-cadence`                          | Materialize each configured Hub's check-ins, re-cut a drifted day's remainder, fire every check-in that has come due                                | every 5 min              |

All production jobs are provisioned **as code** by `scripts/scheduler-setup.ts`, the single source of
truth. It runs automatically after every API deploy (the `Ensure Cloud Scheduler jobs` step in
the `deploy-api` job) and can be run by hand. The script is idempotent — it `describe`s each job
and `update`s or `create`s it — and reads the secret from `docket-cron-secret` (never logged).
The Cloud Run services are `--allow-unauthenticated`, so each job authenticates purely with the
`x-cron-secret` header (no OIDC / `run.invoker`).

```bash
# Preview the exact gcloud commands without touching GCP (secret redacted):
DRY_RUN=1 GCP_PROJECT_ID=<PROJECT_ID> GCP_REGION=<REGION> \
  API_URL="https://<docket-api-host>" \
  SCHEDULER_API_URL="https://<cloud-run-service>.run.app" pnpm scheduler:setup

# Provision/update for real (needs an authenticated gcloud):
GCP_PROJECT_ID=<PROJECT_ID> GCP_REGION=<REGION> \
  API_URL="https://<docket-api-host>" \
  SCHEDULER_API_URL="https://<cloud-run-service>.run.app" pnpm scheduler:setup
```

Production resolves `SCHEDULER_API_URL` from the deployed `docket-api` Cloud Run service. The
public `API_URL` remains the browser-facing origin. Cloud Scheduler targets Cloud Run directly so a
long connector pass can use the configured 600-second deadline instead of the public proxy's
shorter request timeout.

Staging runs only `docket-staging-athena-triggers` from the same definitions. This keeps
unrelated staging cron routes idle while allowing durable Athena assignments to submit and
settle. Provision or update that one job with:

```bash
GCP_PROJECT_ID=<PROJECT_ID> GCP_REGION=<REGION> \
  STAGING_SCHEDULER_API_URL="https://<docket-api-staging-service>.run.app" \
  pnpm exec tsx scripts/scheduler-setup.ts --staging-athena
```

The staging job reads `docket-staging-cron-secret`. Its bytes must be usable unchanged in an
HTTP header: the setup script rejects a secret with a line break instead of silently trimming
it. After changing that secret, deploy a new staging Cloud Run revision so its `CRON_SECRET`
binding reads the new value. The one-minute cadence adds up to 1,440 staging invocations per day
(five times the former cadence) and no hosted validation workflow. Production has the same
one-minute Athena job cadence. New personal Lattice assignments submit directly after the durable
row commits; the job recovers interrupted submissions and collects results without waiting for
the former five-minute window.

`pnpm bootstrap` enables `cloudscheduler.googleapis.com` and grants the deploy service account
`roles/cloudscheduler.admin`, so CI may manage the jobs. (Re-run bootstrap on an existing
project to apply these.) Cloud Scheduler must be available in the chosen `GCP_REGION`.

The table above is not decoration: `scripts/scheduler-setup.ts` warns on every provisioning run
when a route in `apps/api/src/routes/cron.ts` has no job (it never runs in prod) or a job targets
a route that does not exist (it POSTs a 404 forever), and `repo-tests/tooling/scheduler-setup.test.ts`
asserts the full path set so adding one without the other fails CI. When you add a cron route,
add its `JOBS` entry and its row here in the same commit.

> If these scheduler jobs do not exist in an environment, connectors do **not** auto-sync there —
> manual "Sync now" and the honest-status flows still work, but background mirroring is dormant.
> The proactive day cadence is dormant with them: check-ins are only materialized and fired by
> `day-cadence`, so without it a day gets no check-ins and no automatic re-cut.
> The connector's `syncCadenceMinutes` (default 60) gates which integrations a given sweep
> actually re-syncs, so the scheduler can safely run more often than any single integration's
> cadence.

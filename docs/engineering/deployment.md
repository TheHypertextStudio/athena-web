# Deployment — Vercel + GCP Cloud Run

Docket uses a gated hybrid production topology backed by Neon Postgres. The product web app deploys
to Vercel; the API, admin app, and scheduled/background work deploy to GCP Cloud Run. GitHub Actions
authenticates to GCP with Workload Identity Federation, runs migrations from the API image, and deploys only
after formatting, lint, types, tests, build, and browser E2E are green.

---

## Architecture

| Service        | Domain                          | Platform  | Notes                                                   |
| -------------- | ------------------------------- | --------- | ------------------------------------------------------- |
| `docket` web   | `docket.hypertext.studio`       | Vercel    | Next.js product + marketing; same-origin API/auth proxy |
| `docket-api`   | `docket-api.hypertext.studio`   | Cloud Run | Hono API, Better Auth, MCP, webhooks, cron endpoints    |
| `docket-admin` | `docket-admin.hypertext.studio` | Cloud Run | Next.js operator back office                            |

**Passkey RP ID:** `hypertext.studio` — the shared registrable suffix across the production web and admin hosts.

All services: `--min-instances=0` (scale to zero), `--max-instances=10`, `--memory=512Mi`.

> **Exception once Slack is activated:** run `docket-api` with `--min-instances=1`. Slack's
> Events API requires a 200 within 3 seconds and disables an app's deliveries at >5% failures
> over 60 minutes — a scale-to-zero cold start regularly blows that deadline. (See
> `docs/engineering/specs/slack-integration.md`.)

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
5. Creates Secret Manager secrets: `docket-database-url`, `docket-auth-secret`, `docket-cron-secret`
6. Shows metadata-only status for all integrations and lets the operator select missing providers
7. Guides one provider-console action at a time, with browser opening, back/retry/skip/exit controls
8. Writes credentials atomically to Secret Manager and publishes `API_SECRET_BINDINGS`
9. Writes a `.env.local` skeleton with independent generated development secrets

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
   `API_SECRET_BINDINGS`; the Google guide collects `GOOGLE_OAUTH_TEST_EMAILS`.
4. Keep `GOOGLE_OAUTH_PUBLIC=false` and set
   `GOOGLE_OAUTH_TEST_EMAILS=willieechalmers@gmail.com` while Google verification is pending.
5. Keep the `docket` Vercel project's Git integration enabled for `main`. In Project Settings →
   Deployment Checks, require the GitHub Actions check
   `Deploy production / Migrate database and deploy API` and configure it to block production alias
   assignment. Vercel may build immediately, but it must not promote the deployment to the production
   domain until that backend check succeeds.
6. Push the validated commit to `main`. CI migrates the database, deploys the API, verifies the
   health/session/signup routes, refreshes Scheduler jobs, and deploys admin. Vercel independently
   builds the web commit from Git and promotes it only after the migration/API check passes.

DNS is managed in Cloudflare:

| Name           | Type         | Target                                     | Proxy            |
| -------------- | ------------ | ------------------------------------------ | ---------------- |
| `docket`       | Vercel value | Value shown by Vercel domain configuration | DNS only         |
| `docket-api`   | CNAME        | `docket-api-<hash>-<region>.a.run.app`     | Proxied (orange) |
| `docket-admin` | CNAME        | `docket-admin-<hash>-<region>.a.run.app`   | Proxied (orange) |

Vercel ownership also requires TXT
`_vercel.hypertext.studio=vc-domain-verify=docket.hypertext.studio,fad2a1c1b1d7e78d9a71`.
Cloudflare SSL/TLS remains **Full** for the proxied Cloud Run origins. No Cloud Run domain mapping is
required.

---

## GitHub Actions reference

### Variables (`vars.*`)

Set by `pnpm bootstrap`. Add missing ones with `gh variable set NAME --body "VALUE" --repo owner/repo`.

| Variable                    | Set by               | Description                                                                                                              |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GCP_PROJECT_ID`            | bootstrap            | GCP project ID (e.g. `my-project-123`)                                                                                   |
| `GCP_REGION`                | bootstrap            | Deployment region (e.g. `us-central1`)                                                                                   |
| `GCP_SERVICE_ACCOUNT`       | bootstrap            | Full SA email: `docket-deploy@<project>.iam.gserviceaccount.com`                                                         |
| `GCP_WIF_PROVIDER`          | bootstrap            | Full WIF provider resource name: `projects/<num>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `PASSKEY_RP_ID`             | bootstrap/manual     | WebAuthn relying-party domain. Use `hypertext.studio` for the production `*.hypertext.studio` hosts.                     |
| `NEON_PROJECT_ID`           | bootstrap            | Neon project ID (from Neon console)                                                                                      |
| `API_URL`                   | manual (post-deploy) | Public custom-domain origin of `docket-api`                                                                              |
| `WEB_URL`                   | manual (post-deploy) | Public custom-domain origin of the Vercel web app                                                                        |
| `ADMIN_URL`                 | manual (post-deploy) | Public custom-domain origin of `docket-admin`                                                                            |
| `BETTER_AUTH_ALLOWED_HOSTS` | manual               | `docket.hypertext.studio,docket-api.hypertext.studio,docket-admin.hypertext.studio`                                      |
| `GOOGLE_OAUTH_PUBLIC`       | manual               | `false` during review; `true` only after Google approval                                                                 |
| `GOOGLE_OAUTH_TEST_EMAILS`  | manual               | Staged Docket user allowlist, initially `willieechalmers@gmail.com`                                                      |
| `API_SECRET_BINDINGS`       | bootstrap            | Non-secret multiline Cloud Run env-to-Secret Manager mapping; includes only configured providers                         |

### Secrets (`secrets.*`)

| Secret         | Set by    | Description                                                                   |
| -------------- | --------- | ----------------------------------------------------------------------------- |
| `NEON_API_KEY` | bootstrap | Neon API key — used by `neon-branch.yml` to create/delete PR preview branches |

---

## GCP resources

Everything created by `pnpm bootstrap`:

| Resource                      | Name / Path                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Service account               | `docket-deploy@<project>.iam.gserviceaccount.com`                                                                            |
| SA roles                      | `roles/run.developer`, `roles/artifactregistry.writer`, `roles/secretmanager.secretAccessor`, `roles/iam.serviceAccountUser` |
| Artifact Registry             | `<region>-docker.pkg.dev/<project>/docket`                                                                                   |
| WIF pool                      | `projects/<project>/locations/global/workloadIdentityPools/github`                                                           |
| WIF provider                  | `…/providers/github-actions` (OIDC, scoped to your GitHub repo)                                                              |
| Secret Manager: database URL  | `docket-database-url`                                                                                                        |
| Secret Manager: migration URL | `docket-database-url-unpooled`                                                                                               |
| Secret Manager: auth secret   | `docket-auth-secret` (generated by bootstrap)                                                                                |
| Secret Manager: cron secret   | `docket-cron-secret` (generated by bootstrap)                                                                                |
| Cloud Run: API                | `docket-api`                                                                                                                 |
| Cloud Run: admin              | `docket-admin`                                                                                                               |

---

## Runtime environment

### API service

Runtime env vars are split between Secret Manager (sensitive) and Cloud Run env vars (non-sensitive). See `deploy.yml` jobs `deploy-api` for the full list.

**From Secret Manager** (injected by Cloud Run at startup through bootstrap's
`API_SECRET_BINDINGS` manifest):

| Secret                | Env var              |
| --------------------- | -------------------- |
| `docket-database-url` | `DATABASE_URL`       |
| `docket-auth-secret`  | `BETTER_AUTH_SECRET` |
| `docket-cron-secret`  | `CRON_SECRET`        |

The deployment runner reads `docket-database-url-unpooled` and passes it to the migration process as
`DATABASE_URL_UNPOOLED`; the pooled application URL must not be used for schema migrations.
Configured provider secrets are appended to the same manifest under their canonical runtime env
names. Legacy `docket-github-client-*` secrets remain readable as `GITHUB_APP_CLIENT_*` until the
guided GitHub App flow rotates them to canonical secret names.

**From Cloud Run env vars** (set at deploy time from GitHub `vars.*`):

`NODE_ENV`, `APP_MODE`, `API_URL`, `WEB_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_ALLOWED_HOSTS`, `BETTER_AUTH_PASSKEY_RP_ID`, `BETTER_AUTH_PASSKEY_RP_NAME`, `GOOGLE_CALENDAR_WEBHOOK_URL`, `GOOGLE_OAUTH_PUBLIC`, `GOOGLE_OAUTH_TEST_EMAILS`, `BILLING_ENABLED`, `MCP_ALLOWED_ORIGINS`, `MCP_TASKS_ENABLED`, `MCP_CIMD_STRICT`.
The MCP OAuth authorization server is **on by default in every deploy** — it needs no MCP-specific vars. `MCP_ISSUER_URL`, `MCP_RESOURCE_URL`, and `OIDC_LOGIN_PAGE_URL` derive mechanically from `API_URL`/`WEB_URL` (`packages/env/src/api.ts`); set one only to override its derivation (e.g. a non-standard sign-in route).

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

### Next.js services (Vercel web, Cloud Run admin)

`NEXT_PUBLIC_*` vars are **baked into each bundle at build time**. Vercel supplies the web values
from its production environment; the admin image receives them as Docker build arguments. They
cannot be changed without rebuilding.

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
An unsuccessful migration blocks API, admin, and web promotion. Migrations must be additive and
must first pass against a fresh PGlite database plus a disposable Neon branch. Never roll production
schema backward during an application rollback; route traffic to the prior compatible revision
instead.

Before migration, inspect for duplicate `(user_id, provider_id, account_id)` account rows. Migration
`0029` intentionally stops on duplicates rather than deleting credentials ambiguously.

## Operations

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
first-party through the Vercel rewrite:

| Provider | Register at                                                  | Callback URL                                                   | Secrets to set                                                                                                                  |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GitHub   | GitHub → Settings → Developer settings → OAuth Apps          | `https://docket-api.hypertext.studio/api/auth/callback/github` | `docket-github-client-id`, `docket-github-client-secret`                                                                        |
| Linear   | Linear → Settings → API → OAuth applications                 | `https://docket-api.hypertext.studio/api/auth/callback/linear` | `docket-linear-client-id`, `docket-linear-client-secret`; webhook delivery additionally requires `docket-linear-webhook-secret` |
| Google   | Google Cloud Console → APIs & Services → Credentials → OAuth | `https://docket.hypertext.studio/api/auth/callback/google`     | `docket-google-client-id`, `docket-google-client-secret`                                                                        |

```bash
# Add the real value as a new secret version (repeat per secret), then redeploy:
printf '%s' '<the-client-id>'     | gcloud secrets versions add docket-github-client-id     --project=athena-services --data-file=-
printf '%s' '<the-client-secret>' | gcloud secrets versions add docket-github-client-secret --project=athena-services --data-file=-

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

### Slack (signal integration — not a Better Auth provider)

Slack does **not** go through Better Auth: its OAuth callback is
`${API_URL}/internal/integrations/slack/callback` (not `/api/auth/callback/slack`), and it needs
**three** secrets, not two — the signing secret additionally verifies the inbound Events API HMAC
on `POST /internal/ingest/slack`.

**To activate:** create the shared Slack app from `infra/slack/docket-app-manifest.yaml`
(https://api.slack.com/apps → "Create New App" → "From a manifest"; `pnpm integrations` walks
through it with the real URLs substituted). Deploy `docket-api` **first** — Slack live-verifies
the events request URL when the manifest is saved. Enable public distribution so arbitrary
customer workspaces can authorize it. Then set the secrets and redeploy:

| Env var                | Where it comes from                            |
| ---------------------- | ---------------------------------------------- |
| `SLACK_CLIENT_ID`      | Slack app → Basic Information → Client ID      |
| `SLACK_CLIENT_SECRET`  | Slack app → Basic Information → Client Secret  |
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → Signing Secret |

Slack requires one events request URL per app, so dev (tunnel host) and prod need **separate
apps** created from the same manifest. Remember the `docket-api` `--min-instances=1` exception
above; also consider tightening the event-drain cron cadence (personal-feed freshness is bounded
by it).

#### Sign in with Apple (web) — differs from the three above

Apple is a fourth social provider (sign-in only, web-only). It does **not** follow the id+secret
pattern, and — unlike the six vars above — **its secrets are not yet created in Secret Manager nor
referenced in `deploy.yml`**, so wiring it is a two-part operator task (create secrets **and** add
the `deploy.yml` lines), not just "replace a placeholder".

Two things make Apple different:

- **No static client secret.** Apple's `client_secret` is a short-lived ES256 JWT the API **mints at
  boot** from the `.p8` key (`generateAppleClientSecret`), so there is no `APPLE_CLIENT_SECRET` to
  store. You supply four **durable** vars instead — `APPLE_CLIENT_ID` (the **Services ID**, e.g.
  `com.docket.web`), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the downloaded `.p8`) —
  and the provider mounts only when **all four** are real (`isRealValue`).
- **HTTPS-only + form_post callback.** Apple rejects `localhost`/non-HTTPS and posts the callback
  from `appleid.apple.com`; `buildAuthOptions` adds that origin to `trustedOrigins` automatically
  when Apple is configured, so no extra origin var is needed.

Register in the **Apple Developer** console (App ID with "Sign in with Apple" → a **Services ID** →
a **Sign in with Apple key** `.p8` + your **Team ID**), with return URL
`https://docket-api.hypertext.studio/api/auth/callback/apple`. Then wire the four vars:

```bash
# 1) Create the four Secret Manager secrets (seed real values, or 'placeholder' to stay dormant):
printf '%s' 'com.docket.web'  | gcloud secrets create docket-apple-client-id   --project=athena-services --replication-policy=automatic --data-file=-
printf '%s' '<TEAM_ID>'       | gcloud secrets create docket-apple-team-id     --project=athena-services --replication-policy=automatic --data-file=-
printf '%s' '<KEY_ID>'        | gcloud secrets create docket-apple-key-id      --project=athena-services --replication-policy=automatic --data-file=-
# The .p8 is multiline; store it verbatim (a file), NOT one line — Cloud Run injects it as-is:
gcloud secrets create docket-apple-private-key --project=athena-services --replication-policy=automatic --data-file=AuthKey_XXXX.p8

# 2) Add these four lines to the `secrets:` block of the `deploy-api` job in .github/workflows/deploy.yml:
#      APPLE_CLIENT_ID=docket-apple-client-id:latest
#      APPLE_TEAM_ID=docket-apple-team-id:latest
#      APPLE_KEY_ID=docket-apple-key-id:latest
#      APPLE_PRIVATE_KEY=docket-apple-private-key:latest
# 3) Push to main (or re-run the deploy workflow) so Cloud Run mounts them.
```

> Adding the `deploy.yml` lines **before** the secrets exist breaks the deploy (Cloud Run cannot
> mount a missing secret) — create the secrets first. Apple returns the user's email only on the
> first authorization; Better Auth persists it then.

### Scheduled jobs (Cloud Scheduler)

Cloud Run is scale-to-zero, so there is no in-process worker — scheduled work is driven by
**Cloud Scheduler** POSTing to a secret-guarded cron endpoint on the API. Each endpoint checks
`CRON_SECRET` (sent as `Authorization: Bearer …` or `x-cron-secret`) and is idempotent.

| Endpoint (all under `/internal/cron/`) | Purpose                                                                                                                                             | Cadence (as provisioned) |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `sync-connectors`                      | Re-mirror every due connector integration (`task_sync` purpose on the leased spine)                                                                 | every 15 min             |
| `email-suggestions`                    | Email-to-task ingest: cursored mailbox pull → funnel → Athena synthesis → suggestions, for every opted-in mail integration (`email_ingest` purpose) | every 15 min             |
| `process-events`                       | Drain inbound webhook events into canonical events (fires automation rules)                                                                         | every 2 min              |
| `daily-digests`                        | Email each opted-in user's end-of-day summary at their local time                                                                                   | every 15 min             |
| `lifecycle-sweep`                      | Advance orgs through the data-lifecycle deletion state machine (also expires/purges resolved email suggestions from M7)                             | daily 03:00              |
| `account-deletion-sweep`               | Purge accounts past their 14-day grace window                                                                                                       | daily 03:30              |
| `account-export-sweep`                 | Generate pending personal-data exports + email the link                                                                                             | every 10 min             |

All seven jobs are provisioned **as code** by `scripts/scheduler-setup.ts`, the single source of
truth. It runs automatically after every API deploy (the `Ensure Cloud Scheduler jobs` step in
the `deploy-api` job) and can be run by hand. The script is idempotent — it `describe`s each job
and `update`s or `create`s it — and reads the secret from `docket-cron-secret` (never logged).
The Cloud Run services are `--allow-unauthenticated`, so each job authenticates purely with the
`x-cron-secret` header (no OIDC / `run.invoker`).

```bash
# Preview the exact gcloud commands without touching GCP (secret redacted):
DRY_RUN=1 GCP_PROJECT_ID=<PROJECT_ID> GCP_REGION=<REGION> \
  API_URL="https://<docket-api-host>" pnpm scheduler:setup

# Provision/update for real (needs an authenticated gcloud):
GCP_PROJECT_ID=<PROJECT_ID> GCP_REGION=<REGION> \
  API_URL="https://<docket-api-host>" pnpm scheduler:setup
```

`pnpm bootstrap` enables `cloudscheduler.googleapis.com` and grants the deploy service account
`roles/cloudscheduler.admin`, so CI may manage the jobs. (Re-run bootstrap on an existing
project to apply these.) Cloud Scheduler must be available in the chosen `GCP_REGION`.

> If these scheduler jobs do not exist in an environment, connectors do **not** auto-sync there —
> manual "Sync now" and the honest-status flows still work, but background mirroring is dormant.
> The connector's `syncCadenceMinutes` (default 60) gates which integrations a given sweep
> actually re-syncs, so the scheduler can safely run more often than any single integration's
> cadence.

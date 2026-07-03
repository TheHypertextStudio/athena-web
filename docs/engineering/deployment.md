# Deployment — GCP Cloud Run

Docket deploys three services to GCP Cloud Run (scale-to-zero) backed by Neon Postgres. GitHub Actions builds and pushes Docker images to Artifact Registry and deploys via the Cloud Run API, authenticated using Workload Identity Federation (no static service-account keys in CI).

---

## Architecture

| Service        | Domain                          | Image                                         | Notes                                                   |
| -------------- | ------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `docket-api`   | `docket-api.hypertext.studio`   | `apps/api` — `pnpm deploy --prod` + `tsx/esm` | Hono Node.js; reads secrets from Secret Manager at boot |
| `docket-web`   | `docket.hypertext.studio`       | `apps/web` — Next.js standalone               | Marketing site + app; `API_URL` baked in at build time  |
| `docket-admin` | `docket-admin.hypertext.studio` | `apps/admin` — Next.js standalone             | `API_URL` baked in at build time                        |

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

Prompts for: GCP project ID, region, GitHub repo (`owner/repo`), passkey domain, Neon credentials. Then:

1. Enables GCP APIs: Cloud Run, Artifact Registry, Secret Manager, IAM, IAM Credentials
2. Creates service account `docket-deploy` with the four roles listed in [GCP resources](#gcp-resources)
3. Creates Artifact Registry repository `docket`
4. Creates WIF pool `github` + OIDC provider `github-actions`, bound to your specific repo
5. Creates Secret Manager secrets: `docket-database-url`, `docket-auth-secret`, `docket-cron-secret`
6. Sets GitHub Actions variables via `gh variable set`
7. Writes a `.env.local` skeleton with generated secrets

### Prerequisites

The bootstrap script checks for these and exits if any are missing or unauthenticated:

| Tool      | Install                                                           | Auth check          |
| --------- | ----------------------------------------------------------------- | ------------------- |
| `gcloud`  | [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install) | `gcloud auth login` |
| `gh`      | [cli.github.com](https://cli.github.com)                          | `gh auth login`     |
| `openssl` | `brew install openssl`                                            | —                   |
| `docker`  | [docs.docker.com](https://docs.docker.com/get-docker/)            | —                   |

---

## First deploy

After bootstrap, push to `main`:

```bash
git push origin main
```

**Expected outcome on the first push:**

- `docket-api` deploys successfully.
- `docket-web` and `docket-admin` fail — `API_URL` is not yet set in GitHub variables (the Cloud Run URL wasn't known at bootstrap time).

**After the API is live, get its URL and set the variables:**

DNS is managed via **Cloudflare**. Add three CNAME records in the Cloudflare dashboard for the `hypertext.studio` zone, each pointing at the corresponding Cloud Run service URL:

| Name           | Type  | Target                                   | Proxy            |
| -------------- | ----- | ---------------------------------------- | ---------------- |
| `docket-api`   | CNAME | `docket-api-<hash>-<region>.a.run.app`   | Proxied (orange) |
| `docket`       | CNAME | `docket-web-<hash>-<region>.a.run.app`   | Proxied (orange) |
| `docket-admin` | CNAME | `docket-admin-<hash>-<region>.a.run.app` | Proxied (orange) |

**Required Cloudflare SSL/TLS setting:** set the zone's SSL/TLS mode to **Full** (not Full Strict). Cloudflare terminates TLS for your custom domains; the connection from Cloudflare to Cloud Run uses the `*.run.app` certificate, which is valid but not for your domain. Full Strict would reject it.

No `gcloud run domain-mappings` commands needed — Cloudflare proxies requests to the raw Cloud Run URLs.

Get the raw `.run.app` URLs after first deploy:

```bash
gcloud run services describe docket-api   --region=<REGION> --project=<PROJECT_ID> --format='value(status.url)'
gcloud run services describe docket-web   --region=<REGION> --project=<PROJECT_ID> --format='value(status.url)'
gcloud run services describe docket-admin --region=<REGION> --project=<PROJECT_ID> --format='value(status.url)'
```

Once DNS propagates, set the GitHub variables to the custom domains (not the `.run.app` URLs):

```bash
gh variable set API_URL    --body "https://docket-api.hypertext.studio"    --repo <owner/repo>
gh variable set WEB_URL    --body "https://docket.hypertext.studio"        --repo <owner/repo>
gh variable set ADMIN_URL  --body "https://docket-admin.hypertext.studio"  --repo <owner/repo>
gh variable set PASSKEY_RP_ID --body "hypertext.studio"                    --repo <owner/repo>

# Push again — all three services now deploy successfully with the real URLs baked in
git commit --allow-empty -m "chore: trigger redeploy after URL vars set"
git push
```

---

## GitHub Actions reference

### Variables (`vars.*`)

Set by `pnpm bootstrap`. Add missing ones with `gh variable set NAME --body "VALUE" --repo owner/repo`.

| Variable              | Set by               | Description                                                                                                              |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GCP_PROJECT_ID`      | bootstrap            | GCP project ID (e.g. `my-project-123`)                                                                                   |
| `GCP_REGION`          | bootstrap            | Deployment region (e.g. `us-central1`)                                                                                   |
| `GCP_SERVICE_ACCOUNT` | bootstrap            | Full SA email: `docket-deploy@<project>.iam.gserviceaccount.com`                                                         |
| `GCP_WIF_PROVIDER`    | bootstrap            | Full WIF provider resource name: `projects/<num>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `PASSKEY_RP_ID`       | bootstrap/manual     | WebAuthn relying-party domain. Use `hypertext.studio` for the production `*.hypertext.studio` hosts.                     |
| `NEON_PROJECT_ID`     | bootstrap            | Neon project ID (from Neon console)                                                                                      |
| `API_URL`             | manual (post-deploy) | Public custom-domain origin of `docket-api`                                                                              |
| `WEB_URL`             | manual (post-deploy) | Public custom-domain origin of `docket-web`                                                                              |
| `ADMIN_URL`           | manual (post-deploy) | Public custom-domain origin of `docket-admin`                                                                            |

### Secrets (`secrets.*`)

| Secret         | Set by    | Description                                                                   |
| -------------- | --------- | ----------------------------------------------------------------------------- |
| `NEON_API_KEY` | bootstrap | Neon API key — used by `neon-branch.yml` to create/delete PR preview branches |

---

## GCP resources

Everything created by `pnpm bootstrap`:

| Resource                     | Name / Path                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Service account              | `docket-deploy@<project>.iam.gserviceaccount.com`                                                                            |
| SA roles                     | `roles/run.developer`, `roles/artifactregistry.writer`, `roles/secretmanager.secretAccessor`, `roles/iam.serviceAccountUser` |
| Artifact Registry            | `<region>-docker.pkg.dev/<project>/docket`                                                                                   |
| WIF pool                     | `projects/<project>/locations/global/workloadIdentityPools/github`                                                           |
| WIF provider                 | `…/providers/github-actions` (OIDC, scoped to your GitHub repo)                                                              |
| Secret Manager: database URL | `docket-database-url`                                                                                                        |
| Secret Manager: auth secret  | `docket-auth-secret` (generated by bootstrap)                                                                                |
| Secret Manager: cron secret  | `docket-cron-secret` (generated by bootstrap)                                                                                |
| Cloud Run: API               | `docket-api`                                                                                                                 |
| Cloud Run: web               | `docket-web`                                                                                                                 |
| Cloud Run: admin             | `docket-admin`                                                                                                               |

---

## Runtime environment

### API service

Runtime env vars are split between Secret Manager (sensitive) and Cloud Run env vars (non-sensitive). See `deploy.yml` jobs `deploy-api` for the full list.

**From Secret Manager** (injected by Cloud Run at startup):

| Secret                | Env var              |
| --------------------- | -------------------- |
| `docket-database-url` | `DATABASE_URL`       |
| `docket-auth-secret`  | `BETTER_AUTH_SECRET` |
| `docket-cron-secret`  | `CRON_SECRET`        |

**From Cloud Run env vars** (set at deploy time from GitHub `vars.*`):

`NODE_ENV`, `APP_MODE`, `API_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_ALLOWED_HOSTS` (optional — host allowlist that switches Better Auth to a dynamic per-request base URL for previews/multi-domain; unset ⇒ static `BETTER_AUTH_URL`), `BETTER_AUTH_PASSKEY_RP_ID`, `BETTER_AUTH_PASSKEY_RP_NAME`, `BILLING_ENABLED`, `MCP_ISSUER_URL` (`= API_URL`), `MCP_RESOURCE_URL` (`= API_URL/mcp` — the canonical RS URI access tokens are audience-bound to), `MCP_ALLOWED_ORIGINS` (`= WEB_URL` + the Claude web origins; browser-less MCP clients send no `Origin` and pass the guard), `OIDC_LOGIN_PAGE_URL` (`= WEB_URL/sign-in` — setting this together with `MCP_RESOURCE_URL` mounts the Better Auth `mcp()` OAuth AS, enabling `/api/auth/mcp/{authorize,token,register}` and Bearer auth on `/mcp`), `MCP_TASKS_ENABLED`, `MCP_CIMD_STRICT`

### Next.js services (web, admin)

`NEXT_PUBLIC_*` vars are **baked into the bundle at build time** via Docker `--build-arg`. They cannot be changed without rebuilding the image. Non-public runtime vars (e.g. `NODE_ENV`) are set as Cloud Run env vars and take effect without a rebuild.

---

## PR preview databases

`neon-branch.yml` runs on every pull request:

- **Opened / reopened / synchronised:** creates a Neon branch `preview/pr-<N>-<branch>`, runs `pnpm db:migrate` against it, expires in 14 days.
- **Closed:** deletes the Neon branch.

The branch database URL is available as a workflow output (`db_url`, `db_url_with_pooler`) for downstream jobs that need a disposable database (e.g. E2E tests against a preview deploy).

---

## Operations

### Viewing logs

```bash
gcloud run services logs read docket-api --region=<REGION> --project=<PROJECT_ID> --limit=50
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
and redeploy. The Better Auth callback URL for each is `${API_URL}/api/auth/callback/<provider>`:

| Provider | Register at                                                  | Callback URL                                                   | Secrets to set                                           |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| GitHub   | GitHub → Settings → Developer settings → OAuth Apps          | `https://docket-api.hypertext.studio/api/auth/callback/github` | `docket-github-client-id`, `docket-github-client-secret` |
| Linear   | Linear → Settings → API → OAuth applications                 | `https://docket-api.hypertext.studio/api/auth/callback/linear` | `docket-linear-client-id`, `docket-linear-client-secret` |
| Google   | Google Cloud Console → APIs & Services → Credentials → OAuth | `https://docket-api.hypertext.studio/api/auth/callback/google` | `docket-google-client-id`, `docket-google-client-secret` |

```bash
# Add the real value as a new secret version (repeat per secret), then redeploy:
printf '%s' '<the-client-id>'     | gcloud secrets versions add docket-github-client-id     --project=athena-services --data-file=-
printf '%s' '<the-client-secret>' | gcloud secrets versions add docket-github-client-secret --project=athena-services --data-file=-

# Pick up the new :latest values (either re-run the deploy workflow, or update in place):
gcloud run services update docket-api --region=us-central1 --project=athena-services
```

> Google needs its OAuth consent screen configured with the calendar/tasks/drive/gmail readonly
> scopes (see `buildAuthOptions`); Linear's app must grant the `read` scope or every connector
> call 400s. Existing users who linked before a scope change must re-consent — they surface as
> `error` / needs-reauth, never a silent skip.

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

### Scheduled jobs (Cloud Scheduler)

Cloud Run is scale-to-zero, so there is no in-process worker — scheduled work is driven by
**Cloud Scheduler** POSTing to a secret-guarded cron endpoint on the API. Each endpoint checks
`CRON_SECRET` (sent as `Authorization: Bearer …` or `x-cron-secret`) and is idempotent.

| Endpoint                        | Purpose                                                        | Suggested cadence |
| ------------------------------- | -------------------------------------------------------------- | ----------------- |
| `POST /v1/cron/lifecycle-sweep` | Advance orgs through the data-lifecycle deletion state machine | daily             |
| `POST /v1/cron/sync-connectors` | Re-mirror every due connector integration (auto-sync)          | every 15 min      |

Both jobs are provisioned **as code** by `scripts/scheduler-setup.ts`, the single source of
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

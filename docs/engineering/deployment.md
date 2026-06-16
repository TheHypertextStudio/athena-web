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

`NODE_ENV`, `APP_MODE`, `API_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_PASSKEY_RP_ID`, `BETTER_AUTH_PASSKEY_RP_NAME`, `BILLING_ENABLED`, `MCP_TASKS_ENABLED`, `MCP_CIMD_STRICT`

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

### Scheduled jobs (Cloud Scheduler)

Cloud Run is scale-to-zero, so there is no in-process worker — scheduled work is driven by
**Cloud Scheduler** POSTing to a secret-guarded cron endpoint on the API. Each endpoint checks
`CRON_SECRET` (sent as `Authorization: Bearer …` or `x-cron-secret`) and is idempotent.

| Endpoint                        | Purpose                                                        | Suggested cadence |
| ------------------------------- | -------------------------------------------------------------- | ----------------- |
| `POST /v1/cron/lifecycle-sweep` | Advance orgs through the data-lifecycle deletion state machine | daily             |
| `POST /v1/cron/sync-connectors` | Re-mirror every due connector integration (auto-sync)          | every 15 min      |

Provision the connector-sync schedule once per environment (the secret lives in
`docket-cron-secret`):

```bash
CRON_SECRET="$(gcloud secrets versions access latest --secret=docket-cron-secret --project=<PROJECT_ID>)"
API_URL="https://<docket-api-host>"

gcloud scheduler jobs create http docket-sync-connectors \
  --project=<PROJECT_ID> --location=<REGION> \
  --schedule="*/15 * * * *" \
  --uri="${API_URL}/v1/cron/sync-connectors" \
  --http-method=POST \
  --headers="x-cron-secret=${CRON_SECRET}"
```

> Until this scheduler job exists, connectors do **not** auto-sync in that environment —
> manual "Sync now" and the honest-status flows still work, but background mirroring is dormant.
> The connector's `syncCadenceMinutes` (default 60) gates which integrations a given sweep
> actually re-syncs, so the scheduler can safely run more often than any single integration's
> cadence.

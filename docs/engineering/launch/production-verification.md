# Production verification

> **Requirement**: GEN-02 (launch-blocker) — "All anticipated or implied functionality must be
> demonstrated working in the production environment, not only in local dev or a preview deployment."
> **Acceptance**: each primary flow exercised against the deployed production hostname, with a
> screenshot or HTTP trace per flow whose host is the production domain, succeeding with zero
> console errors.
> **Verdict as of 2026-08-02: FAIL.** Not because a flow was tried and broke — because production
> is not running the code those flows live in.

---

## Headline finding: production is behind HEAD by 32 endpoints

```
$ eval "$(./scripts/dev-stack.sh env)" && pnpm launch:verify-prod
  production   https://docket-api.hypertext.studio  →  204 OpenAPI paths
  local (HEAD) http://…api.docket.localhost:1355     →  236 OpenAPI paths
  verdict: STALE — 32 path(s) built locally are not deployed
```

All 32 undeployed paths are `/v1/me/athena/**` — the **entire personal Athena surface**: chat,
sessions, streaming, proposals, approvals, assignments, triggers, connections, pulse. Athena is the
product's headline capability and none of it is reachable in production.

This settles GEN-02 on its own. There is no arrangement of screenshots that makes "the feature is
not deployed" into a pass, so the per-flow evidence below is scoped to what is _reachable_ today,
and every Athena row is marked accordingly.

Full trace, machine-readable and human-readable, regenerated on each run:
`docs/engineering/launch/evidence/production/*-production-verify.{json,txt}`

---

## How to reproduce

```bash
eval "$(./scripts/dev-stack.sh env)"   # exports $API_URL, the HEAD reference
pnpm launch:verify-prod                 # exits non-zero while production is behind HEAD
```

The script (`scripts/production-verify.ts`) needs no credentials. It diffs the deployed OpenAPI
document against the local one, probes ten unauthenticated production endpoints (status, timing,
selected headers), and writes both into the evidence directory. It exits non-zero when any path
present at HEAD is missing from production, which is what lets "production is stale" be a build
failure rather than a paragraph.

---

## What was verified unauthenticated (2026-08-02T10:05Z)

Every row below is a real response from a production hostname. Timings are single-sample
wall clock from a residential connection, not a benchmark.

| Surface                                                       | Status | Time  | Served by                      |
| ------------------------------------------------------------- | ------ | ----- | ------------------------------ |
| `docket-api…/v1/health`                                       | 200    | 87ms  | Cloud Run behind Cloudflare    |
| `docket-api…/v1/config`                                       | 200    | 174ms | Cloud Run behind Cloudflare    |
| `docket-api…/v1/openapi.json`                                 | 200    | 344ms | Cloud Run behind Cloudflare    |
| `docket-api…/api/auth/.well-known/oauth-authorization-server` | 200    | 136ms | Cloud Run behind Cloudflare    |
| `docket-api…/.well-known/oauth-protected-resource`            | 200    | 127ms | Cloud Run behind Cloudflare    |
| `docket-api…/v1/me` **without a session**                     | 401    | 165ms | correctly refused              |
| `docket-api…/v1/orgs` **without a session**                   | 401    | 128ms | correctly refused              |
| `docket.hypertext.studio/`                                    | 200    | 142ms | Vercel (`x-vercel-cache: HIT`) |
| `docket.hypertext.studio/sign-in`                             | 200    | 159ms | Vercel (`x-vercel-cache: HIT`) |
| `docket-admin.hypertext.studio/`                              | 200    | 255ms | Cloud Run behind Cloudflare    |

Production reports `appMode: production`, OAuth providers `google` + `linear`, connectors
`gmail`, `gtasks`, `calendar`, `linear`, and `stripePublishableKey: null` (billing not configured
in production).

---

## Per-flow evidence table

GEN-02 names these flows. `author-action-required` means the step needs a human WebAuthn gesture:
Docket is passkey-only, so there is no credential that can be typed or scripted, and an automated
run cannot produce a production session. Each such row gives the exact command or click-path.

Run this once, first — it produces the session every other row depends on:

```bash
# Sign in at https://docket.hypertext.studio/sign-in with your passkey, then keep the tab open.
# Capture each flow with the browser devtools Network tab set to "Preserve log" and
# "Disable cache" off, and screenshot with the URL bar visible.
```

| Flow                           | Reachable in prod today?                                                                                             | Evidence status  | What exists / what the author must do                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sign-in**                    | yes — `/sign-in` 200, OIDC metadata published                                                                        | **partial**      | Have: unauthenticated 200 for `/sign-in` and the authorization-server document; `/v1/me` correctly 401s anonymously. Need: **author-action-required** — sign in with a passkey at `https://docket.hypertext.studio/sign-in`, screenshot the landed app with the production URL bar visible, and confirm the console is clean. |
| **Workspace/org creation**     | yes — `/v1/orgs` deployed (401 anonymously)                                                                          | **not captured** | **author-action-required** — while signed in: create a workspace in the UI, then `curl -s -H "cookie: <session>" https://docket-api.hypertext.studio/v1/orgs \| jq '.[].id'` and save the output beside a screenshot.                                                                                                         |
| **Project creation**           | yes — project routes present in the deployed 204                                                                     | **not captured** | **author-action-required** — create a project in the UI; screenshot the project page with the production URL bar; confirm zero console errors.                                                                                                                                                                                |
| **Task creation**              | yes                                                                                                                  | **not captured** | **author-action-required** — create a task; screenshot the task detail; confirm it survives a reload.                                                                                                                                                                                                                         |
| **Calendar**                   | yes — `calendar` is in the deployed connector list                                                                   | **not captured** | **author-action-required** — open `/calendar`, screenshot a week with at least one item, confirm no console errors.                                                                                                                                                                                                           |
| **Cycles**                     | yes                                                                                                                  | **not captured** | **author-action-required** — open the cycles surface, screenshot the current cycle, confirm the current-by-date selection is right.                                                                                                                                                                                           |
| **Athena session**             | **NO — not deployed**                                                                                                | **fail**         | 32 `/v1/me/athena/**` paths exist at HEAD and are absent from production. No author action can capture this. **Deploy HEAD first**, then re-run `pnpm launch:verify-prod` and expect `IN SYNC`.                                                                                                                               |
| **Connector: Google Calendar** | partially — connector advertised, but the connection-management routes (`/v1/me/athena/connections*`) are undeployed | **fail**         | Blocked by the same stale deploy.                                                                                                                                                                                                                                                                                             |
| **Connector: Gmail**           | same as above                                                                                                        | **fail**         | Blocked by the same stale deploy.                                                                                                                                                                                                                                                                                             |
| **Connector: Google Tasks**    | same as above                                                                                                        | **fail**         | Blocked by the same stale deploy.                                                                                                                                                                                                                                                                                             |
| **Connector: Linear**          | same as above                                                                                                        | **fail**         | Blocked by the same stale deploy.                                                                                                                                                                                                                                                                                             |
| **Billing**                    | not configured — `stripePublishableKey: null`                                                                        | n/a              | Production intentionally runs without Stripe configured. Not a GEN-02 flow unless billing is in launch scope.                                                                                                                                                                                                                 |

---

## The blocking sequence

1. **Get a green CI run on `main`.** The last three `ci.yml` runs on `main` failed, and
   `deploy-production` only runs on a green push to `main`. Note that this slice adds two new
   required jobs — `coverage` (red today, see `docs/engineering/coverage-ledger.md`) and
   `secret-scan` (needs `GITLEAKS_LICENSE`) — so both must be satisfied before a deploy can happen.
2. **Deploy.** Then confirm freshness with `pnpm launch:verify-prod` → expect exit 0 and `IN SYNC`.
3. **Only then** walk the author-action rows above. Capturing them against today's stale production
   would produce evidence for a build nobody intends to ship.

---

## Before the deploy: the 0059 CHECK-constraint preflight

Migration `0059_work_data_constraints.sql` adds thirteen `CHECK` constraints to six tables that
already hold real rows (`cycle`, `initiative`, `milestone`, `program`, `project`, `task`) — a
not-blank name, a non-negative estimate, a date within `[1970, 2201)`. On real Postgres,
`ALTER TABLE ... ADD CONSTRAINT` validates every existing row before it succeeds, so **one**
violating row anywhere aborts the entire migration transaction. Dev data already turned up a task
due in 3999 and rows with out-of-range dates, which is why this is a named step rather than an
assumption. `packages/db/tests/migrations/production-snapshot-restore.test.ts` proves the chain is
non-destructive against a _synthetic_ dataset and says plainly it cannot cover production's actual
row shapes — this preflight is the check that closes that gap, read-only, against the real thing:

```bash
DATABASE_URL_UNPOOLED=<production connection string> pnpm migration:0059:preflight
```

Fix whatever it reports (or the constraint, if a report is a legitimate historical value worth
keeping) before `0059` ever reaches step 2 below. It refuses to run against an embedded `pglite:`
target or with no connection string set, on purpose — this only means something against real data.

## Author-run commands referenced above

```bash
# Is production current?
eval "$(./scripts/dev-stack.sh env)" && pnpm launch:verify-prod

# What is deployed right now, by count?
curl -s https://docket-api.hypertext.studio/v1/openapi.json | jq '.paths | keys | length'

# Is the deploy workflow even reaching production?
gh run list --workflow=deploy.yml --limit 5
gh run list --workflow=ci.yml --branch main --limit 5

# Secret-scan licence (organization-owned repo — the CI job fails without it)
gh secret set GITLEAKS_LICENSE --repo TheHypertextStudio/athena-web
```

# Docket — Env & Bootstrap Implementation Spec

**Spec area:** `env-and-bootstrap` · **Status:** implementation-grade · **Verified against current docs 2026-06-05** (t3-oss/env, Neon CLI `neonctl`, Vercel CLI, Stripe CLI, Better Auth 1.6.14, Linear OAuth).

> **Note on §3 (bootstrap flow):** This spec was written targeting Vercel as the deployment platform. The production deployment now uses **GCP Cloud Run** — see [`docs/engineering/deployment.md`](../deployment.md) for the actual deployment reference, GitHub Actions variables, GCP resource inventory, and first-deploy walkthrough. Sections §0–§2 (env-var contract and `@docket/env` package design) remain accurate. Section §3 reflects the intended full provisioning flow; steps §3.8–§3.9 (Vercel CLI env writes, `vercel link`) do not apply to the current implementation.

This spec defines (1) the complete environment-variable contract for every app/package, (2) the `@docket/env` validation package design (t3-oss/env `extends` composition), and (3) the `pnpm bootstrap` interactive provisioning flow that makes the service "just work" from env vars in both dev and prod, where **dev mirrors prod** (same env contract, same validation, only values differ).

---

## 0. Foundational Assumptions (load-bearing)

These follow directly from the engineering plan; everything below is pinned to them.

- **Auth/MCP/OIDC owner = `apps/api` (Hono).** `/api/auth/*`, the `oidcProvider()`/`mcp()` discovery endpoints, and the `/mcp` endpoint are all served by `apps/api`. The auth _handler_ lives on the API, but Better Auth's `baseURL` is **dynamic** (`BETTER_AUTH_ALLOWED_HOSTS`): each Next app proxies `/api/auth/*` to the API same-origin, so a browser request resolves `baseURL` to its **product origin** (OAuth callback + cookie first-party there) while a direct API/MCP request resolves to the **API origin** (the OIDC/MCP issuer). `BETTER_AUTH_URL` is the fallback. (Engineering §2 recommends Hono; see open issue if Next is chosen instead.)
- **Three Next apps + one API**, all 12-factor, env-var-only deploy. Each deployable validates **only the variables it actually consumes** via its own `@docket/env` composition.
- **Hosting (overridable):** Vercel for `web`, `marketing`, `admin`, and `api`; **Neon serverless Postgres**. Dev mirrors prod: identical variable names and Zod validation, different values.
- **Domains (canonical example; substitute real domains in bootstrap):**
  | Logical | Dev | Prod |
  |---|---|---|
  | API (auth + MCP + OIDC issuer) | `http://localhost:8787` | `https://api.docket.app` |
  | Product web | `http://localhost:3000` | `https://app.docket.app` |
  | Marketing | `http://localhost:3001` | `https://docket.app` |
  | Admin | `http://localhost:3002` | `https://admin.docket.app` |

  All four prod hosts share the apex `docket.app` so **passkey RP ID = `docket.app`** works across subdomains.

---

## 1. The Complete Env-Var Contract

Conventions used in the tables:

- **Apps:** `api` = `apps/api` (Hono), `web` = `apps/web`, `mkt` = `apps/marketing`, `adm` = `apps/admin`. Packages (`db`, `auth`, `env`) declare their own slice and are _re-exported through_ the consuming app's composition — a package never reads `process.env` independently of `@docket/env`.
- **Scope:** `server` = server-only secret (never bundled to client). `client` = public, must carry the `NEXT_PUBLIC_` prefix and is exposed to the browser.
- **D/P:** which environments require it (D=dev, P=prod). "D=P" means same name, different value (the parity rule).

### 1.1 Core platform / base URLs

| Name                        | Apps           | Scope  | D/P    | What it is                                                                                                               | Where to obtain                                                                             |
| --------------------------- | -------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | all            | server | D=P    | `development` \| `production` \| `test`.                                                                                 | Set by runtime / Vercel automatically; bootstrap writes `development` to local `.env`.      |
| `DATABASE_URL`              | api (db, auth) | server | D=P    | Pooled Postgres connection string (PgBouncer endpoint). Single owner of all SQL incl. Better Auth tables.                | Neon → `neonctl connection-string <branch> --pooled --output json`. Bootstrap captures it.  |
| `DATABASE_URL_UNPOOLED`     | api (db)       | server | D=P    | Direct (non-pooled) connection string. Required for `drizzle-kit migrate`/DDL (migrations must not run over the pooler). | Neon → `neonctl connection-string <branch> --output json` (omit `--pooled`).                |
| `API_URL`                   | api            | server | D=P    | Canonical public origin of `apps/api`. Equals the auth base URL and the OIDC/MCP issuer base.                            | Decided per environment (table in §0). Dev: `http://localhost:8787`. Prod: your API domain. |
| `NEXT_PUBLIC_API_URL`       | web, mkt, adm  | client | D=P    | Same origin as `API_URL`, exposed to the browser so the Next apps' `createAuthClient`/Hono RPC client target the API.    | Mirror of `API_URL`.                                                                        |
| `NEXT_PUBLIC_WEB_URL`       | web, mkt, adm  | client | D=P    | Public origin of `apps/web` (used for redirects back into the product).                                                  | §0 table.                                                                                   |
| `NEXT_PUBLIC_MARKETING_URL` | mkt, web       | client | D=P    | Public origin of `apps/marketing` (landing/sign-up).                                                                     | §0 table.                                                                                   |
| `NEXT_PUBLIC_ADMIN_URL`     | adm            | client | D=P    | Public origin of `apps/admin`.                                                                                           | §0 table.                                                                                   |
| `PORT`                      | api            | server | D only | Local Hono port (default `8787`). Vercel ignores it in prod.                                                             | Bootstrap default; `z.coerce.number().default(8787)`.                                       |

### 1.2 Better Auth core

| Name                                                | Apps       | Scope  | D/P    | What it is                                                                                                                                                                                                                                | Where to obtain                                                                           |
| --------------------------------------------------- | ---------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                | api (auth) | server | D=P    | 32+ byte secret for signing/encryption. **Per-environment** (dev ≠ prod).                                                                                                                                                                 | Bootstrap generates: `openssl rand -base64 32` (or `npx @better-auth/cli@1.6.14 secret`). |
| `BETTER_AUTH_URL`                                   | api (auth) | server | D=P    | **Fallback** base URL only. The effective base is dynamic per request host (see `BETTER_AUTH_ALLOWED_HOSTS`); this is used for header-less/direct requests.                                                                               | Bootstrap sets it to the API origin.                                                      |
| `BETTER_AUTH_ALLOWED_HOSTS`                         | api (auth) | server | D=P    | Comma-separated host allowlist that enables **dynamic `baseURL`** (per `x-forwarded-host`) + proxy-header trust. Set in every env (local: web/admin/api localhost). Makes OAuth callbacks land on the browser's product origin.           | Composed by bootstrap from the §0 domain table.                                           |
| `OAUTH_PROXY_SECRET` / `OAUTH_PROXY_PRODUCTION_URL` | api (auth) | server | P only | Shared secret + prod product origin for Better Auth's `oAuthProxy` (routes preview OAuth through prod's registered callback). Both-or-neither. Blank locally ⇒ plugin off ⇒ direct OAuth.                                                 | `openssl rand -hex 24` (secret, same on prod+previews); prod product URL.                 |
| `BETTER_AUTH_TRUSTED_ORIGINS`                       | api (auth) | server | D=P    | Comma-separated allowed origins for CORS/cookie/CSRF: the web, marketing, and admin origins (+ `appleid.apple.com` only if Apple is added later).                                                                                         | Composed by bootstrap from the §0 domain table.                                           |
| `BETTER_AUTH_PASSKEY_RP_ID`                         | api (auth) | server | D=P    | WebAuthn Relying Party ID. Dev: `localhost`. Prod: the shared apex (`docket.app`). Must be a registrable suffix of all app origins.                                                                                                       | Bootstrap: `localhost` for dev; prompts for apex in prod.                                 |
| `BETTER_AUTH_PASSKEY_RP_NAME`                       | api (auth) | server | D=P    | Human-readable RP name shown in the OS passkey prompt (`"Docket"`).                                                                                                                                                                       | Bootstrap default `"Docket"`.                                                             |
| `NEXT_PUBLIC_PASSKEY_RP_ID`                         | web, adm   | client | D=P    | Browser-exposed mirror of `BETTER_AUTH_PASSKEY_RP_ID` (**must equal it**). The sign-in flow passes it to the WebAuthn Signal API (`PublicKeyCredential.signalUnknownCredential`) to prune server-deleted passkeys. Read with no fallback. | Set = `BETTER_AUTH_PASSKEY_RP_ID`. Bootstrap derives it.                                  |

### 1.3 Social / OAuth providers (login + data-source links)

Redirect URIs follow Better Auth's fixed routing (verified): social providers use `${BETTER_AUTH_URL}/api/auth/callback/<provider>`; generic OAuth (Linear) uses `${BETTER_AUTH_URL}/api/auth/oauth2/callback/<providerId>`. The bootstrap prints the **exact** URIs to paste into each provider console.

| Name                        | Apps       | Scope  | D/P | What it is                                                                                               | Where to obtain                                                                             |
| --------------------------- | ---------- | ------ | --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`          | api (auth) | server | D=P | Google OAuth 2.0 client ID (sign-in + Workspace/Drive/Gmail/Calendar links).                             | Google Cloud Console → APIs & Services → Credentials → "OAuth client ID" (Web application). |
| `GOOGLE_CLIENT_SECRET`      | api (auth) | server | D=P | Matching client secret.                                                                                  | Same Google credential.                                                                     |
| `GITHUB_APP_ID`             | api (auth) | server | D=P | GitHub App id (JWT `iss` for minting 1h installation tokens — the firehose/connector data plane).        | GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App → "App ID".       |
| `GITHUB_APP_SLUG`           | api (auth) | server | D=P | GitHub App URL slug — builds the install URL `github.com/apps/<slug>/installations/new`.                 | The slug in the App's public page URL.                                                      |
| `GITHUB_APP_CLIENT_ID`      | api (auth) | server | D=P | GitHub App OAuth client id (`Iv…`) — user-to-server flow for sign-in + "my issues" pull + identity.      | Same GitHub App → "Client ID".                                                              |
| `GITHUB_APP_CLIENT_SECRET`  | api (auth) | server | D=P | Matching user-to-server client secret.                                                                   | Same GitHub App → "Generate a new client secret".                                           |
| `GITHUB_APP_PRIVATE_KEY`    | api (auth) | server | D=P | App private key as single-line base64 PEM (`base64 -i key.pem \| tr -d '\n'`); signs the app JWT.        | Same GitHub App → "Generate a private key" (.pem).                                          |
| `GITHUB_APP_WEBHOOK_SECRET` | api (auth) | server | D=P | Webhook signing secret; verifies the firehose at `POST /v1/ingest/github`.                               | Generate (`openssl rand -hex 24`); paste into the App's Webhook secret field too.           |
| `LINEAR_CLIENT_ID`          | api (auth) | server | D=P | Linear OAuth2 application client ID (`genericOAuth` `providerId: "linear"`; sign-in + Linear migration). | Linear → Settings → **API** → OAuth applications → Create.                                  |
| `LINEAR_CLIENT_SECRET`      | api (auth) | server | D=P | Matching client secret.                                                                                  | Same Linear OAuth application.                                                              |

**OAuth callbacks live on the browser-facing PRODUCT origin, not the API.** Better Auth runs on the
API but is reached **same-origin** through each Next app's `/api/auth/*` rewrite, and its `baseURL`
(which the OAuth `redirect_uri` + session cookie are built from) resolves to the browser's host. So
the redirect URI you register with each provider is the _product_ origin, per frontend:

| Provider | Dev redirect URI (per frontend)                            | Prod redirect URI                                        |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Google   | `https://docket.localhost/api/auth/callback/google`        | `https://app.docket.app/api/auth/callback/google`        |
| GitHub   | `https://docket.localhost/api/auth/callback/github`        | `https://app.docket.app/api/auth/callback/github`        |
| Linear   | `https://docket.localhost/api/auth/oauth2/callback/linear` | `https://app.docket.app/api/auth/oauth2/callback/linear` |

Register the same set for **each** signing-in frontend (web + `admin.…`). The GitHub App also gets
a connect callback `…/v1/integrations/github/callback` (browser-facing → product origin) per
frontend; only its **webhook** `…/v1/ingest/github` is the **API** origin (GitHub's servers POST it
directly). `pnpm integrations` emits exactly these — `webBases` (from `BETTER_AUTH_TRUSTED_ORIGINS`)
for callbacks, `apiBase` (from `API_URL`) for the webhook.

**`baseURL` is dynamic everywhere.** `BETTER_AUTH_ALLOWED_HOSTS` is set in _every_ environment
(local too: `docket.localhost,admin.docket.localhost,api.docket.localhost`) so Better Auth derives
`baseURL` per request from `x-forwarded-host`: a browser on the web/admin app gets that product
origin (callback + cookie first-party there); a direct API/MCP request gets the API origin (so the
OIDC/MCP issuer stays the API). A single static base could not serve two frontends + the API.

**Preview deploys use the `oAuthProxy` plugin** (gated on `OAUTH_PROXY_SECRET` +
`OAUTH_PROXY_PRODUCTION_URL`, both set together — enforced by an API cross-field rule; the shared
secret must match across prod + previews). A per-PR `*.vercel.app` URL can't be pre-registered with
GitHub/Google, so previews route OAuth through production's registered callback. Only the
**production** callback needs registering; local + prod register their own and run OAuth directly
(local leaves both vars blank ⇒ the plugin is not mounted).

**GitHub uses one GitHub App (not an OAuth App)** that does three jobs: sign-in (user-to-server
OAuth, `user:email` only — no `repo` scope), the issue/PR connector, and the webhook firehose. The
six `GITHUB_APP_*` vars are created and pasted in via `pnpm integrations`, exactly like the other
providers; `bootstrap` follows the general rule — **create from scratch by default, but if a
provider's vars are already present (a re-run, or pasted from the team's secret store), verify and
skip rather than redo the work.** It does NOT pull credentials from production Secret Manager (an
earlier design did, which broke first-time setup and used the wrong gcloud project).

Conceptually it is one app reused across environments — a GitHub App allows several callback URLs,
so register each environment's `…/api/auth/callback/github` (sign-in, Better Auth) and
`…/v1/integrations/github/callback` (install/connect) as you set that environment up. The **webhook
is environment-aware**: local setup skips it entirely (`APP_MODE=local` selects the mock observer,
so local needs no webhook), and only **production** sets the public webhook URL — `…/v1/ingest/github`
on the public API host — and turns it on. To exercise the real firehose locally, use the persistent
cloudflared tunnel that `pnpm bootstrap` (Phase 1) sets up — it fronts the stable portless host
(`https://docket.localhost`, which proxies `/v1` to the API), NOT a bare `localhost:port` (dev ports
are ephemeral under portless). See `docs/local-development.md` → "Tunnels & local OAuth".

**Linear `genericOAuth` config values (constants in `@docket/auth`, not env):** `authorizationUrl = https://linear.app/oauth/authorize`, `tokenUrl = https://api.linear.app/oauth/token`, `userInfoUrl = https://api.linear.app/graphql` (resolve identity via the `viewer` GraphQL query in `getUserInfo`), `scopes = ["read"]` for login (request `["read","write","issues:create"]` only on the migration connect flow), `pkce: true`, comma-separated scope serialization (Linear quirk — pass scopes as a single comma-joined string).

### 1.4 Stripe (billing + data lifecycle)

Billing subject = Organization (`referenceId = Organization.id`). Stripe SDK pinned `stripe@^22`; API version `2026-03-25.dahlia`. Webhook path = `${API_URL}/api/auth/stripe/webhook`. Keys/secret are **per-mode** (test for dev, live for prod) — same variable names, different values (parity).

| Name                                 | Apps       | Scope  | D/P            | What it is                                                                                                                                                                                                           | Where to obtain                                                                                                                                                                                            |
| ------------------------------------ | ---------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                  | api (auth) | server | D=P            | Secret API key. Dev = `sk_test_…`, prod = `sk_live_…`.                                                                                                                                                               | Stripe Dashboard → Developers → API keys (toggle Test/Live), or `stripe config --list` for the test key after `stripe login`.                                                                              |
| `STRIPE_WEBHOOK_SECRET`              | api (auth) | server | D=P            | Signing secret for the webhook endpoint hitting `/api/auth/stripe/webhook`. **Dev** = the `whsec_…` printed by `stripe listen`; **prod** = the endpoint's secret from the Dashboard/CLI. **Per-endpoint, per-mode.** | Dev: `stripe listen --print-secret`. Prod: created when bootstrap registers the live webhook endpoint (`stripe webhook_endpoints create` returns it; or Dashboard → Webhooks → endpoint → Signing secret). |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web        | client | D=P            | Publishable key for embedded Checkout in the product app. Dev = `pk_test_…`, prod = `pk_live_…`.                                                                                                                     | Stripe Dashboard → API keys (publishable).                                                                                                                                                                 |
| `DOCKET_PRICE_LOOKUP_TEAM`           | api (auth) | server | D=P            | **Primary** plan→price resolution: the `lookup_key` for the Team plan price. Mode-agnostic name; resolved at runtime to the active price in the current mode.                                                        | Set by bootstrap when it creates prices with `--lookup-key team_monthly`.                                                                                                                                  |
| `DOCKET_PRICE_LOOKUP_TEAM_ANNUAL`    | api (auth) | server | D=P            | `lookup_key` for the annual Team price (if annual offered).                                                                                                                                                          | `--lookup-key team_annual`.                                                                                                                                                                                |
| `STRIPE_PRICE_TEAM`                  | api (auth) | server | D=P (fallback) | **Fallback/override** explicit price ID per env (`price_…`). Used only if `authorize`-by-lookup is disabled. Never hardcode in code.                                                                                 | Output of `stripe prices create` (see §3.4).                                                                                                                                                               |
| `STRIPE_BILLING_PORTAL_CONFIG_ID`    | api (auth) | server | D=P (optional) | Customer Portal configuration ID, if a non-default portal config is used.                                                                                                                                            | `stripe billing_portal configurations create` or Dashboard → Customer portal.                                                                                                                              |

> Personal/solo tier is **no-card** (product decision), so no price is required to _create_ a personal org; the Team price set above gates shared/team orgs and invites.

### 1.5 MCP server / OIDC provider

The OIDC issuer and MCP resource are derived from `API_URL`; they are surfaced as explicit env vars so the discovery documents (RFC 8414 AS metadata, RFC 9728 Protected Resource Metadata) and audience-binding (RFC 8707 `resource`) can be validated at boot and asserted in tests.

| Name                  | Apps | Scope  | D/P            | What it is                                                                                                                                  | Where to obtain                                 |
| --------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `MCP_ISSUER_URL`      | api  | server | D=P            | OIDC/OAuth 2.1 issuer (Authorization Server). **= `API_URL`** (single AS, Better Auth `oidcProvider()`).                                    | Derived from `API_URL` by bootstrap.            |
| `MCP_RESOURCE_URL`    | api  | server | D=P            | Canonical MCP resource identifier for audience binding (`resource=` param; tokens whose `aud` ≠ this are rejected). **= `${API_URL}/mcp`**. | Derived from `API_URL`.                         |
| `MCP_ALLOWED_ORIGINS` | api  | server | D=P            | Comma-separated `Origin` allowlist for DNS-rebinding protection on `/mcp` (the app origins + any first-party agent host).                   | Composed from §0 domains; bootstrap default.    |
| `OIDC_LOGIN_PAGE_URL` | api  | server | D=P (optional) | Where `oidcProvider()` redirects for the consent/login UI (a route in `apps/web`). Defaults to `${NEXT_PUBLIC_WEB_URL}/oauth/consent`.      | Derived; override only if the consent UI moves. |

> Downstream connector tokens (GitHub/Drive/Linear) are **separately issued** and **never** the client's MCP token (engineering §4 MUST). Those connector OAuth credentials reuse the §1.3 provider apps — no additional MCP-specific env beyond the above.

### 1.6 First-party agent (Athena) — minimal, provider-owned compute

Athena is the built-in agent; compute/cost/telemetry are **not** stored by Docket (data model §5). Only the connection/credential reference is needed.

| Name                    | Apps | Scope  | D/P            | What it is                                                                                 | Where to obtain                                      |
| ----------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `ATHENA_AGENT_ENDPOINT` | api  | server | D=P            | Base URL of the Athena agent runtime that opens Sessions.                                  | Decided per environment (the agent service's URL).   |
| `ATHENA_AGENT_API_KEY`  | api  | server | D=P            | Bearer credential `apps/api` uses to start/steer Athena sessions.                          | Issued by the Athena service operator (out of band). |
| `ANTHROPIC_API_KEY`     | api  | server | D=P (optional) | Only if Athena/Claude provider runs in-process rather than behind `ATHENA_AGENT_ENDPOINT`. | console.anthropic.com → API keys.                    |

### 1.7 Operational / observability (optional but defined for parity)

| Name                                        | Apps | Scope         | D/P            | What it is                                                                                        | Where to obtain                                                   |
| ------------------------------------------- | ---- | ------------- | -------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `CRON_SECRET`                               | api  | server        | D=P            | Shared secret guarding the data-lifecycle deletion sweep cron endpoint (`Authorization: Bearer`). | Bootstrap generates `openssl rand -hex 32`; Vercel Cron sends it. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`     | all  | server/client | D=P (optional) | Error reporting DSN.                                                                              | sentry.io → project → Client Keys (DSN).                          |
| `EXPORT_BUCKET_URL` / `EXPORT_BUCKET_TOKEN` | api  | server        | P (optional)   | Storage target for org export artifacts in the lifecycle pipeline (e.g. Vercel Blob).             | Vercel Blob store token, or chosen object store.                  |
| `VERCEL_OIDC_TOKEN`                         | all  | server        | auto           | Vercel-injected OIDC token (do not set manually; pulled by `vercel env pull`).                    | Managed by Vercel.                                                |

### 1.8 CI / bootstrap-only (never in app `.env`, never validated by `@docket/env`)

These authenticate the **bootstrap script and CI to the cloud CLIs**; they are operator credentials, not runtime config.

| Name                                  | Used by       | What it is                                                                                                            | Where to obtain                            |
| ------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `VERCEL_TOKEN`                        | bootstrap, CI | Vercel access token for non-interactive `vercel env add/pull/link`.                                                   | Vercel → Account Settings → Tokens.        |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | bootstrap, CI | Identify the Vercel team + project for scripted env writes (also written to `.vercel/project.json` by `vercel link`). | `vercel link` output, or Project Settings. |
| `NEON_API_KEY`                        | bootstrap, CI | Non-interactive `neonctl` auth (`neonctl --api-key`).                                                                 | Neon Console → Account → API keys.         |
| `STRIPE_API_KEY` (test)               | bootstrap     | Lets bootstrap run `stripe products/prices create` non-interactively (`stripe --api-key`).                            | Stripe test secret key (`sk_test_…`).      |

---

## 2. `@docket/env` Package Design (t3-oss/env, `extends` composition)

**Goal:** one validated, typed env object per deployable, composed from reusable per-domain slices, so each app inherits **exactly** the vars it consumes and fails fast at boot/build if any are missing or malformed. Verified pattern: `@t3-oss/env-core` (slices) + `@t3-oss/env-nextjs` (Next apps), `extends: [...]` to compose, `emptyStringAsUndefined: true`, `skipValidation` for Docker/lint.

### 2.1 Package shape

```
packages/env/
├─ package.json        # name "@docket/env", exports map per slice + per app
├─ src/
│  ├─ shared.ts        # platform/base URLs (NODE_ENV, *_URL, NEXT_PUBLIC_*_URL)
│  ├─ db.ts            # DATABASE_URL, DATABASE_URL_UNPOOLED
│  ├─ auth.ts          # BETTER_AUTH_*, GOOGLE/GITHUB/LINEAR client id+secret
│  ├─ stripe.ts        # STRIPE_*, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, DOCKET_PRICE_*
│  ├─ mcp.ts           # MCP_*, OIDC_LOGIN_PAGE_URL
│  ├─ agent.ts         # ATHENA_*, ANTHROPIC_API_KEY
│  ├─ ops.ts           # CRON_SECRET, SENTRY_DSN, EXPORT_*
│  ├─ env.api.ts       # createEnv extends [shared, db, auth, stripe, mcp, agent, ops]
│  ├─ env.web.ts       # createEnv extends [shared, stripe(client only)] (+ auth client base via shared)
│  ├─ env.marketing.ts # createEnv extends [shared]
│  └─ env.admin.ts     # createEnv extends [shared]
└─ tsconfig.json
```

`@docket/env` is **JIT-consumed** (raw TS + `transpilePackages` in Next; direct import in Hono) per the engineering compilation strategy — it is not pre-compiled.

### 2.2 Slice pattern (env-core, no client prefix at slice level)

```ts
// src/shared.ts
import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';

export const sharedEnv = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    API_URL: z.url(),
  },
  // client vars are declared in the *app* createEnv so the prefix is enforced there;
  // shared exposes them as runtimeEnv passthrough where needed.
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

```ts
// src/auth.ts
import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';

export const authEnv = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().min(1), // CSV; parse to array at consume site
    BETTER_AUTH_PASSKEY_RP_ID: z.string().min(1),
    BETTER_AUTH_PASSKEY_RP_NAME: z.string().default('Docket'),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_APP_SLUG: z.string().min(1),
    GITHUB_APP_CLIENT_ID: z.string().min(1),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1), // single-line base64 PEM
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(1),
    LINEAR_CLIENT_ID: z.string().min(1),
    LINEAR_CLIENT_SECRET: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

```ts
// src/stripe.ts (split: server slice + a client-publishable that the web app re-declares)
export const stripeServerEnv = createEnv({
  server: {
    STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
    DOCKET_PRICE_LOOKUP_TEAM: z.string().min(1),
    DOCKET_PRICE_LOOKUP_TEAM_ANNUAL: z.string().optional(),
    STRIPE_PRICE_TEAM: z.string().startsWith('price_').optional(),
    STRIPE_BILLING_PORTAL_CONFIG_ID: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

### 2.3 App composition (env-nextjs for the three Next apps; env-core for Hono)

```ts
// src/env.api.ts  — consumed by apps/api (Hono)
import { createEnv } from '@t3-oss/env-core';
import * as z from 'zod';
import { sharedEnv } from './shared';
import { dbEnv } from './db';
import { authEnv } from './auth';
import { stripeServerEnv } from './stripe';
import { mcpEnv } from './mcp';
import { agentEnv } from './agent';
import { opsEnv } from './ops';

export const env = createEnv({
  extends: [sharedEnv, dbEnv, authEnv, stripeServerEnv, mcpEnv, agentEnv, opsEnv],
  server: {
    PORT: z.coerce.number().default(8787),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // CI/Docker image build with no secrets present:
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

```ts
// src/env.web.ts — consumed by apps/web (Next 16)
import { createEnv } from '@t3-oss/env-nextjs';
import * as z from 'zod';
import { sharedEnv } from './shared';

export const env = createEnv({
  extends: [sharedEnv],
  client: {
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_WEB_URL: z.url(),
    NEXT_PUBLIC_MARKETING_URL: z.url(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
    NEXT_PUBLIC_MARKETING_URL: process.env.NEXT_PUBLIC_MARKETING_URL,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
```

`env.marketing.ts` and `env.admin.ts` mirror `env.web.ts` but extend only `sharedEnv` and declare just their own `NEXT_PUBLIC_*` client vars (marketing needs `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_WEB_URL`; admin needs `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_ADMIN_URL`). **Critical rule:** for env-nextjs, every `NEXT_PUBLIC_*` var must be referenced **literally** in `runtimeEnv` (Next inlines them; destructuring `process.env` doesn't work in the browser bundle).

### 2.4 Turborepo wiring (cache correctness)

- `turbo.json` declares each var in `globalEnv`/per-task `env` so the build cache invalidates when a value changes (engineering §1.4). Use **strict env mode** so tasks only see declared vars.
- Use **wildcards** for the public surface: `env: ["NEXT_PUBLIC_*", "BETTER_AUTH_*", "STRIPE_*", "DOCKET_PRICE_*", "MCP_*", "DATABASE_URL*", "GOOGLE_*", "GITHUB_*", "LINEAR_*", "ATHENA_*", "CRON_SECRET", "OIDC_*", "API_URL", "PORT", "NODE_ENV"]`.
- `.env` lives **per-app** (`apps/*/.env`), not at repo root, so each deployable's local env matches its prod env scope exactly (parity). Bootstrap writes the right subset to each app.
- Add `SKIP_ENV_VALIDATION` to the env allowlist so Docker/CI image builds (no secrets) don't fail validation while still producing identical artifacts.

### 2.5 Validation entry points

- **Next apps:** import the app's `env` in `next.config.ts` (forces validation at build) **and** re-export through `@docket/env` consumed in server code.
- **Hono api:** `import { env } from "@docket/env/api"` at the top of `apps/api/src/index.ts` so the process refuses to start with a bad contract.
- A repo script `pnpm env:check` runs each app's `createEnv` against the loaded env and prints the first failing variable with its "where to obtain" hint (the same hint strings the bootstrap uses).

---

## 3. `pnpm bootstrap` — Interactive Provisioning Flow

**Entry point:** `scripts/bootstrap.ts`, run via `pnpm bootstrap` (root `package.json` script: `tsx scripts/bootstrap.ts`). Built with `@clack/prompts` (interactive TTY), `execa` (CLI orchestration), and `zod` (re-uses `@docket/env` schemas to verify the result). **Idempotent** — re-running detects existing resources and offers reuse vs recreate. **No stubs**: it wires real Neon/Stripe/Vercel/OAuth, and where a step cannot be automated (provider consoles), it prints exact values and pauses for confirmation.

### 3.0 Flow overview

```
pnpm bootstrap
  ├─ 0. Preflight: check CLIs installed + authed (neonctl, stripe, vercel)
  ├─ 1. Target: choose `dev` (writes apps/*/.env) and/or `prod` (writes Vercel env)
  ├─ 2. Domains: confirm/enter the §0 domain table → derive *_URL, BETTER_AUTH_URL, MCP_*
  ├─ 3. Secrets: generate BETTER_AUTH_SECRET, CRON_SECRET
  ├─ 4. Neon: provision project/branches → DATABASE_URL (+ unpooled) → run migrations
  ├─ 5. OAuth apps: print exact redirect URIs; prompt for Google/GitHub/Linear id+secret
  ├─ 6. Stripe: products + prices (lookup keys), webhook endpoint(s) + secret
  ├─ 7. Athena: prompt for ATHENA_AGENT_ENDPOINT + key (optional ANTHROPIC_API_KEY)
  ├─ 8. Write dev: assemble per-app .env files
  ├─ 9. Configure prod: vercel link + vercel env add for each app/target
  ├─ 10. Verify: re-run @docket/env validation for every app; smoke-check connections
  └─ 11. Summary: print what was created, what needs manual console steps, next commands
```

### 3.1 Step 0 — Preflight

For each of `neonctl`, `stripe`, `vercel`: detect presence (`--version`); if missing, print the install command (`npm i -g neonctl`, Stripe CLI install per OS, `npm i -g vercel`) and offer to continue with that provider skipped. Detect auth state:

- Neon: `neonctl projects list --output json` succeeds → authed; else `neonctl auth` (browser) or prompt for `NEON_API_KEY`.
- Stripe: `stripe config --list` shows a key → authed; else `stripe login`.
- Vercel: `vercel whoami` → authed; else `vercel login` or prompt for `VERCEL_TOKEN`.

### 3.2 Step 1–3 — Target, domains, secrets

- **Target multiselect:** `dev` and/or `prod`. Dev is the default for first run.
- **Domains:** show the §0 defaults; allow overrides. From the API origin derive `BETTER_AUTH_URL`, `MCP_ISSUER_URL = API_URL`, `MCP_RESOURCE_URL = ${API_URL}/mcp`, `OIDC_LOGIN_PAGE_URL`, and the `BETTER_AUTH_TRUSTED_ORIGINS`/`MCP_ALLOWED_ORIGINS` CSVs from the web/marketing/admin origins. Set `BETTER_AUTH_PASSKEY_RP_ID` = `localhost` (dev) or the apex of the prod web origin.
- **Secrets:** generate `BETTER_AUTH_SECRET` (`crypto.randomBytes(32).toString("base64")`) and `CRON_SECRET` (`randomBytes(32).toString("hex")`). **Different value per target** (dev secret ≠ prod secret).

### 3.3 Step 4 — Neon Postgres (automated via `neonctl`)

Verified commands:

1. Reuse-or-create project: `neonctl projects list --output json` → if a `docket` project exists offer reuse; else `neonctl projects create --name docket --region-id <prompted, e.g. aws-us-east-1> --output json --set-context`.
2. Branches: ensure a `production` branch (primary) and a `dev` branch — `neonctl branches list --output json`; create missing with `neonctl branches create --name dev --output json`.
3. Connection strings, per target:
   - Pooled (runtime `DATABASE_URL`): `neonctl connection-string <branch> --pooled --output json`.
   - Unpooled (`DATABASE_URL_UNPOOLED`, for migrations): `neonctl connection-string <branch> --output json`.
   - Dev target → `dev` branch; prod target → `production` branch.
4. Migrate: with the **unpooled** string exported as `DATABASE_URL_UNPOOLED`, run `pnpm --filter @docket/db db:generate` (if schema changed) then `pnpm --filter @docket/db db:migrate` (`drizzle-kit migrate`). Better Auth tables were generated into `@docket/db` already (engineering §2 schema ownership), so this single migrate creates the full schema.
5. Seed default roles per future org happens at runtime; bootstrap does **not** seed tenant data.

### 3.4 Step 5 — OAuth applications & third-party integrations (semi-automated)

> **Implemented** in `scripts/integrations-setup.ts`, runnable standalone as **`pnpm integrations`** and invoked automatically at the end of `pnpm bootstrap`. The flow generalizes beyond OAuth to **every external credential in `VAR_REGISTRY`** (Stripe, Anthropic, SMTP, observability), is **environment-aware** (`local` / `staging` / `production`, each configured in its own pass with its own credentials and redirect URIs), and routes writes per environment:
>
> - `local` → non-destructive upsert into the root `.env.local`.
> - `staging` / `production` → server vars to **GCP Secret Manager**, public `NEXT_PUBLIC_*` vars to **GitHub environment variables**. Secret names follow the `deploy.yml` convention: production keeps the unqualified `docket-<kebab>` names; staging is suffixed `docket-staging-<kebab>`. For any **new** var the script prints the exact `deploy.yml` `secrets:` / `env_vars:` lines to add (Cloud Run only mounts secrets the workflow references — wiring a dedicated staging Cloud Run job remains a follow-up).
>
> Before any cloud write it **confirms the gcloud + gh accounts and the GCP project** (never assumes the active ones): it lists every authenticated account and every accessible project and lets the operator choose, scoping gcloud via `CLOUDSDK_CORE_ACCOUNT` (no global-config mutation) and `gh auth switch`-ing only when a different account is picked. `pnpm bootstrap` runs the same confirmation up front and reuses it.

These provider consoles have **no scriptable creation API**, so the setup prints exact instructions + the exact redirect URI for the chosen environment (from §1.3) and collects the resulting id/secret via masked, schema-validated, re-promptable inputs (empty input keeps the current value or skips). Recommend separate OAuth apps per environment to keep secrets isolated.

- **Google:** "Create an OAuth client (Web application) at https://console.cloud.google.com/apis/credentials. Authorized redirect URIs: `<dev>` and/or `<prod>`. Enable the People API for profile; enable Drive/Gmail/Calendar APIs if you'll use those connectors." Prompt `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **GitHub:** "Create ONE **GitHub App** under your org (Org → Settings → Developer settings → GitHub Apps) at `https://github.com/organizations/<org>/settings/apps` (not an OAuth App) — it powers sign-in, the issue/PR connector, and the webhook firehose. User-authorization callback `<…/v1/integrations/github/callback>`, setup URL `<…/v1/integrations/github/setup>`, webhook URL `<…/v1/ingest/github>`. Repository permissions Issues/PRs/Metadata read; account permission Email addresses read; subscribe to Issues/Issue comment/Pull request events; create one app per environment." Prompt `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (single-line base64 PEM), `GITHUB_APP_WEBHOOK_SECRET`.
- **Linear:** "Create an OAuth application at Linear → Settings → API → OAuth applications. Callback URL: `<the oauth2/callback/linear URI>`. Scopes: `read` (login) plus `write,issues:create` for migration." Prompt `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`.

Each pasted value is validated against its own `@docket/env` registry schema before being accepted (invalid values re-prompt rather than abort).

### 3.5 Step 6 — Stripe (automated via Stripe CLI)

Verified commands; run against **test mode** for dev and **live mode** for prod (the CLI uses the active key; bootstrap can pass `--api-key` per mode).

1. Authenticate: `stripe login` (or pass `--api-key`).
2. Create product + prices with stable lookup keys (idempotent: list first, reuse if present):
   - `stripe products create --name "Docket Team" --output json` → capture product id.
   - `stripe prices create --product <prod_id> --currency usd --unit-amount <amount> --recurring.interval month --lookup-key team_monthly --output json` → sets `DOCKET_PRICE_LOOKUP_TEAM = team_monthly`, captures `price_…` → `STRIPE_PRICE_TEAM` (fallback).
   - Optional annual: `--recurring.interval year --lookup-key team_annual`.
3. Webhook endpoints:
   - **Dev:** do **not** create a Dashboard endpoint; instead instruct the operator to run `stripe listen --forward-to localhost:8787/api/auth/stripe/webhook` in a side terminal, and capture `STRIPE_WEBHOOK_SECRET` via `stripe listen --print-secret`.
   - **Prod:** create the real endpoint → `stripe webhook_endpoints create --url https://api.docket.app/api/auth/stripe/webhook --enabled-events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed,invoice.paid,invoice.payment_action_required,customer.subscription.trial_will_end --output json` → capture the returned signing secret into prod `STRIPE_WEBHOOK_SECRET`.
4. Prompt for the publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, mode-matched) and the secret key (`STRIPE_SECRET_KEY`) — read from `stripe config --list` for test, prompt for live.
5. Offer to seed test data for the e2e flow with `stripe trigger checkout.session.completed` (dev only) so the billing path can be smoke-tested immediately.

### 3.6 Step 7 — Athena agent

Prompt for `ATHENA_AGENT_ENDPOINT` and `ATHENA_AGENT_API_KEY` (and optional `ANTHROPIC_API_KEY` if running the provider in-process). If the operator has no agent runtime yet, allow skipping — `agentEnv` marks these optional for the first run but `env:check` warns that agent sessions won't start until set.

### 3.7 Step 8 — Write dev `.env` files

Assemble the validated values and write **per-app** files (parity with prod scoping):

- `apps/api/.env` ← all server slices (db, auth, stripe-server, mcp, agent, ops) + `API_URL`, `PORT`, `NODE_ENV=development`.
- `apps/web/.env` ← `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_MARKETING_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NODE_ENV`.
- `apps/marketing/.env` ← `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`, `NODE_ENV`.
- `apps/admin/.env` ← `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ADMIN_URL`, `NODE_ENV`.

Write atomically (write `.env.tmp` then rename); never overwrite an existing `.env` without a diff + confirm. Ensure `apps/*/.env` are gitignored. Also emit/update `apps/*/.env.example` (values redacted) so the contract is documented in-repo.

### 3.8 Step 9 — Configure prod on Vercel (automated via Vercel CLI)

For each app (`api`, `web`, `marketing`, `admin`) as a separate Vercel project:

1. Link: `vercel link --project docket-<app> --yes` (uses `VERCEL_TOKEN`/`VERCEL_ORG_ID` non-interactively in CI).
2. For each variable in that app's prod slice, pipe the value from stdin (avoids shell history leakage): `printf '%s' "<value>" | vercel env add <NAME> production --sensitive --force` (and `preview` where the var is needed for preview deploys). Verified syntax: `echo "value" | vercel env add NAME production`; `--force` overwrites, `--sensitive` marks secrets write-only.
   - **Secrets** (`*_SECRET`, `*_KEY`, `DATABASE_URL*`) → `--sensitive`.
   - **Public** (`NEXT_PUBLIC_*`) → `--no-sensitive`, added to `production` and `preview`.
3. Preview parity: add the preview-relevant subset to the `preview` target (or per-branch). For ephemeral preview DBs, see open issue on Neon per-PR branches.
4. Pull-back check: `vercel env pull .env.vercel.<app> --environment=production --yes` and diff against what bootstrap intended; report mismatches.

### 3.9 Step 10–11 — Verify & summary

- Re-run validation: for each app, load its target env and execute the app's `createEnv` (via `pnpm env:check`); any failure prints the variable + its "where to obtain" hint and the bootstrap exits non-zero.
- Smoke checks: open a Postgres connection over `DATABASE_URL` and `SELECT 1`; `stripe prices retrieve` (or list by lookup key) to confirm the price resolves; `curl ${API_URL}/api/auth/ok` style liveness if the API is running; fetch `${MCP_ISSUER_URL}/.well-known/oauth-authorization-server` and `${MCP_RESOURCE_URL}` PRM once the API is up.
- Summary prints: created Neon project/branch ids, Stripe product/price ids + lookup keys, the exact OAuth redirect URIs to (re)confirm in each console, which Vercel env keys were set per target, and the next commands (`pnpm dev`, `stripe listen …`, `pnpm --filter @docket/db db:studio`).

### 3.10 Idempotency & safety rules

- Every cloud step **lists before creating** and reuses on match (by name/lookup-key/url).
- Secrets are generated once per target and **never regenerated** on re-run unless the operator explicitly asks (regenerating `BETTER_AUTH_SECRET` invalidates sessions — warn loudly).
- All secret prompts are masked; secret values are never echoed to stdout or written to logs; prod values go to Vercel via stdin pipes, not argv.
- Bootstrap never commits `.env`; it verifies `.gitignore` covers `apps/*/.env`, `.env.vercel.*`, and `playwright/.auth/*`.
- The full contract is the single source of truth: if a variable is added to `@docket/env`, the bootstrap's prompt registry (a typed array of `{ name, slice, scope, target, where, generate? }`) is the only place to extend — keeping the script and the validator in lockstep.

---

## 4. Dev-mirrors-prod Guarantees (acceptance criteria)

1. **Same names everywhere.** No `DEV_`/`PROD_` prefixed variants. Test/live Stripe keys, dev/prod Neon strings, and per-env secrets all use the identical variable name; only the value differs.
2. **Same validation everywhere.** The exact `createEnv` composition runs in dev, CI (with `SKIP_ENV_VALIDATION` only for secret-less image builds), and prod boot. A missing/invalid var fails identically in all three.
3. **Same code path.** No conditional `if (NODE_ENV === 'development')` branching of which service is wired — only values switch (e.g. `sk_test_` vs `sk_live_`, localhost vs domain). Webhooks, OAuth callbacks, MCP discovery, and Checkout all resolve from env in both.
4. **One command to a working dev env** (`pnpm bootstrap` → `pnpm dev` + `stripe listen`) and **one path to prod** (`pnpm bootstrap` prod target → `vercel deploy`), both fed purely by the env contract.

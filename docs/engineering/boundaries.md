# Docket — External Boundaries & Local/Mock Strategy

> **Goal this enables:** Docket is implemented _completely_ and runs + tests end-to-end **with zero external accounts**. The only missing functionality is the **environment-specific values** that differ between local and prod (database URL, OAuth/Stripe/provider keys, etc.). No business logic is stubbed — **only the I/O edges**.

## The principle: ports + two adapters, selected from env

Every external dependency sits behind a typed **port** (a TS interface) with exactly **two adapters**:

- a **real** adapter, driven entirely by environment values, and
- a **mock/fixture** adapter, deterministic and offline.

A single resolver in `@docket/boundaries` chooses per port: **real if the required env value is present and real-shaped; otherwise the mock.** `APP_MODE ∈ {local, test}` forces mocks even when a key is present (safety). Tests inject mocks explicitly. There is never a third code path — flipping to prod is purely supplying env values.

```
@docket/boundaries
  ports/        BillingGateway, AgentRuntime, Connector, Mailer, BlobStore (TS interfaces)
  real/         RealStripeGateway, RealProviderRuntime, RealGitHubConnector, …  (env-driven)
  mock/         InMemoryBillingGateway, MockAgentRuntime, MockConnector, …      (fixtures)
  fixtures/     deterministic sample data
  select.ts     selectAdapter(port, env)  →  real | mock
```

## The boundaries

1. **Database — real Postgres always (not mocked).** Local/dev/CI run a **containerized `postgres:17`** (`docker compose up -d db`) _or_ embedded **PGlite** (`@electric-sql/pglite`) for the autonomous build/tests where Docker may be unavailable — so migrations + tests run in-process with no service. The Drizzle client picks its driver from the `DATABASE_URL` scheme (`neon:`/`postgres:`/`pglite:`). **Prod = Neon**, swapped purely via `DATABASE_URL` / `DATABASE_URL_UNPOOLED`. The only gap: the URL value.
2. **Auth.** **Passkey** works fully locally (WebAuthn, no service). **Social (Google/GitHub/Linear), SSO, SCIM** are registered only when their env client id/secret is present and real; absent/placeholder → the provider is simply not mounted and the UI hides it. A `MockOAuthProvider` exists for e2e. Gap: real client ids/secrets + IdP metadata.
3. **Billing — `BillingGateway` port.** `RealStripeGateway` (Stripe SDK + env keys) vs `InMemoryBillingGateway` (fixtures that simulate `trialing → active → past_due → canceled` and emit synthetic webhook events). The 14-day trial + the org **data-lifecycle state machine** + the idempotent cron sweep are **real** and tested against the mock. Gap: Stripe keys / price lookup keys / webhook secret.
4. **Agent execution — `AgentRuntime` port.** `startSession(task, agent)` → async stream of `SessionActivity`. `RealProviderRuntime` (Athena/Claude/Codex via API/MCP, env keys) vs `MockAgentRuntime` (replays scripted fixture sessions: `thought → action(proposed) → elicitation → response`). Session hosting, the **approval gate**, and principal-vs-initiator accountability are **real** and fully exercised by the mock. Gap: provider API keys/endpoints.
5. **Connectors — `Connector` port** (GitHub/Drive/Linear/Gmail/Calendar): `connect / importWork / mirrorStatus / linkResource`. Real adapters (provider API + OAuth token) vs `MockConnector` (fixture issues/docs/events with provenance). The **Migration-vs-Connector** logic + import/read-only-mirror are **real**. Gap: provider OAuth tokens.
6. **Mailer — `Mailer` port.** `RealMailer` (env SMTP/provider) vs `CaptureMailer` (in-memory, asserted in tests) / `ConsoleMailer` (dev). Gap: SMTP/provider creds.
7. **MCP server — fully real.** Tokens are issued by the **local** Better Auth OIDC provider, so the `/mcp` server works end-to-end locally. Only the public issuer/base URL is an env value. Gap: prod issuer URL.
8. **Blob storage — `BlobStore` port** (export artifacts): `RealBlob` (Vercel Blob/S3 + env) vs `LocalDiskBlob` (`.data/exports`). Gap: blob creds.

## Local dev infra (zero external accounts)

- **`docker-compose.yml`** — `postgres:17` (+ `mailpit` for email capture). `pnpm dev` brings it up; `pnpm dev` works with **no** real accounts.
- **`.env.example` / `.env.local`** — local `DATABASE_URL`, `APP_MODE=local`, and **placeholder** external keys (which trigger the mock adapters). `@docket/env` validates and treats placeholders as "use mock."
- **Composition root** — `buildContainer(env)` wires the selected adapter per port; the API, MCP server, crons, and Next server actions all take their dependencies from it.

## What "complete" means here

`pnpm dev` boots the entire product — sign in (passkey), run multiple orgs, plan Programs/Projects/Tasks, delegate to an agent and watch a (mock) session through the approval gate, see billing lifecycle transitions (mock), import work from a (mock) connector, hit the `/mcp` server, view the cross-org Hub — **all locally, all tested**. The single delta to production is the set of environment values enumerated in `env-and-bootstrap.md`.

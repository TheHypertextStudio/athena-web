# Security audit — database and user-data APIs

**Date:** 2026-08-14
**Scope:** `apps/api` (99 routers), `packages/db`, `packages/auth`, `packages/authz`,
`packages/integrations`, `packages/blob-store`, `packages/notifications`,
`packages/agent-runtime`, `apps/runner`, `apps/web`, `apps/admin`.
**Method:** six parallel source reviews, findings verified by reading the cited code.
**Reader:** whoever sequences the remediation. Findings are ordered by exploitability, and
each says what an attacker does, not just what the code says.

## Summary

The access-control floor is well built and the operational ceiling is missing.

`requireAuth` is opt-out with a four-entry exact-match allowlist, and everything genuinely
public is mounted _outside_ the gated app rather than exempted from it. Tenancy runs through
one middleware (`orgContextMiddleware`) and a small set of named loaders, applied consistently
enough that I could not find an IDOR across 99 routers. There is no SQL injection: every
`sql.raw` is a compile-time constant and every user-input path is parameterized or whitelisted.
`error.ts` is exemplary — it never leaks exception text, never echoes submitted values, and
derives its titles from a closed catalog. `mcp-network.ts` is a better SSRF guard than most
production code, with DNS pinning, a CIDR blocklist, and redirect and size caps.

What is missing is everything an auditor asks for after that. There is no audit trail of access
changes, no security event log, no logger at all, no monitoring, no rate limiting outside
`/api/auth/*`, no row-level security, no key rotation, and no policy documents. Alongside those
sit seven defects reachable today, all now fixed on this branch.

Two recurring shapes explain most findings. First, a control exists and one path bypasses it —
`mcp-network.ts` is excellent and Web Push used bare `fetch`; `error.ts` is careful and `ok.ts`
skipped validation. Second, a control is documented but not implemented — `Idempotency-Key`,
`writeAudit`, and twelve of fifteen audit event kinds.

## Fixed on this branch

| #   | Finding                                                                                                                                                                                                                                                             | Where                                                          | Fix                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /billing/export` returned the object store's own URL for a full org dump. No session needed, `expiresAt` enforced by nothing, object never deleted.                                                                                                           | `routes/billing.ts:357`                                        | Returns an API path; bytes stream through `GET /billing/export/file` behind `manage`; TTL enforced per read; superseded objects deleted. |
| 2   | Export keys were `exports/<orgId>/<ms-timestamp>.json` — reconstructable by anyone knowing the org id and roughly when it ran — in a bucket written `access: 'public'`.                                                                                             | `blob-store/src/vercel.ts:131`                                 | Key is now a ULID stored in `organization.export_blob_key`; the key never leaves the server.                                             |
| 3   | Web Push posted to any user-supplied `endpoint` with bare `fetch` — no scheme check, no IP denylist, no timeout, no redirect cap. Prune-on-410 made it a three-state oracle, i.e. an internal port scanner.                                                         | `notifications/webpush/node.ts:259`                            | Routed through `mcpSafeFetch`; endpoint constrained to HTTPS on a named host at registration.                                            |
| 4   | Inbound email became an unmarked `role: 'user'` transcript turn. Anyone knowing a user's Athena inbox address could instruct an agent holding that person's full authority.                                                                                         | `inbound-mail-delivery.ts:133` → `agent-session-runner.ts:303` | `applyReplyToSession` takes a required `provenance`; non-principal text is enveloped and attributed.                                     |
| 5   | Linear webhook replies took the same path, from any commenter in a third-party workspace.                                                                                                                                                                           | `ingest-linear-agent.ts:250`                                   | Same chokepoint, tagged `linear`.                                                                                                        |
| 6   | A connected MCP server authored its own `readOnlyHint`, and reads execute under every approval dial — so a hostile server could switch off its own gate.                                                                                                            | `agent/toolbox.ts:358` → `approval-policy.ts:52`               | `classifyTool` takes the annotation's source; a remote tool is never read-only regardless of what it claims.                             |
| 7   | Response schemas were not parsed in production. Because the schemas are non-strict, dev and test _stripped_ extra fields and passed, so a handler passing a raw Drizzle row was green in CI and leaked the full row in production. No environment could observe it. | `lib/ok.ts:22`                                                 | Always parses. A failure logs the paths server-side and returns a 500 from the closed catalog, never a 422 naming internal fields.       |

Findings 4 and 5 are a mitigation, not a boundary: a model can still be talked past a delimiter.
The boundary is the approval gate and the session's scopes. What the envelope removes is the
model being _misled_ about who is speaking, which is a different and fixable problem.

## Open — access control and audit

**No audit trail of access changes.** `enums.ts:516` declares fifteen `audit_event` kinds; four
call sites write three of them. `member_added`, `member_removed`, `role_changed`, and
`grant_changed` are never written by any code. `writeAudit` (`routes/activity.ts:48`) is dead —
its only callers are a test and its own doc comment — while `specs/permissions.md:547` states
that every agent write records to it. This is the single largest gap for CC6.2 and CC6.3.

**Audit writes are silently discarded.** `lib/task-audit.ts:427` catches and returns. A dropped
row leaves no trace, not even a log line.

**No security event logging.** Nothing records login, logout, failed authentication, permission
denial, data export, or account deletion. `requireAuth` and `staffMiddleware` both throw silently.

**Three divergent grant-cascade implementations.** `authz/can-actor.ts:87` never reads the
`cascades` column; `permissions/resource-access.ts:431` does; `task-helpers.ts:177` ignores it
and also disagrees about guests. A `cascades: false` grant is honoured by search and Hub and
treated as fully cascading by the MCP surface. A control narrative cannot describe three
algorithms.

**`deny` grants are inert.** `authz/can-actor.ts:23` sets `DENY_ENABLED = false`. The schema
models deny, the API documents it, and a deny row written by any path confers nothing.

**Last-owner guard races.** `members.ts:418` and `:479` call `lastOwnerGuard` on `db` rather than
inside the transaction, and the guard is two unlocked selects. Two concurrent owner deletions both
pass and an org reaches zero owners, with no constraint behind it. 88 of 89 transactions run at
READ COMMITTED.

**Staff boundary enforced in a service, not a route.** `notification-intent-routes.ts` is mounted
on the public `/v1/notifications` group with no `staffMiddleware`; authorization is a per-method
`requireStaffUser` inside `intent-service.ts:178`. Currently complete, but it is the one staff
boundary held by convention, and these endpoints appear in the public OpenAPI document.

## Open — data protection

**No row-level security on any of ~150 tables.** Tenant isolation is per-handler `where` clauses
with no database backstop. See [rls-strategy.md](rls-strategy.md) for why a blanket rollout is the
wrong move and what to do instead.

**Org deletion purges nothing.** `billing/lifecycle.ts:166` is a state flip; the code says so. An
org at `lifecycle_state = 'deleted'` retains every row, including `search_document` copies.

**Blobs orphan on purge and expiry.** `purgeUser` deletes rows only; account-export ZIPs
containing a full cross-org archive are marked `expired` and never deleted.

**Plaintext credential columns.** `oauth_client.client_secret`, `oauth_access_token.token`,
`oauth_refresh_token.token`, `invitation.token`, and `event_subscription.ingest_token` are stored
in the clear, in a codebase that demonstrably knows better — `time_share_token.token_hash` and
`phone_verification.code_hash` are hashed.

**`search_document` doubles the blast radius.** It is a denormalized plaintext copy of task,
comment, update, and project text with a GIN index over it.

**Unbounded list endpoints.** `CursorQuery.limit` is optional with no default
(`types/pagination.ts:51`), so `GET /v1/tasks` and its siblings return whole tables.
`lib/export-collect.ts:52` issues eleven consecutive unbounded `SELECT *`, and `activity.ts:65`
returns the entire audit feed with no limit at all. Note the fix is a server-side cap, not a
default — `pagination.ts:36` documents the optionality as deliberate compatibility, and a low
default silently truncates every existing caller.

**No TLS enforcement on the database connection.** `client.ts:105` passes no `ssl` option and
`postgres-js` defaults to false; `DATABASE_URL` is validated as `min(1)`. Encryption in transit
depends entirely on the operator having put `sslmode=require` in the secret.

**`CREDENTIALS_ENCRYPTION_KEY` is optional in production** and absent from
`REQUIRED_PRODUCTION_SECRET_ENV_NAMES`. A deploy passes every gate with no sealing key; the
failure surfaces as a 409 at the first credential write.

## Open — cryptography and integrity

**No key rotation, anywhere.** The credential envelope is `v1:gcm:<iv>:<tag>:<data>` with no key
id, so re-keying means offline re-encryption of three tables with the service down.
`BETTER_AUTH_SECRET` is worse: it signs sessions, encrypts backup codes, signs OAuth state, signup
challenges, MCP cursors, and an internal webhook HMAC. One rotation breaks all six.
`backup-codes.ts:70` states the gap in its own docstring.

**No AAD binding ciphertexts to their row.** A sealed envelope is portable across every row in
every credential table. `lattice_credential` defends structurally with a compound foreign key;
`integration_credential` and `personal_mcp_credential` rely on route code alone.

**Missing webhook replay windows.** GitHub, Notion, Linear-Agent, and Twilio verify signatures but
no timestamp. GitHub and Notion are mitigated by ingest-layer idempotency; Linear-Agent is not —
`ingest-linear-agent.ts:308` acts synchronously, so a replayed delivery re-triggers an agent run.

**Two non-constant-time secret comparisons.** `cron.ts:54` gates nineteen sweep endpoints;
`calendar-google-adapter.ts:758` is the only authentication on the Google push endpoint.

**A second, weaker SSRF guard reachable pre-authentication.** `mcp/cimd.ts:158` treats any IPv6
address it does not recognize as public, and has no overall deadline. It fires on
`/api/auth/oauth2/authorize` before any identity exists.

## Open — operations

**No logger, no monitoring, no alerting.** 31 bare `console.*` in `apps/api` alone. `SENTRY_DSN`
is declared in `packages/env` and threaded into turbo config with no SDK installed. Two log lines
carry real leak risk: `events/entity-write-bus.ts:47` logs the whole event object plus the raw
error, and `error.ts:304` logs `err.stack` for every unmapped 500.

**Rate limiting covers only `/api/auth/*`.** `/v1`, `/admin`, `/internal/*`, `/mcp`, and
`/webhooks/*` are unthrottled, behind Cloud Run at `--allow-unauthenticated --ingress=all` with no
WAF. No request body size limit exists anywhere.

**No dependency scanning, SAST, or license check in CI.** The gate chain is
`[lint, typecheck, secret-scan, test, build]`. The in-repo secret scanner is good work and covers
the tree but not git history. Separately, `pnpm-workspace.yaml:25` configures
`minimumReleaseAgeExclude` while `minimumReleaseAge` itself is set nowhere — the comment claims a
cooldown that is not in force.

**`Idempotency-Key` is documented and absent.** `openapi.ts:97` tells API consumers that creates
accept it. Nothing reads the header. A client that retries a create on timeout gets a duplicate.

**No policy documents.** No threat model, data classification, retention policy, incident response
plan, access review procedure, vendor register, or BC/DR. The string "SOC" appears nowhere in
`docs/`. Backups are undocumented — no retention window, no restore procedure, no restore test.

## Accepted risk

These are deliberate and should be written up rather than changed: the 30-day session window
(passkey-first, justified at `auth-builder.ts:321`), the split CORS policy (the `origin: '*'` leg
carries no credentials), the committed `.env.local` (placeholders only, protected by
`skip-worktree`), the absent content CSP (`web/next.config.ts:49` explains the nonce-pipeline
dependency), and ULIDs disclosing creation time.

One is worth naming separately: users can connect arbitrary MCP servers, so the subprocessor list
is not enumerable at audit time. That needs a control narrative of its own, not a register entry.

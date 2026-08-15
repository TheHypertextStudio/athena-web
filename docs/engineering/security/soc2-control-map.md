# SOC 2 control map

**Reader:** whoever sequences the work toward a Type II report. This says which Trust Services
Criteria the codebase already satisfies, which have no implementation, and where the evidence for
each comes from. It contains no policy prose — the policy set is separate work, and much of it
gates on decisions nobody has made yet.

**Status as of 2026-08-14:** no auditor engaged, no compliance platform. Evidence is therefore
self-managed, and this document notes where a platform would later take over collection.

## The one thing that decides the schedule

Type II grades a **window**, not a moment. A bug fixed in month six costs nothing extra; a control
that _starts producing evidence_ in month six resets the window. So the ordering is not
scariest-first — it is evidence-generating-controls first, then risk-ordered code. Everything under
"Start the window" below exists because its value is proportional to elapsed time.

## Criteria with real gaps

### CC6.1 — Logical access, encryption, key management

Present: passkey-first authentication with no credential provider at all; `requireAuth` mounted
globally with a four-entry allowlist; a ReBAC policy engine (`packages/authz`) with capability
ranks and containment chains; AES-256-GCM sealing of stored third-party credentials with no
fallback key; encrypted OAuth tokens and backup codes.

Missing, in order of how hard an auditor will push:

**Key rotation does not exist.** The credential envelope carries no key id, so re-keying requires
offline re-encryption of `integration_credential`, `personal_mcp_credential`, and
`lattice_credential` with the service down. `BETTER_AUTH_SECRET` is reused across six purposes, so
rotating it invalidates every session, every backup code, every OAuth state HMAC, every MCP cursor,
and an internal webhook signature simultaneously. Type II will want one rotation _performed_ inside
the window, which is not currently possible without an outage. Fix: a `kid` segment in the envelope
plus a key map, and HKDF purpose-derived subkeys for the auth secret.

**No AAD binds a ciphertext to its row**, so a sealed envelope is portable between rows and users.

**Encryption in transit is unenforced.** `client.ts:105` sets no `ssl` option; `DATABASE_URL` is
validated only as non-empty. Nothing fails if TLS is off.

**`CREDENTIALS_ENCRYPTION_KEY` is optional in production.**

Evidence: `apps/api/tests/security/credential-masking.test.ts` already proves at-rest sealing and
that no credential leaks through any response body. It is good evidence and should be cited.

### CC6.2, CC6.3 — Access provisioning, modification, removal

Present: invitation flow, role assignment, capability guards, a last-owner guard, and an
impersonation surface that always writes a session row.

Missing: **the audit trail.** `enums.ts:516` declares `member_added`, `member_removed`,
`role_changed`, and `grant_changed`; no code writes any of them. Access changes therefore leave no
record, which is the evidence CC6.2 and CC6.3 are _about_. `writeAudit` exists, is documented in
`specs/permissions.md:547` as the universal write path, and is dead code.

Also missing: any periodic access review. There is no procedure for reviewing `staff_user` grants
or org roles, and no record of one having happened.

Evidence once built: the `audit_event` feed plus a test asserting every declared event kind has a
writer, so "fifteen declared, three written" cannot recur.

### CC6.6, CC6.7 — Boundary protection, transmission

Present: a genuinely strong outbound guard (`mcp-network.ts`) with DNS pinning and a CIDR
blocklist; signature verification on every inbound webhook; security headers on both Next apps;
a split CORS policy whose wildcard leg carries no credentials.

Missing: **rate limiting outside `/api/auth/*`.** `/v1`, `/admin`, `/internal/*`, `/mcp`, and
`/webhooks/*` are unthrottled, behind Cloud Run at `--allow-unauthenticated --ingress=all` with no
WAF and no request body size limit. Also missing: replay windows on four webhooks, and a second
weaker SSRF guard in `cimd.ts` reachable before authentication.

Note for the narrative: `--allow-unauthenticated` means "Cloud Run IAM does not gate this," not
"anonymous callers get data." `apps/api/tests/security/route-auth.test.ts` derives its probe set
from the generated OpenAPI document and proves every documented route rejects anonymous callers.
That test is the control; say so, rather than letting the flag read as an open door.

### CC7.1 — Vulnerability detection

Present: an in-repo secret scanner gating CI, with a policy test proving it fires, and a
`ci-gate-policy` script that structurally rejects a check job added without being added to the
deploy gate. That last piece is unusually good and worth citing.

Missing: dependency vulnerability scanning, SAST, and license checking. None are in the gate chain.
Dependabot raises PRs but nothing blocks a merge on a known-vulnerable transitive dependency.
Separately, `minimumReleaseAgeExclude` is configured while `minimumReleaseAge` is not set anywhere,
so the release-age cooldown the comment describes is not in force.

### CC7.2, CC7.3 — Monitoring and evaluation of events

This is the emptiest criterion. There is **no logger** — 31 bare `console.*` in `apps/api` alone —
**no monitoring, and no alerting**. `SENTRY_DSN` is declared in `packages/env` and threaded into
turbo config with no SDK installed, which is worse than absent because it reads as present.

No security event reaches anything: not login, logout, failed authentication, permission denial,
data export, or account deletion. There is no request id and no HTTP access log.

Two existing log lines would leak if a logger were simply switched on:
`events/entity-write-bus.ts:47` logs the whole event object with the raw error, and `error.ts:304`
logs `err.stack` for every unmapped 500. A redaction allowlist has to land with the logger, not
after it.

### CC8.1 — Change management

Present, and strong: linear-history enforcement with native git hooks, conventional-commit
validation, a scoped commit vocabulary, migrations applied from the exact image being deployed,
Workload Identity Federation with no long-lived cloud key, and pre-deploy secret validation.

Missing: a written change-management policy.

Resolved: the two-tracker problem. `TASKS.yaml` was deleted 2026-08-15; `docs/WORKLOG.md` is now
the only task tracker in the repository.

### A1.2 — Availability, backup, recovery

Nothing is documented. No retention window, no restore procedure, no restore test, no RTO or RPO.
Neon presumably provides point-in-time recovery; the repo never says so. The closest artifact is
`packages/db/tests/migrations/production-snapshot-restore.test.ts`.

### C1.1, C1.2 — Confidentiality: retention and disposal

Present: a complete account-deletion pipeline with a 14-day grace period, an idempotent purge, and
sweeps for expired sessions and resolved email suggestions.

Missing: **org deletion purges nothing** — `billing/lifecycle.ts:166` is a state flip and says so.
Blobs orphan on account purge and export expiry. `inbound_event.payload` is retained indefinitely.
And there is no retention policy document, which matters more than it sounds: the policy is the
_specification_ for the purge job. Write it before building the sweep, or you will build a sweep
that contradicts the document you write afterward.

One conflict to resolve deliberately: a real purge collides with retaining `audit_event`. The
defensible answer is to purge tenant content and retain audit rows with anonymized subject
references for a stated period — but it has to be stated, or an auditor reads "we delete
everything on request" against "we keep audit logs for a year" and finds a contradiction.

## Criteria already satisfied

CC6.8 (unauthorized software) — postinstall scripts are blocked by default with an explicit
two-entry allowlist, and every CI install is `--frozen-lockfile` against a committed lockfile with
security-critical packages pinned exact.

CC5.2 / CC6.1 partial (input and output handling) — every mutating route validates through a Zod
validator; no route reads an unvalidated JSON body; mass assignment is structurally impossible; and
as of this branch response bodies are validated in production too.

## Sequence

**Start the window.** Logger with a redaction allowlist, replacing `console.*`. A `security_event`
table and the five chokepoints that write to it. Resurrect `writeAudit` as the only `audit_event`
writer and wire the four access-change kinds. API-wide rate limiting. Dependency scanning and SAST
in the gate chain. These generate the evidence a Type II window measures, so they go first
regardless of severity.

**Close the remaining agent boundary.** Narrow personal Athena's scopes to the already-justified
`AGENT_SESSION_SCOPES`, and bind a session's org set at creation rather than reading it from
model-supplied tool input. Note that scope narrowing collides with the `ATH-12` requirement that a
user can add an MCP connection without leaving Athena; route connector-linking through the existing
elicitation path instead of dropping the capability.

**Stop the remaining leaks.** The cross-tenant probe matrix (see below). Bounded lists via a
server-side cap. Org purge and the blob reaper.

**Integrity and keys.** Envelope `kid` and rotation, AAD, HKDF-derived auth subkeys, webhook replay
windows, the last-owner lock, and collapsing `cimd.ts` into the hardened guard.

**Perimeter and program.** WAF, ingress narrowing, access reviews, vendor register, BC/DR, and a
restore drill.

## Evidence, and what to automate

Prefer tests over documents wherever a test is possible: a document asserts, a gated test proves,
and the repo already knows this — `route-auth.test.ts` derives its probes from the OpenAPI document
so a new route cannot escape it.

The highest-leverage artifact not yet built is a **generated cross-tenant matrix**. Fork
`route-auth.test.ts`: seed two orgs, and for every documented `/orgs/{orgId}/*` route probe with
org A's session against org B's id, asserting 404 to match `orgContextMiddleware`'s existence-hiding
contract. Because the probes are generated, a route added next year is covered automatically. This
is what substitutes for row-level security, and it is a fraction of the cost — see
[rls-strategy.md](rls-strategy.md).

Four more invariants belong in the `packages/test-utils/tests/workspace-policies/` AST-walk style:
every declared audit kind has a writer; nothing outside `routes/activity.ts` inserts into
`audit_event`; no `role: 'user'` transcript message is constructed outside the provenance
chokepoint; and no bare `fetch` appears in the packages that have a hardened one.

Ship each with its recorded mutation. `LAUNCH-LEDGER-001` in the WORKLOG set the precedent —
it removed a clause and confirmed two tests went red, on the principle that a gate nobody has seen
fail is not known to be a gate. The provenance test on this branch was verified that way.

## Filing

Findings do **not** go into `launch-compliance.json`. `launch/README.md:206` states that file is
never hand-edited and nothing writes to it, and `launch-record.test.ts` reconciles the generated
record against its exact rows. Adding Security ids would break that gate and make launch sign-off
depend on SOC 2 work the launch plan never asked for.

State lives in two writable places and nowhere else: this document and the audit report for the
bar, `docs/WORKLOG.md` under `SEC-001` for execution. That split follows the doctrine
`launch/README.md` adopted after two ledgers disagreed about `GEN-07`.

# Billing Exemption Design

## Goal

Let staff grant specific organizations permanent, free, unlimited access to agent sessions — for internal use and comped users — without touching Stripe, without per-user cost scaling, and with a durable audit trail of who granted what and why.

## Context

Agent-session entitlement is a single choke point: `assertAgentSessionsEntitled(orgId)` in `apps/api/src/billing/entitlement.ts` reads `organization.lifecycleState` (Stripe-webhook-driven) and allows `trialing`/`active`. Billing is org-scoped and flat-rate — no per-seat or usage metering exists today, so once an org is entitled, adding more members to it has no incremental billing cost.

A Stripe 100%-off coupon was considered and rejected: it still creates a real subscription per org, makes access dependent on Stripe webhook delivery staying healthy forever, and mixes $0 accounts into Stripe's own revenue/subscription reporting.

## Design

### Data model

New `billing_exemption` table in `packages/db/src/schema/admin.ts` (alongside the existing `lifecycleHold`, same shape/spirit):

- `id`, `organizationId` (FK → `organization`, cascade)
- `reason` (required text)
- `grantedBy` (FK → `staff_user`, `set null`)
- `createdAt`
- `revokedBy` (FK → `staff_user`, `set null`, nullable)
- `revokedAt` (nullable)

A row _is_ the grant event; revoking sets `revokedBy`/`revokedAt` rather than deleting. No separate boolean flag exists to drift out of sync — the row's existence with `revokedAt IS NULL` is the single source of truth for "is this org exempt."

Indexes: `organizationId` (lookup), and a **partial unique index** on `organizationId WHERE revoked_at IS NULL` (prevents two simultaneous active grants on one org).

### Entitlement check

`assertAgentSessionsEntitled` extends its existing query with a `LEFT JOIN` against `billing_exemption` (`revokedAt IS NULL`). An org is entitled when `lifecycleState` is `trialing`/`active` **or** an active exemption row exists. One indexed round-trip added to a hot path (every agent session) — negligible latency.

### Admin routes

Two routes added to `apps/api/src/routes/admin-billing-routes.ts`, mirroring the lifecycle-hold pattern:

- `POST /admin/orgs/:id/billing-exemption` — body `{ reason }`, gated `requireStaffRole('superadmin')`. Inserts the grant row. Bumped above the `finance` tier used for extend-trial/reactivate/set-lifecycle: those are time-boxed or recovery-oriented, while an exemption is an indefinite, full bypass of the revenue gate — higher blast radius, highest tier.
- `DELETE /admin/orgs/:id/billing-exemption` — revokes the active grant via a single atomic conditional update (`UPDATE ... WHERE organizationId = id AND revokedAt IS NULL RETURNING`, mirroring the existing hold-release pattern), 404 if no row matched. The atomicity closes a TOCTOU race where two concurrent revokes could double-fire the audit event.

Both write to the existing `operatorAuditEvent` table (`billing.exemption_granted` / `billing.exemption_revoked`) — reusing the audit mechanism every other admin action already uses, no new audit table.

DTOs added to `apps/api/src/admin-dto.ts` (`AdminBillingExemptionOut`, `GrantExemptionBody`) and a serializer added to `apps/api/src/routes/admin-serializers.ts` (`toExemptionOut`), following the existing `AdminHoldOut`/`toHoldOut` pattern exactly.

### Visibility

`AdminOrgOut` gains `isBillingExempt: boolean`, derived from whether an active exemption row exists, so staff see exemption status whenever they view an org in the back-office — not only via the audit feed.

### Operational workflow

Each free user signs up normally (their own personal org, same as a paying user — no shared-org bookkeeping). Staff call `POST /admin/orgs/:id/billing-exemption` with a reason; the org bypasses the lifecycle-state gate indefinitely. `DELETE` the same route to revert to the normal Stripe-driven gate.

## Error handling

- Granting an exemption on an org that already has an active one: the partial unique index is the actual guard (closes the race between two concurrent grants); the route catches the constraint violation and returns a clean `409` rather than a raw DB error / `500`.
- Revoking when no active exemption exists: 404, matching the hold-release convention (`releasedAt IS NULL` guard), via the atomic conditional update described above.
- Org not found: 404, matching every other admin-org route (`loadOrg`).

## Testing

- Unit: `assertAgentSessionsEntitled` grants access via an active exemption row even when `lifecycleState` is non-entitled (e.g. `past_due`), and stops granting it once revoked.
- Unit: partial unique index rejects a second concurrent active grant.
- Route tests: grant/revoke round-trip, 404s (org not found, no active exemption to revoke), 409 on double-grant, `requireStaffRole('superadmin')` enforcement (support and finance tiers → 403), audit event written on both actions.
- `AdminOrgOut.isBillingExempt` reflects grant/revoke state in list and detail responses.

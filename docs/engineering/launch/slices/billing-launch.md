---
slice: billing-launch
branch: codex/billing-launch-readiness
requirementIds: [MISS-03]
outcomes:
  MISS-03: partial
filesChanged:
  - apps/api/src/routes/billing.ts
  - apps/api/src/routes/billing-discounts.ts
  - apps/api/src/routes/webhooks.ts
  - apps/api/src/routes/admin-billing-routes.ts
  - apps/api/src/routes/admin-discount-routes.ts
  - apps/api/src/services/billing-reconciliation.ts
  - apps/api/src/services/billing-notifications.ts
  - apps/web/src/components/settings/billing-settings.tsx
  - apps/web/src/components/settings/billing-discounts-section.tsx
  - apps/web/src/app/(app)/billing/start/page.tsx
  - apps/web/src/app/(app)/billing/return/page.tsx
  - apps/web/src/app/(marketing)/pricing/page.tsx
  - apps/admin/src/app/(admin)/discounts/page.tsx
  - apps/admin/src/app/(admin)/orgs/[id]/page.tsx
  - domains/billing/src
  - packages/db/src/schema/billing.ts
  - packages/db/drizzle/0101_minor_squadron_supreme.sql
  - packages/db/drizzle/0102_billing-lifecycle-data-repair.sql
  - docs/engineering/specs/product-billing.md
  - docs/engineering/billing-state-machine.md
  - docs/engineering/stripe-billing-runbook.md
verifier: Boyle
verifierArtifacts:
  - docs/engineering/launch/evidence/verification/2026-08-25-billing-launch-review.md
verification: 'Focused billing, API, Web, database, and tooling tests pass; root typecheck and lint pass; the production build passes; Drizzle reports no schema changes after migrations 0101 and 0102.'
---

## MISS-03 — A working web subscription must gate live phone access

**Acceptance:** On the production domain, the exact URL spoken by the phone announcement loads a
plans page with a purchasable plan. A customer without a plan must complete signup and payment. The
API must then report active access, and a call from the verified number must reach the live agent.
Cancellation must return the next call to the gated path.

**What was built:** The web now has one $8 USD monthly Docket Pro plan for US customers. The pricing
action uses Better Auth, sends an authenticated customer through an organization chooser, and starts
a card-required 14-day hosted Stripe Checkout session. The return page waits for webhook-backed
entitlement state instead of trusting the redirect. Billing settings shows trial, renewal,
cancellation, payment-grace, read-only, discount, credit, and complimentary states.

The API stores one Stripe customer per organization. It prevents duplicate Checkout attempts and
subscriptions. It claims signed events once, retrieves the current subscription before changing
access, and reconciles provider state on a schedule. The first failed invoice starts one seven-day
grace period. Cancellation preserves paid access through the period end, then makes shared work
read-only. Billing never schedules data deletion, and personal baseline work remains writable.

Finance can review student, nonprofit, and private partner discounts. Public programs provide 50
percent off for 12 months. Private awards allow 1 through 90 percent for no more than 24 months.
Awards cannot stack. Mid-period approval uses a confirmed Stripe credit-note preview. Customers do
not receive active-discount copy until provider synchronization succeeds. A superadmin can grant or
revoke an indefinite complimentary entitlement after resolving any paid subscription. That grant
uses the same Docket Pro capability catalog as paid access.

Migration 0101 adds the billing records and constraints. Migration 0102 seeds the public programs,
moves legacy past-due organizations into a seven-day entitlement grace period, and moves legacy
export-window or pending-deletion organizations to read-only access. The migration clears the old
billing-created deletion dates. It does not restore rows that an earlier purge already deleted.

**Evidence:** The independent review is in
`docs/engineering/launch/evidence/verification/2026-08-25-billing-launch-review.md`. Billing domain
tests pass 81 cases. Focused API billing tests pass 171 cases. Web billing tests pass 60 cases.
Database billing schema and upgrade tests pass four cases. Tooling tests pass 167 cases. Root type
checking and lint pass. The production build passes for API, Runner, Admin, Web, and the service
worker. `pnpm db:generate` reports `No schema changes, nothing to migrate` after migrations 0101 and 0102.

The isolated launch database replayed all 102 checked-in migrations. The launch audit then compared
two billed organizations with Stripe test mode. Each organization had one durable customer, one
current subscription, matching ownership and entitlement state, and no unresolved provider write.
The report contained zero findings.

Stripe test mode also proved hosted Checkout, the customer portal, signed webhook delivery,
duplicate delivery, failed payment, 3DS authentication, recovery, cancellation, reactivation,
renewal, discount application, discount removal, and credit-note behavior. A Student trial ended
with a paid $4 USD invoice. Docket kept the award scheduled during the trial, activated it at the
first paid period, started a new 12-month review clock, and issued no trial-period credit.

**Residual gap:** This requirement remains `partial`. The shared Stripe account identifies the
merchant as “The Rebuilding America Project,” not Docket. The team must provision a Docket Stripe
account or approve the shared legal merchant before accepting customers. The team has not run the
migration on a production-shaped snapshot, observed reconciliation for 24 hours, completed finance
and legal approval, or run the live $8 and 72-hour canaries. The Founder production grant and one
discounted live subscription remain unverified. The repository also lacks the required live
telephone round trip from a verified number through this entitlement. The release owner must keep
public Checkout disabled until those checks pass and the whole-product launch record reaches
sign-off.

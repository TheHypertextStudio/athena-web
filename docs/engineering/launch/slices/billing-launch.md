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
  - apps/api/src/services/billing-provider-state.ts
  - apps/api/src/services/scheduled-billing-reconciliation.ts
  - apps/api/src/services/billing-launch-audit.ts
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
  - packages/db/drizzle/0104_billing-credit-provider-identity.sql
  - packages/db/drizzle/0105_complimentary-trial-history.sql
  - docs/engineering/specs/product-billing.md
  - docs/engineering/billing-state-machine.md
  - docs/engineering/stripe-billing-runbook.md
verifier: Boyle
verifierArtifacts:
  - docs/engineering/launch/evidence/verification/2026-08-25-billing-launch-review.md
  - docs/engineering/launch/evidence/verification/2026-08-26-billing-launch-hardening.md
verification: 'Focused billing, API, Web, database, environment, and tooling tests pass; affected package typechecks and lint pass; the commit hook passes its repository package lint gate. The prior production build evidence predates the final hardening commits and must be repeated before deployment.'
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

The app shell catches `product_required` and `billing_grace_expired` from the shared typed read and
write caches. It shows one permission-aware recovery interaction. Billing managers can review the
plan or open hosted payment recovery directly. Other members learn which workspace roles can act.
The failed API request supplies the organization, so a delayed failure cannot target a workspace the
customer opened later. The Billing route carries a validated same-origin product location into
Checkout so the confirmed return restores the customer's place.

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
Migration 0104 makes provider credit-note identity unique. Migration 0105 lets complimentary access
record first Pro use before the organization has a Stripe customer. Checkout fills the customer id
later without clearing that trial history.

**Evidence:** The independent review is in
`docs/engineering/launch/evidence/verification/2026-08-25-billing-launch-review.md`. Billing domain
tests pass 81 cases. Focused API billing tests pass 171 cases. Web billing tests pass 60 cases.
Database billing schema and upgrade tests pass four cases. Tooling tests pass 167 cases. Root type
checking and lint pass. The production build passes for API, Runner, Admin, Web, and the service
worker. `pnpm db:generate` reports `No schema changes, nothing to migrate` after migrations 0101 and 0102.

The complete 0000 through 0105 chain replays on a fresh local PostgreSQL 16.15 database. That replay
does not contain production-shaped legacy billing rows, so the release owner must still run the
same chain and duplicate-customer report against a production-shaped snapshot. The prior provider
run used a Stripe account outside Hypertext Studio. Docket cannot use that run as payment-launch
evidence. The release owner must repeat the launch audit and every hosted payment path in the
Hypertext Studio Stripe test account.

**Residual gap:** This requirement remains `partial`. Stripe is exclusively a Hypertext Studio
provider, and no valid Hypertext Studio test-mode or live-mode evidence exists in this slice. The
team has not run the migration on a production-shaped snapshot, observed reconciliation for 24
hours, completed finance and legal approval, or run the live $8 and 72-hour canaries. The Founder
production grant and one discounted live subscription remain unverified. The repository also lacks
the required live telephone round trip from a verified number through this entitlement. The release
owner must keep public Checkout disabled until those checks pass and the whole-product launch
record reaches sign-off.

# Billing launch review — 2026-08-25

The release owner is the reader. The release owner must complete every external gate, regenerate the
launch record, and keep public Checkout disabled until MISS-03 reaches `closed`.

## Verdict

**MISS-03: PARTIAL.** The current local slice resolves every prior Critical, Important, and Minor
code finding. It also resolves the transaction-bound task visibility defect found during the root
test run. Stripe test-mode payment and recovery paths now pass. Merchant identity, production,
finance, legal, and telephony gates remain open, so this review cannot pass MISS-03 or authorize a
public launch.

This review covers commit `94a94f2a1a6ae9b5c446375413b5463eaaff629c` plus the uncommitted billing
slice present on 2026-08-25. The repository launch record now lists MISS-03 as `in-progress` with
this file as its verification artifact. The root launch record still has `signOff: false`.

## Prior findings

### Critical

The prior shared-workspace read-only finding is **resolved**. The capability guard now allows the
POST-based work-view query, facet, mention-hydration, and replay reads. It also treats lazy-writing
GET routes for cycle creation, Athena chat sessions, and Notion design materialization as writes.
The route test proves that a read-only organization can read existing work and use the POST-based
read endpoints. The same test proves that the guard rejects shared-work writes and every reviewed
mutating GET. The implementation is in `apps/api/src/product-capability.ts:47-75`. The coverage is
in `apps/api/tests/routes/group-d.test.ts:375-445`.

No Critical code finding remains in this review.

### Important

All prior Important code findings are **resolved**:

1. Public and partner discount confirmations now freeze the Stripe subscription identity, customer,
   status, period end, trial end, cancellation state, discount ids, and coupon ids. Approval reloads
   the current subscription and rejects a changed snapshot. The implementation is in
   `apps/api/src/routes/admin-discount-routes.ts:222-307` and
   `apps/api/src/routes/admin-billing-routes.ts:214-369`. The tests are in
   `apps/api/tests/routes/admin.test.ts:272-290` and
   `apps/api/tests/routes/admin.test.ts:341-368`.
2. Reconciliation now requires exactly one provider discount and exactly one provider coupon. One
   of those identifiers must match the current Docket award. A second Stripe-side discount now
   creates a mismatch instead of passing the no-stacking check. The implementation is in
   `apps/api/src/services/billing-reconciliation.ts:400-423`. The test is in
   `apps/api/tests/services/billing-reconciliation.test.ts:118-168`.
3. Award revocation now removes the provider discount when the award has either a Stripe discount id
   or only a coupon id. It updates the Docket award only after Stripe confirms removal. The
   implementation is in `apps/api/src/routes/admin-discount-routes.ts:1094-1125`. The coupon-only
   test is in `apps/api/tests/routes/admin.test.ts:448-497`.
4. The repository no longer changes the historical 0100 migration. The additive 0102 migration
   backfills past-due entitlements, converts legacy export-window and pending-deletion organizations
   to read-only entitlements, preserves complimentary grants, clears billing-created deletion
   fields, and leaves purged organizations untouched. The migration is
   `packages/db/drizzle/0102_billing-lifecycle-data-repair.sql:20-91`. The upgrade-path test is in
   `packages/db/tests/migrations/billing-lifecycle-data-repair.test.ts:28-180`.

No Important code finding remains in this review.

### Minor

The prior complimentary customer-copy finding is **resolved**. The Billing settings component uses
active complimentary status for both the plan label and its explanatory copy. A revoked grant no
longer claims that all Pro features are included. The implementation is in
`apps/web/src/components/settings/billing-settings.tsx:139-184`.

The prior lifecycle documentation finding is **resolved**. The module documentation now identifies
`GET /lifecycle` as a deprecated compatibility read. It states that billing never changes account
retention state and names the confirmed Danger Zone flow as the owner of deletion. `LifecycleOut`
now describes its fields as legacy account-retention values and states that billing never sets the
deletion deadline. The route documentation also directs clients to the billing summary for current
access, cancellation, and grace state. The corrected source is in
`apps/api/src/routes/billing.ts:11-19`, `apps/api/src/routes/billing.ts:184-205`, and
`apps/api/src/routes/billing.ts:483-507`.

No Minor code finding remains in this review.

## Transaction-bound task visibility

The task authorization defect found by the full root test run is **resolved**. `loadTaskViewScope`,
`buildTaskViewFilter`, and `assertTaskCapability` now accept the active database or transaction.
The fallback task-visibility read uses the same transaction as the locked task mutation. It no
longer opens a global database read that can wait behind its own PGlite transaction. The change is
in `apps/api/src/routes/task-helpers.ts:154-161`, `apps/api/src/routes/task-helpers.ts:256-262`, and
`apps/api/src/routes/task-helpers.ts:379-401`. The focused task-detail and helper suites pass 71
tests, including all 55 task-detail cases.

## Other resolved review areas

The current slice retains the following reviewed behavior:

- Webhook processing retrieves the current Stripe subscription before it grants access. It binds
  the durable customer, claims a provider event once, rejects stale observations, and keeps the
  first seven-day payment grace deadline.
- Legacy reconciliation backfills one Stripe customer id. It alerts when ownership is unresolved
  instead of creating a second customer.
- Checkout stores one attempt, reuses an open session, retains an ambiguous creation lease, uses a
  stable Stripe idempotency key, and checks provider subscriptions before it creates Checkout.
- Checkout and reconciliation enforce a US billing country. Invoice selection requires the Docket
  Pro price, a recurring subscription item, and a non-proration line.
- Better Auth provides the verified session email for student submission, renewal, and supplemented
  institutional-email evidence.
- Public and private approvals require a stored 15-minute preview. Private partner grant, renewal,
  and revocation controls require finance access.
- Complimentary grant and revocation controls require superadmin access. They reject a current paid
  subscription, update the entitlement, write an audit event, and send an essential notice.
- Customer summaries exclude terminal awards from the effective discount. Customer renewal actions
  only appear for active or ending awards. Staff actions use server-derived permissions.
- Essential notices cover trial ending, payment failure and recovery, cancellation, read-only
  transition, application decisions, discount review, expiry, renewal, revocation, credits, and
  complimentary entitlement changes.

## Independent commands and results

The verifier reran the following focused checks against the current tree:

| Command                                                                                                                                                                                                                                | Result                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm --filter @docket/api exec vitest run tests/routes/group-d.test.ts tests/routes/webhooks-extra.test.ts tests/routes/billing-http.test.ts tests/routes/admin.test.ts tests/services/billing-reconciliation.test.ts --maxWorkers=1` | PASS. 5 files and 121 tests passed in 20.77 seconds. |
| `pnpm --filter @docket/db exec vitest run tests/schema/billing-launch-schema.test.ts tests/migrations/billing-lifecycle-data-repair.test.ts --maxWorkers=1`                                                                            | PASS. 2 files and 4 tests passed in 6.24 seconds.    |
| `pnpm --filter @docket/billing exec vitest run tests/adapters/stripe.test.ts tests/application/lifecycle.test.ts tests/application/provider-state.test.ts tests/application/entitlement.test.ts --maxWorkers=1`                        | PASS. 4 files and 81 tests passed in 8.50 seconds.   |
| `pnpm --filter @docket/web exec vitest run tests/components/settings/billing-settings.test.tsx tests/billing/billing-return.test.tsx tests/billing/start-billing.test.tsx tests/auth/entry-gate.test.ts --maxWorkers=1`                | PASS. 4 files and 60 tests passed in 7.56 seconds.   |
| `pnpm --filter @docket/api exec vitest run tests/routes/tasks-detail.test.ts tests/routes/task-helpers.test.ts --maxWorkers=1`                                                                                                         | PASS. 2 files and 71 tests passed in 13.92 seconds.  |
| `git diff --check`                                                                                                                                                                                                                     | PASS. Git reported no whitespace error.              |

## Production build evidence in the tree

The verifier did not rerun the complete root typecheck, lint, or production build. The current
`docs/WORKLOG.md` entry records that root type checking and lint passed. It also records successful
production builds for API, Runner, Admin, Web, and the service worker. The tree contains the
corresponding build outputs dated 2026-08-25:

- `apps/api/dist/routes/task-helpers.d.ts` has a 17:03:59 -0700 modification time.
- `apps/runner/dist/index.js` has a 17:03:20 -0700 modification time.
- `apps/admin/.next/BUILD_ID` has a 17:04:42 -0700 modification time and contains
  `pNXZvrlTJOo4IxhK_jxtu`.
- `apps/web/.next/BUILD_ID` has a 17:05:16 -0700 modification time and contains
  `7G6mKVLzLWdAL5ZZ6bjFa`.
- `apps/web/public/sw.js` has a 17:05:19 -0700 modification time.

This repository evidence supports the work log. It does not prove that the same build is deployed
or that its runtime configuration is correct.

## External gates that remain open

No local test or build evidence in this review closes these launch gates:

1. Finance must configure and approve the US tax-registration matrix, invoice settings, credit-note
   treatment, refund policy, and reconciliation reports. Legal must approve the trial, cancellation,
   read-only retention, discount evidence, eligibility, and tax language.
2. The shared Stripe account identifies the hosted merchant as “The Rebuilding America Project.”
   Finance must provision a Docket Stripe account or approve the shared legal merchant before
   public Checkout. The checked-in test-mode evidence now proves hosted Checkout, the customer
   portal, signed webhooks, duplicate delivery, failed-card recovery, authentication-required
   payment, cancellation, reactivation, renewal, discounts, and credit notes.
3. A production-shaped database snapshot must run the additive migrations. The report must show one
   Stripe customer and at most one current subscription per billed organization. Every unresolved
   row blocks enablement. The team must then observe shadow reconciliation for at least 24 hours.
4. The production canary must complete one real $8 purchase, portal visit, cancellation at period
   end, reactivation, invoice receipt, and refund or credit-note accounting check. It must also prove
   the Founder complimentary organization and one approved discounted subscription.
5. Public Checkout must remain off until a 72-hour canary completes with no unresolved entitlement
   mismatch, duplicate subscription, failed credit, or payment-access incident.
6. Docket Pro advertises voice as a granted capability, but real telephony requirements ACH-09
   through ACH-12 remain unbuilt. The team has not selected or verified a telephony vendor. Billing
   entitlement tests do not prove a live telephone call or persisted telephone conversation.
7. The release owner must verify deployed runtime configuration, run Stripe's live-mode checklist,
   regenerate `docs/engineering/launch/launch-record.json`, and withhold whole-product sign-off until
   the launch record itself reaches sign-off.

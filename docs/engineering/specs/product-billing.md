# Product billing

> **Reader:** The engineer who changes Docket billing and the finance owner who configures Stripe.
>
> **Action:** Keep public Checkout disabled until every release gate in this document passes.
>
> **Status:** Implemented locally on 2026-08-25. The prior Stripe test-mode run used an account that
> does not belong to Hypertext Studio, so it is not launch evidence. Hypertext Studio merchant
> identity, fresh test-mode proof, production-snapshot migration, finance, legal, and live canary
> proof remain open.

## Product contract

Docket is free for personal planning, scheduling, and time tracking. Docket Pro costs $8 USD per
organization each month, plus tax where required. It adds shared work, integrations, MCP, Athena,
and voice. Launch supports monthly USD subscriptions and US billing addresses only.

The server grants each organization at most one 14-day card-required trial. The durable
`trial_consumed_at` value prevents a canceled subscription or complimentary grant from creating a
second public trial.

The product uses these customer states:

| State                  | Access and customer action                                                           |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Free                   | Personal baseline remains writable. The customer may start a trial or apply for aid. |
| Trialing               | Pro works. Billing shows the first charge date, discount, and payment method action. |
| Active                 | Pro works. Billing shows renewal, invoices, cancellation, and discount review.       |
| Past due               | Pro works for seven days. Billing shows the deadline and payment-method action.      |
| Cancellation scheduled | Pro works through the paid period, then shared work becomes read-only.               |
| Read-only              | Shared data remains readable and exportable. An administrator may restart Pro.       |
| Complimentary          | Every current and future Pro capability works without price, renewal, or payment UI. |

Billing cancellation never schedules data deletion. The confirmed account Danger Zone owns data
deletion. Administrators retain export access in every non-deleted billing state.

## Stored ownership

`organization_billing_account` stores durable billing history, first Pro access, and US
billing-country verification. Its Stripe customer id remains null for complimentary-only access.
Checkout or reconciliation fills that id before the first provider operation. A complimentary
grant stamps first Pro access, and revocation never clears it, so the organization cannot receive a
later public trial. `organization_product_entitlement` stores the mirrored subscription status,
period end, cancellation flag, seven-day grace deadline, and last provider observation.
`billing_checkout_attempt` prevents repeated clicks from creating concurrent Checkout sessions.
`billing_provider_event` claims each Stripe event once.

`docket_pro` grants `shared_work`, `integrations`, `mcp`, `athena`, and `voice`. A complimentary
entitlement uses the same capability catalog, so it cannot drift behind the paid product. A paid
capability failure returns HTTP 402 with stable Problem code `product_required` and an upgrade
path. Baseline personal features do not require an entitlement row.

## Stripe boundary

Docket persists the Stripe customer before creating Checkout. Checkout always uses that customer,
requires billing address and payment method collection, enables automatic tax and tax-id
collection, uses dynamic payment methods, and does not accept customer-entered promotion codes.
Every provider mutation carries a Docket idempotency key.

Stripe does not offer an allowed-country list for billing addresses. Docket therefore reads the
saved customer billing country after hosted Checkout and on every webhook or scheduled
reconciliation observation. Docket reconciles Pro access only after the country is `US`. It cancels
a new non-US trial before the first charge and does not grant product access. Reconciliation marks
a backfilled customer from an existing subscription as exempt from the new-address check, so a
previously uncollected address cannot revoke existing access. If a paid customer later changes the
billing country outside the US, Docket schedules cancellation at period end and preserves the paid
service period while finance reviews the account.

The portal uses the stored Stripe customer id. It owns payment methods, invoices, and
cancellation-at-period-end. It does not allow plan switching or coupon entry. The return URL points
to the originating organization's Billing settings.

## Provider events and reconciliation

The webhook consumes Checkout completion, subscription create/update/delete, invoice paid,
invoice payment failure, payment action required, and trial ending. Checkout completion does not
grant access by itself. The handler retrieves the current Stripe subscription and reconciles that
canonical snapshot. Mutable events use the same retrieval path, so duplicate and reversed Stripe
delivery cannot restore stale access.

The first failed payment starts one seven-day grace period. Later failures do not extend it. A paid
invoice clears grace and restores access. Cancellation preserves Pro through
`current_period_end`; the canceled observation changes shared work to read-only and leaves all
retention columns alone.

The `billing-reconciliation` job runs every 15 minutes under one explicit deployment mode. `off`
makes no Stripe call. `shadow` runs the read-only launch audit and reports drift without changing
Stripe, entitlements, awards, applications, or evidence. `active` repairs a mirror only when Stripe
has zero or one current subscription. Public Checkout cannot start unless the mode is `active`.

Active reconciliation records an operator alert and changes no provider state when it finds
duplicates. It compares the expanded Stripe discount and coupon identifiers with the current
Docket award. It activates a scheduled award only when the coupon matches. It alerts on an unknown
or mismatched discount. It also records the latest invoice observation, ends unrenewed awards,
sends eligibility reminders, and removes expired evidence. The worker never cancels a duplicate or
issues money. A staff-requested organization reconciliation inspects only that organization. It
does not advance installation-wide awards, expire applications, or delete evidence. Finance
actions that change trials or discounts also refuse to proceed when Stripe reports more than one
current subscription.

## Discounts

Docket seeds two public programs. Student eligibility gives the verified person's personal
workspace 50% off for 12 months. Docket accepts the Better Auth account's verified institutional
email or a dated enrollment document. Nonprofit eligibility gives a verified organization 50% off
with annual review. Docket accepts an EIN plus an IRS registry record or determination letter.

Applications and awards have separate state machines. Finance must give a reason when it requests
information, approves, rejects, renews, or revokes. Support may inspect the queue and evidence but
cannot make a revenue decision. One partial unique index prevents two applications in review. A
second partial unique index prevents stacked current awards.

Finance may create a private partner award from 1% through 90% with an end date no more than 24
months away. A 100% or permanent grant must use the superadmin-only complimentary entitlement.

Docket applies an approved coupon at Checkout when no subscription exists. A public award remains
`scheduled` while the subscription is trialing. Its 12-month review period starts with the first
paid period. Reconciliation repairs an early provider event that reports the award active during
the trial. Docket applies the coupon without proration for an existing paid subscription. When the
current invoice has a paid recurring line, finance previews and issues a Stripe credit note for the
unused service period. Stripe calculates tax. Docket stores the exact preview for 15 minutes.
Approval requires that preview's confirmation id, so Docket never recalculates or changes the
credit after finance confirms it.
Private partner awards use the same preview-before-approval rule. Docket stores the preview and
issued values. Docket does not show the award as active until Stripe confirms every provider
write.

Private evidence uses object storage behind authenticated API routes. The API accepts PDF, PNG,
and JPEG files up to 4 MB. It never returns an object key to the customer. Docket deletes the file
30 days after a final decision and retains only evidence type, dates, decision history, and audit
records.

## Customer and staff experience

Billing settings shows the current plan first. It shows status, list price, tax language, trial or
renewal date, cancellation date, grace deadline, effective discount, review date, issued credit,
and the next available action. Members without billing permission see the same state and learn that
a workspace administrator must act.

The authenticated app shell observes typed API failures from the shared TanStack Query read and
write caches. `product_required` opens a Docket Pro recovery action. `billing_grace_expired` opens
payment recovery. The interaction reads billing permission from the organization billing summary,
which derives its actor from the Better Auth session. Billing managers receive the provider action.
Other members learn that a workspace owner or administrator must act. Docket preserves the failed
product route through Billing and hosted Checkout. The recovery request binds to the organization
in the failed API request, so a later workspace switch cannot open or change billing for a different
organization. Docket accepts only same-origin return paths, and the interaction never renders
provider error text.

The pricing action passes through Better Auth and an organization chooser. The Checkout return
page polls billing state for 15 seconds and distinguishes confirmed, processing, canceled, and
failed outcomes. It never treats the browser redirect as payment proof.

Customer identity comes from Better Auth's server session API. Student submission, supplemental
email evidence, and renewal use the current session's verified email. Docket does not accept an
email supplied by the browser as proof of eligibility.

Payment and access notices use the shared notification service with user preference bypass. Docket
sends them through web and email because disabling optional billing news cannot suppress payment
failure, read-only, cancellation, discount-decision, or complimentary-grant notices.

The staff console exposes Stripe customer and subscription ids, provider observation, reconciliation
errors, application history, private evidence downloads, award state, credit-note results, and
complimentary controls. Finance previews approval effects before confirmation. Superadmins must
give an audit reason for complimentary grants and revocations. Support sees the same diagnostics
and evidence but does not see finance or superadmin mutation controls.

## Release gates

The local implementation is not public-launch proof. The release owner must complete these gates:

1. Run migrations against a production-shaped snapshot. The report must show one Stripe customer
   and no more than one current subscription per billed organization. Every unresolved row blocks
   enablement.
2. Deploy additive migrations with `BILLING_ENABLED=false` and
   `BILLING_RECONCILIATION_MODE=shadow`. Observe the read-only scheduled audit for at least 24
   hours. Pin the runtime to the account id from an independently verified Hypertext Studio
   Dashboard session. Resolve every finding before changing the mode to `active`.
3. Run hosted Checkout, the portal, signed webhook replay, automatic tax, failed-card recovery,
   authentication-required payment, cancellation, renewal, discount application, and credit notes
   in the Hypertext Studio Stripe test account. Evidence from another Stripe account does not
   satisfy this gate.
4. Have finance approve US tax registrations, invoices, credits, refunds, and reconciliation.
   Have legal approve trial renewal, cancellation, read-only retention, discount evidence, tax,
   Pricing, Terms, and Privacy copy.
5. Run one live $8 purchase, portal visit, cancellation, reactivation, invoice, and refund or credit
   check. Verify the Founder complimentary organization and one discounted live subscription.
6. Hold the canary for 72 hours with no entitlement mismatch, duplicate subscription, failed
   credit, or payment-access incident.
7. Regenerate the repository launch record. Whole-product launch remains blocked until that record
   reaches sign-off.

Rollback disables new Checkout and applications. It leaves the portal, webhooks, reconciliation,
notices, and existing entitlements running.

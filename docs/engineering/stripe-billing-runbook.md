# Stripe billing operations

> **Reader:** The on-call engineer and finance owner operating Docket billing.
>
> **Action:** Use these checks before enablement and when reconciliation reports drift.

## Enablement

Keep `BILLING_ENABLED=false` while migrations or backfill rows remain unresolved. Configure the
Docket Pro product and its $8 USD monthly price through `pnpm integrations`. Configure the customer
portal for payment methods, invoices, and cancellation at period end. Disable plan switching and
promotion codes. Configure Stripe Tax only after finance approves the US registration matrix.

Run the database migrations against a production-shaped snapshot. Query
`organization_billing_account` and compare each row with Stripe. Every billed organization must
have one customer and no more than one current Docket Pro subscription. Do not create a second
customer when a backfill cannot resolve the first one. Record and resolve the mismatch.

Deploy the reconciliation endpoint and Cloud Scheduler job before enabling Checkout. Inspect
`billing_provider_sync` rows where `operation = 'reconcile_billing'`. A `failed` row blocks public
enablement. Observe this shadow pass for at least 24 hours.

## Duplicate subscriptions

The reconciliation job reports the organization and subscription count. It does not cancel
anything. Finance must inspect both subscriptions, their invoices, payment state, and service
periods in Stripe. Finance decides which subscription to keep and whether the other needs a refund
or credit. After finance resolves the provider state, run the reconciliation endpoint again and
confirm that its row changes to `succeeded`.

## Payment and access drift

Compare the Stripe subscription with `organization_product_entitlement`. A healthy row matches the
subscription id, status, period end, cancellation flag, and latest provider observation. Replay the
signed Stripe event or run billing reconciliation to repair safe mirror drift. Do not edit the
entitlement status column to make an unpaid organization active.

The first failed invoice starts a seven-day grace period. A later failure must keep the original
deadline. A paid invoice must clear grace. When Docket shows stale access after a valid event, check
the provider-event ledger for duplicate or stale observations before replaying the event.

## Discount failures

An application remains unapproved until the award, coupon, subscription discount, and any credit
note succeed. Inspect the `billing_provider_sync` and `billing_discount_award.provider_sync_error`
values. Finance may retry approval. The idempotency keys reuse the same coupon, subscription
change, and credit note.

Finance must preview every application or private partner approval. The preview identifies the
recurring invoice line, unused service period, base amount, Stripe tax effect, and customer-balance
credit. The confirmation expires after 15 minutes. Finance must request a new preview after it
expires or after changing the percentage, end date, or reason. Docket issues only the stored
preview. Docket never issues a cash refund through the discount approval path.

Reconciliation expands the current Stripe subscription discounts. A scheduled award may become
active only when its coupon id matches Stripe. A missing, unknown, or mismatched coupon or discount
creates a failed `reconcile_billing` row. Finance must inspect the provider and local award before
changing either one.

## Evidence retention

The reconciliation job deletes private evidence after `delete_after`. A failed object deletion
leaves `deleted_at` empty, so the next pass retries. Staff can download evidence only through the
authenticated application route. A customer or staff response must never expose `blob_key`.

## Rollback

Set `BILLING_ENABLED=false` and disable new discount applications. Do not disable the Stripe portal,
webhooks, billing reconciliation, essential notices, or existing entitlements. Those paths protect
customers who already paid. Record the rollback time and affected organizations before changing
provider state or issuing money.

## Live canary

Use one controlled organization. Complete one live $8 purchase, portal visit,
cancellation-at-period-end, reactivation, invoice receipt, and refund or credit-note accounting
check. Confirm the Founder organization shows Complimentary Docket Pro with all five capabilities.
Confirm one approved discount shows its percentage, review date, and issued credit. Keep public
Checkout closed for 72 hours after the canary begins.

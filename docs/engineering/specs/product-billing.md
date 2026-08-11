# Product billing

> **Status:** Implemented locally; production purchase-path proof required before revised pricing
> copy is released.
>
> **Last updated:** 2026-08-11

## Product contract

Docket and Docket Pro are separate products.

- **Docket** is available without a billing record. It supplies one personal workspace with
  planning, scheduling, and time tracking.
- **Docket Pro** costs USD $8 per organization each month. It supplies shared work, integrations,
  MCP, and current Athena and voice functionality.

`docket_pro` is the only paid product key shipped now. Possible future products use the same
ownership and capability mechanism, but they do not appear in public copy or runtime catalogs
until they exist.

## Ownership and capabilities

`organization_product_entitlement` records ownership with the composite key
`(organization_id, product_key)`. A missing row means the organization owns no paid product; it
does not remove baseline Docket access.

| Field                    | Meaning                                                |
| ------------------------ | ------------------------------------------------------ |
| `product_key`            | Stable product identifier; currently `docket_pro`      |
| `status`                 | `trialing`, `active`, `past_due`, or `canceled`        |
| `source`                 | `stripe` or `complimentary`                            |
| `stripe_subscription_id` | Stripe subscription mirror when the source is Stripe   |
| `trial_ends_at`          | End of the first 14-day Docket Pro trial, when present |
| `current_period_end`     | Renewal date mirrored from Stripe                      |
| `canceled_at`            | Product cancellation time                              |

Docket Pro grants five explicit capabilities:

- `shared_work`
- `integrations`
- `mcp`
- `athena`
- `voice`

`assertProductCapability(organizationId, capability)` permits a request only when an owned
`trialing` or `active` product grants that capability. Paid-capability failures return HTTP 402
with Problem code `product_required`. `agent_plan_required` remains in the Problem-code union for
one compatibility window, but new server failures do not emit it.

The route policy applies `shared_work` to shared-organization work routes, `integrations` to
provider connections, `mcp` to MCP connections and protocol access, `athena` to agent execution,
and `voice` to browser and telephone voice access. Billing and export routes remain reachable when
a paid product is inactive so an administrator can recover billing or export data.

## Complimentary products

Staff billing grants create or reactivate a complimentary Docket Pro entitlement. Revocation marks
that entitlement canceled. Historical `billing_exemption` rows remain for operator audit and API
compatibility, but they no longer determine product access.

## Stripe configuration and lifecycle

New configuration uses:

- `DOCKET_PRICE_LOOKUP_DOCKET_PRO=docket_pro_monthly`
- `STRIPE_PRICE_DOCKET_PRO=price_...` as the direct-price fallback

`DOCKET_PRICE_LOOKUP_TEAM` and `STRIPE_PRICE_TEAM` are read only as one-release compatibility
aliases. Current names always win when both are present. Docket Pro is monthly only.

Checkout owns its product, price, return URLs, and trial decision on the server. Return URLs use
`WEB_URL`; callers cannot provide an arbitrary redirect or price. An organization receives the
14-day trial only when it has never had a Docket Pro entitlement. Reopening checkout after a trial
or cancellation sends no new trial period. Product activation and status changes come from signed
Stripe webhooks, not from the browser return page.

`GET /v1/orgs/:orgId/billing` returns active-product summaries with status, source, trial end,
renewal date, and `canManageBilling`. Checkout and portal endpoints return hosted Stripe URLs. The
web settings page uses those endpoints; the return page explains that webhook confirmation, not
the redirect, controls availability.

## Cancellation

- Canceling Docket Pro for a personal organization marks the product canceled and returns the
  workspace to free Docket. Planning, scheduling, time records, and the workspace data remain.
- Canceling Docket Pro for a shared organization preserves the existing 14-day export window and
  subsequent deletion lifecycle. Billing and export access remain available during that window.

Past-due and canceled products grant no Docket Pro capability. Trialing, active, and complimentary
active products do.

## Release gate

Local types, tests, builds, and browser renders are necessary but do not prove production billing.
Before the revised pricing copy is published, an operator must verify in Stripe test mode and the
production deployment:

1. Docket Pro checkout opens at $8 per organization each month.
2. A signed webhook activates the product and every granted capability.
3. Billing management opens for an authorized organization administrator.
4. Personal cancellation preserves the free workspace and data.
5. Shared cancellation starts the export and deletion lifecycle.
6. Checkout return routing uses the deployed web origin and never grants access itself.
7. A returning organization receives no duplicate trial.

The legal pages also require operator and legal review before release.

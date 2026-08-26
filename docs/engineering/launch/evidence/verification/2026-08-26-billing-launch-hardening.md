# Billing launch hardening record

> **Reader:** The release owner who decides whether Docket may accept customer payments.
>
> **Action:** Treat the local implementation as ready for Hypertext Studio provider validation.
> Keep Checkout disabled until every external gate in this record passes.

## Result

The final local hardening is complete through commit `6b3695c4c`. The branch contains four billing
hardening commits after `origin/main`:

1. `1bf820b25` checks exact subscription ownership before provider mutations.
2. `c0f59e8db` uses canonical provider snapshots, protects complimentary access, reuses one
   unambiguous Stripe customer, and makes credit-note retries idempotent.
3. `4b9bafb5b` scopes staff reconciliation to one organization, preserves legacy address
   grandfathering, and refuses finance mutations over duplicate subscriptions.
4. `6b3695c4c` adds explicit `off`, `shadow`, and `active` scheduled reconciliation modes. It also
   removes automatic reads from the globally selected Stripe CLI profile.

No commit was pushed or deployed during this hardening pass. No pull request exists for this work.
No Stripe provider operation ran. Public Checkout remains disabled.

## Local evidence

The provider-state correction passed 108 focused API tests. The reconciliation rollout passed 100
focused billing, API, environment, tooling, and deployment-policy tests. API, billing, environment,
and test-utils typechecks passed. Focused lint passed after the first broad lint process exceeded
Node's default 2 GB heap. The commit hook then passed its staged test and repository package lint
gate with bounded package execution.

The hardening tests prove these boundaries:

- A staff reconciliation does not touch another organization or run installation-wide award and
  evidence maintenance.
- A legacy paid subscription does not lose access when Stripe first exposes a previously
  uncollected non-US address. A customer previously observed in the US still receives
  cancellation-at-period-end after moving outside the launch market.
- Finance cannot extend a trial or change a discount while Stripe reports duplicate current
  subscriptions.
- `off` makes no provider call. `shadow` reports provider drift without repairing it. `active`
  performs the scheduled safe-repair pass.
- Environment validation refuses `BILLING_ENABLED=true` unless scheduled reconciliation is
  `active`.
- Stripe provisioning emits `BILLING_ENABLED=false` and `BILLING_RECONCILIATION_MODE=off`.
- The setup wizard does not infer Stripe credentials or webhook secrets from a global CLI profile.

## Gates still open

The local evidence does not prove the merchant or deployed system. Stripe belongs only to
Hypertext Studio. The release owner must use the dedicated Hypertext Studio Chrome instance for
every Dashboard action and must repeat all provider checks in the Hypertext Studio Stripe account.

The following gates remain open:

1. The deployment must pin and verify the Hypertext Studio Stripe account identity before any
   provider read or mutation. The expected account-id contract still needs product-owner approval.
2. The complete migration chain, including 0103, must run against a production-shaped snapshot.
   The report must show one provider customer and at most one current subscription for every billed
   organization.
3. The deployed scheduler must run `shadow` for 24 hours without an unresolved audit finding. The
   release owner must then change it to `active` before enabling Checkout.
4. Finance and legal must approve merchant identity, tax registrations, invoices, credits,
   refunds, discount eligibility, evidence retention, and customer terms.
5. Hypertext Studio test mode must prove hosted Checkout, the portal, signed webhooks, failed-card
   recovery, payment authentication, cancellation, renewal, discounts, credit notes, and event
   replay.
6. Production must prove the Founder complimentary grant, one real $8 subscription, one discounted
   subscription, portal management, cancellation, reactivation, invoice delivery, and accounting
   treatment.
7. A 72-hour canary must finish without entitlement drift, duplicate subscriptions, failed credits,
   or payment-access incidents.
8. Docket must prove the advertised voice entitlement through the live telephone path before the
   whole product launch record can close MISS-03.

The release owner must repeat the affected build and deployed-runtime checks after these commits
reach the integration target. The whole-product launch record remains unsigned.

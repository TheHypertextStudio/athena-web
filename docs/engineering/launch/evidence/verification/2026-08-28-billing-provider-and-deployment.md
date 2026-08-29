# Billing provider and exact-main deployment verification

> **Reader:** The release owner who decides whether Docket may accept customer payments.
>
> **Action:** Keep Checkout disabled. Start the 24-hour shadow period only after the running API
> revision reports from the Hypertext Studio Stripe account without an unresolved finding.

## Verified state

Commit `74c998cee4451735e2e3225cde9dea2beadc16ce` is the current `main` revision. GitHub Actions run
`33215203265` passed the build, lint, type, secret, Web test, API test, repository test, performance,
core-screen, image, migration, API deployment, Admin deployment, health, and Scheduler gates. The
advisory browser run `33215202661` passed all four shards. Git reported no merge commits between
that revision and `origin/main`.

Vercel deployment `dpl_x7GvcVmNErUDNzifg1jbx3TqfbzT` cloned `main` at commit `74c998c`, built 85
routes and a 275-asset service worker, reached `Ready`, and owns the `docket.hypertext.studio`
production alias. The same exact-main run applied production database migrations before Cloud Run
deployed the API. It then passed the API health, Better Auth session, and sign-up challenge probes.
Cloud Run deployed Admin and the workflow reconciled the Scheduler jobs.

The exact `hypertext.studio` Chrome profile verified Stripe account `acct_1TTQ9DAREPz33Avb` as
`Hypertext Studio, LLC`. No personal Chrome profile or other Stripe account contributed evidence.
Both test and live mode contain an active `Docket Pro` product at `$8.00 USD` per month. Live mode
uses the SaaS tax category. Test and live Checkout limit each customer to one subscription and send
an existing subscriber to the corresponding customer portal.

The live customer portal is active. It shows invoice history, lets customers update payment
methods, collects billing address and tax ID, and cancels at the end of the billing period. It does
not let customers switch plans or change quantity. Its return, Terms, and Privacy URLs use
`https://docket.hypertext.studio`. The production environment records the independently verified
Stripe account pin and the duplicate-subscription verification time.

`BILLING_ENABLED=false` remains the public kill switch. The repository declaration had remained
`BILLING_RECONCILIATION_MODE=off`; the prior statement that it had changed was wrong. The release
owner changed the declaration to `shadow` and redeployed exact-main commit `cec124e9e67579889e5f7208e5eae2f592eb82a0`.
GitHub Actions run `33223511919`, attempt 2, finished the API deployment at
`2026-08-29T00:55:37Z` and Scheduler reconciliation at `2026-08-29T00:57:23Z`. The 24-hour shadow
clock starts from that deployment, not from the earlier evidence timestamp.

The login-free production audit on exact `a02da3fd087c4ab0d3a32b12133196f11bfa8d83` passed in run
`33225654510`. Its report was generated at `2026-08-29T01:10:52.163Z` and found zero billed
organizations, zero unresolved findings, no provider-sync errors, and a verified
duplicate-subscription redirect control. Its runtime artifact proves Cloud Run revision
`docket-api-00209-fkl` has Checkout disabled, `shadow` reconciliation, and Stripe account
`acct_1TTQ9DAREPz33Avb`. The billing Scheduler job is enabled on its 15-minute schedule, targets the
Cloud Run API service, and returned status code zero for its `2026-08-29T01:00:00.998268Z` attempt.
The workflow records only sanitized rollout values in a seven-day artifact and runs hourly during
the observation window. No personal Google session or Cloud Logging permission is required.

## Open gates

The repository's private local Stripe test key belongs to another Stripe account. The real gateway
verified the configured account first and rejected the key before it searched customers. A fresh
Hypertext Studio test key must replace that local value before any sandbox canary runs.

Hypertext Studio test mode still needs hosted Checkout, signed webhook, replay, payment failure,
payment recovery, authentication-required payment, cancellation, renewal, discount, and credit
note evidence. Production still needs the Founder complimentary grant, one real `$8` subscription,
one discounted subscription, the 24-hour shadow period, active reconciliation, and the 72-hour
canary. Finance and legal approval remain external gates. Checkout must remain disabled until all
of those checks pass.

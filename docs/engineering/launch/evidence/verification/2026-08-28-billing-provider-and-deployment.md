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

`BILLING_ENABLED=false` remains the public kill switch. The release owner changed the production
environment declaration to `BILLING_RECONCILIATION_MODE=shadow` after the exact-main deployment.
The running API revision was deployed while reconciliation was still `off`, so a later deployment
must apply the declaration before the 24-hour observation clock starts.

## Open gates

The repository's private local Stripe test key belongs to another Stripe account. The real gateway
verified the configured account first and rejected the key before it searched customers. A fresh
Hypertext Studio test key must replace that local value before any sandbox canary runs.

The local Google Cloud session requires a Hypertext Studio passkey before the release owner can
read the production secret and database. The production audit must then prove that migration 0107
removed only the orphan legacy billing rows and that every billed organization has one customer,
at most one current subscription, no entitlement drift, and no unresolved provider write.

Hypertext Studio test mode still needs hosted Checkout, signed webhook, replay, payment failure,
payment recovery, authentication-required payment, cancellation, renewal, discount, and credit
note evidence. Production still needs the Founder complimentary grant, one real `$8` subscription,
one discounted subscription, the 24-hour shadow period, active reconciliation, and the 72-hour
canary. Finance and legal approval remain external gates. Checkout must remain disabled until all
of those checks pass.

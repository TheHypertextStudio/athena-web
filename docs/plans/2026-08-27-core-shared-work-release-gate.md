# Core shared-work release gate implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Reader:** An Athena maintainer who will implement and review the production repair. After
finishing this plan, the maintainer must merge only a change that proves an unentitled shared
workspace can create core work and that a real paid boundary still returns 402.

**Goal:** Keep collaborative work creation in baseline Docket and block a production deployment
whenever the shared-workspace Initiative acceptance case fails.

**Architecture:** Product ownership is a narrow input to explicit paid features. It must not alter
the meaning of a workspace, a role, or a core work route. The organization router resolves
membership and role capability. Paid modules add their own product guard. The release suite uses
the production Web build and PostgreSQL to create a shared workspace and an Initiative through the
browser.

**Tech Stack:** TypeScript, Hono, Drizzle, PostgreSQL 17, Next.js standalone output, Playwright,
and GitHub Actions.

---

## Incident and decision

On 2026-08-27, production returned HTTP 402 for
`POST /v1/orgs/01KY1N724K30F3MCPQMRC7GVD3/initiatives`. The source is
`sharedWorkCapabilityGuard` in `apps/api/src/product-capability.ts`. The guard runs around every
nested route in `apps/api/src/routes/orgs.ts` and asks for the paid `shared_work` capability on any
shared-workspace mutation. `CreateInitiativeDialog` only checks the actor's `contribute` role
capability, so it enables Create and later receives the 402.

The release job passed because `e2e/release/core-screen-acceptance.spec.ts` loads screens. It does
not submit a create form. Its setup creates a personal workspace, while the bug only applies to
shared workspaces. `seedOrg` also grants Docket Pro by default, which hides missing entitlement
from most API tests.

We will delete `shared_work` from the paid capability catalog and delete the global guard. Core
workspace, Team, Task, Project, Initiative, Program, Cycle, Milestone, status, label, view, and
workspace-setting routes remain governed by their existing tenant, membership, and role checks.
Docket Pro keeps explicit guards for integrations, MCP, Athena, and voice.

We will not repair this with a production entitlement, a LVBT exception, or a billing message in
the Initiative dialog. Those actions preserve the wrong authorization model. The release job uses
disposable PostgreSQL state, so no production record is needed for the proof.

## Authorization boundary

This component diagram states the required ownership. A core work request never reaches a billing
decision.

```mermaid
flowchart LR
  B[Authenticated browser] --> O[Organization context and role capability]
  O --> C[Baseline work routes]
  O --> P[Explicit paid feature route]
  P --> E[Product entitlement resolver]
  E --> F[Integrations, MCP, Athena, and voice]
```

No middleware may infer a paid requirement from `isPersonal`, request method, or position under
`/:orgId`. A paid module owns its own `productCapabilityGuard` at the feature boundary.

## Acceptance contract

The [test dependency diagram](2026-08-27-core-shared-work-test-structure.mmd) shows how the three
test suites combine into the deployment decision.

1. An Owner in an unentitled shared workspace receives HTTP 201 from
   `POST /v1/orgs/:orgId/initiatives`.
2. A Member with `contribute` can create baseline work. A Guest cannot create it.
3. An unentitled shared workspace still receives HTTP 402 from an explicitly paid integration,
   MCP, Athena, or voice operation.
4. The release suite creates a shared workspace through the browser, submits a new Initiative,
   observes HTTP 201, sees it in the UI, and reloads its detail route.
5. The release suite treats an unexpected 402 on baseline work as a failure. It can allow 402 only
   for one named paid operation that the test intentionally exercises.
6. `deploy-production` continues to require the release job, so a red creation case prevents
   migrations and production deployments.

## Task 1: Correct the baseline shared-work authorization and billing API contract

**Files:**

- Modify: `domains/billing/src/contracts.ts`
- Modify: `domains/billing/tests/application/entitlement.test.ts`
- Modify: `apps/api/src/product-capability.ts`
- Modify: `apps/api/src/routes/orgs.ts`
- Modify: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/tests/agent/entitlement.test.ts`
- Modify: `apps/api/tests/routes/group-d.test.ts`
- Modify: `apps/api/tests/routes/billing-http.test.ts`
- Modify: `apps/api/tests/routes/billing-lifecycle.test.ts`
- Modify: `apps/api/tests/routes/group-b.test.ts`

**Step 1: Write the failing production contracts.**

Change the billing capability test to expect only `integrations`, `mcp`, `athena`, and `voice`.
Replace the middleware test that requires Pro for shared writes with a real parent-router case. A
fresh unentitled shared workspace must create an Initiative through
`POST /v1/orgs/:orgId/initiatives`, receive HTTP 201, and reopen the saved Initiative. Existing
Initiative-router tests continue to prove that `contribute` is required, so the parent-router case
must not bypass membership or role checks.

Change billing-summary expectations so both personal and shared workspaces report core work as
`writable` without Docket Pro and after Pro ends. Keep the existing response field for compatibility
in this P0. It now describes baseline workspace access rather than paid-feature access.

**Step 2: Run the tests before changing source.**

```bash
pnpm --filter @docket/billing exec vitest run tests/application/entitlement.test.ts --maxWorkers=2
pnpm --filter @docket/api exec vitest run tests/agent/entitlement.test.ts tests/routes/group-d.test.ts tests/routes/billing-http.test.ts tests/routes/billing-lifecycle.test.ts tests/routes/group-b.test.ts --maxWorkers=2
```

The capability expectation, parent-router Initiative case, and billing access expectations must
fail for the old product policy rather than for test setup.

**Step 3: Make the narrow authorization change.**

Delete `shared_work` from `PRODUCT_CAPABILITIES`. Delete `sharedWorkCapabilityGuard`. Remove its
three applications from the organization router, including the explicit workspace-settings uses.
Preserve `productCapabilityGuard`, `assertProductCapability`, tenant isolation, and role capability
checks. Integrations, MCP, Athena, and voice keep their explicit guards at their feature boundaries.
Search production source for both deleted names and require zero matches.

Make billing summary return `accessMode: 'writable'` for an existing workspace regardless of Pro
state. Do not use this compatibility field to report paid-feature entitlement.

**Step 4: Run the focused tests again and commit the authorization slice.**

Use the `billing` scope. The commit body must state that collaborative core work is baseline, that
paid modules retain explicit product guards, and that `accessMode` now reports baseline access.

## Task 2: Correct customer, operator, and lifecycle product promises

**Files:**

- Modify: `apps/web/src/components/settings/billing-settings.tsx`
- Modify: `apps/web/src/components/billing/billing-recovery.tsx`
- Modify: `apps/web/src/components/marketing/pricing-products.tsx`
- Modify: `apps/web/src/app/(marketing)/pricing/page.tsx`
- Modify: `apps/web/src/app/(marketing)/terms/page.tsx`
- Modify: `apps/api/src/routes/webhooks.ts`
- Modify: `apps/api/src/services/billing-reconciliation.ts`
- Modify: `apps/api/src/routes/admin-billing-routes.ts`
- Modify: `apps/api/src/contracts/errors.ts`
- Modify: focused Web and API tests for those surfaces
- Modify: current billing, architecture, reconciliation, API, and MVP documents that promise
  shared work becomes read-only

**Step 1: Write the failing user-visible expectations.**

Billing Settings must say baseline shared work remains writable without Pro. Docket Pro must list
only integrations, MCP, Athena, and voice. Cancellation, payment failure, and grace-expiry copy must
say that Pro features end or pause. The copy must not claim that core shared work becomes read-only.
Pricing and Terms must state the same product boundary.

Webhook, reconciliation, admin, and stable Problem copy must describe Pro-feature access without
claiming that core work is blocked. Update behavior tests before production copy.

**Step 2: Run the focused tests red, then update the implementation and documents.**

Use existing billing settings, billing recovery, legal policy, webhook, and reconciliation tests.
Add an assertion only when it names the customer-visible break that the old policy caused.

**Step 3: Verify and commit the product-promise slice.**

Run the affected API and Web suites with at most two workers. Search production and current product
documents for claims that shared work becomes read-only and require zero stale matches outside
historical work logs and incident plans. Use the `billing` scope.

The repository-wide automatic Pro fixture remains unchanged in this emergency slice. Each new P0
case clears its product grant explicitly. The outcome-catalog redesign will remove the implicit
fixture and make every paid test opt in after production is repaired.

## Task 3: Replace screen-only release coverage with core-product acceptance

**Files:**

- Create: `apps/web/e2e/release/core-work-creation.spec.ts`
- Modify: `apps/web/e2e/release/core-screen-acceptance.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Step 1: Write the browser-only mutation case.**

Use `signUp` for a fresh account. Open `/workspaces/new`, enter a unique workspace name, and press
**Create workspace**. Wait for the new shared workspace id. Open its Initiative list, press **New
Initiative**, enter a unique name, and press **Create**. Observe the Initiative POST return 201,
assert that the resulting detail shows the new record, return to the Initiative list and find it,
then open a fresh browser context and require the server-backed detail to show the same name.

The test can establish authentication with existing helpers. It must not create the workspace or
Initiative through API setup. Those browser operations are the contract that production broke.

**Step 2: Remove the blanket 402 waiver.**

`core-screen-acceptance.spec.ts` currently ignores every 402 while it watches screen responses.
Remove that exemption. The current release scan does not intentionally exercise a paid operation,
so it has no legitimate 402 allow-list entry. The core-work creation test must fail on every 4xx
and 5xx from either write.

**Step 3: Run the same production-build stack as CI.**

Use the existing PostgreSQL service, standalone Next.js build, API server, host mapping, and
Chromium configuration from `core-screen-smoke`. Run the suite with `--workers=1`. The old release
would fail at Initiative submission with 402. The completed release must pass without retry.

**Step 4: Gate the release directory.**

Change the workflow command from one filename to `e2e/release`. Rename the visible job and
artifact to Core product acceptance. Preserve `core-screen-smoke` in both `still-latest.needs` and
`deploy-production.needs`, so the new test is a release blocker rather than advisory coverage.

## Task 4: Verify, review, and release safely

**Files:**

- Modify: `docs/WORKLOG.md`

**Step 1: Run focused checks.**

Run the billing contract, API route, and release E2E tests with two workers at most. Save Playwright
trace and screenshot output only for a failure.

**Step 2: Run repository checks.**

Run `pnpm typecheck -- --concurrency=2`, `pnpm lint -- --concurrency=2`,
`pnpm test -- --maxWorkers=2`, and `pnpm build -- --concurrency=2`. The expected watchdog command
is unavailable on this host, so start with focused commands and reduce package or worker count if
the operating system kills a process.

**Step 3: Inspect the deployment edge.**

Run the CI gate-policy check and confirm `core-screen-smoke` remains in the `still-latest` and
`deploy-production` dependency lists.

**Step 4: Update the work log and review the diff.**

Record the 402 source, the final product catalog, explicit paid boundaries, every test result, and
any unrelated failure. Confirm that no production entitlement, account, or work record was created.

**Step 5: Merge only after the updated release job passes.**

The CI suite supplies the end-to-end proof because it uses disposable data and the production Web
build. Do not create a production Initiative as a smoke test without explicit approval.

## Risks and controls

Removing `shared_work` can expose a paid feature that depended on the parent guard. The explicit
premium tests and a source search for `productCapabilityGuard` control that risk. Making fixtures
unentitled can reveal a large number of hidden assumptions. That is required cleanup: each failure
must declare a product grant or establish a baseline route. Passkey setup makes the release test
slower, but the job already has a 12-minute budget and runs Chromium with one worker.

If Docket Pro must charge for collaboration in the future, it needs a distinct, opt-in
collaboration boundary, an honest disabled UI state, a migration path for existing organizations,
and separate product approval. It must never be inferred from the fact that a workspace is shared.

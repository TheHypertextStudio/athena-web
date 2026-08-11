# Interaction Responsiveness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every named asynchronous interaction a privacy-safe lifecycle and a truthful painted acknowledgement within the deterministic 100ms product budget.

**Architecture:** A bounded receipt store and React provider own semantic activation, painted acknowledgement, progress, settlement, and recovery. Navigation, URL-backed state, query-backed reads, and registered actions publish through typed adapters. A generated source inventory reconciles against a checked-in manifest and closed exception registry, while focused production-build browser tests enforce the contract without collecting real-user telemetry.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, Hono RPC, Vitest, Testing Library, TypeScript compiler API, Playwright, GitHub Actions.

## Global Constraints

- Keep receipt ids and route templates closed and privacy-safe; never accept user text, entity ids, concrete URLs, payloads, exception prose, or persisted invocation ids.
- Measure semantic DOM/ARIA acknowledgement after paint. INP and Event Timing are supporting diagnostics, not substitutes for the product predicate.
- Preserve the app shell and last useful content while remote work settles.
- Do not add real-user monitoring, a production session-seeding endpoint, or service-worker write behavior.
- Use injected clocks/frame schedulers in unit tests and warm-up plus three measured samples in Playwright.
- Keep the inventory, manifest, exception registry, and evidence mutually complete before closeout.

## Program Order

1. Complete this plan's Tasks 1–2 before any replay-safe or mutation UI integration.
2. Complete Replay-safe Writes Tasks 1–6 before Pending Insert integration.
3. Complete Intent-preserving Mutation Primitives Tasks 1–4 before either vertical slice or domain migration.
4. Complete this plan's Task 7 before any plan claims a 100ms browser budget; earlier component tests may assert semantic state without the timing claim.
5. Execute Interaction Migration and Zero-debt Closeout only after those shared seams are green.

---

### Task 1: Receipt domain and bounded lifecycle store

**Files:**

- Create: `apps/web/src/lib/interactions/types.ts`
- Create: `apps/web/src/lib/interactions/catalog.ts`
- Create: `apps/web/src/lib/interactions/receipt-store.ts`
- Create: `apps/web/src/lib/interactions/index.ts`
- Create: `apps/web/tests/interactions/receipt-store.test.ts`

**Interfaces:**

- Define closed `InteractionId`, `InteractionCategory`, `InteractionPhase`, `InteractionOutcome`, and allowlisted route-template ids.
- Define `InteractionReceipt` and `InteractionInvocation` so only the ephemeral invocation carries `invocationId` and `parentInvocationId`.
- Retain at most 128 live and 512 completed receipts, reject invalid phase transitions, and expose a privacy-safe diagnostic snapshot. Completing the live cap terminates the oldest receipt as `timed_out` and emits a development/test leak failure instead of silently evicting work.

- [ ] Write failing store tests for activation, acknowledgement, progress, settlement, recovery, root/child linking, invalid transitions, every terminal outcome (`succeeded`, `needs_attention`, `failed`, `handed_off`, `superseded`, `abandoned`, and `timed_out`), completed eviction, live-cap timeout/leak reporting, teardown abandonment versus prior durable/external handoff, and serialization redaction.
- [ ] Run `pnpm --filter @docket/web test -- tests/interactions/receipt-store.test.ts` and confirm the missing module is the expected failure.
- [ ] Implement the closed catalog and pure store with TSDoc on exported types and functions.
- [ ] Run the focused test to green and verify serialized records contain no invocation ids or arbitrary strings.
- [ ] Commit the green domain slice with a substantive `feat(web): ...` commit.

### Task 2: Provider, painted acknowledgement, and responsive action hook

**Files:**

- Create: `apps/web/src/lib/interactions/receipt-context.tsx`
- Create: `apps/web/src/lib/interactions/use-responsive-action.ts`
- Create: `apps/web/tests/interactions/receipt-context.test.tsx`
- Create: `apps/web/tests/interactions/use-responsive-action.test.tsx`
- Modify: `apps/web/src/components/providers.tsx`
- Modify: `apps/web/tests/components/providers.test.tsx`

**Interfaces:**

- Mount one provider inside the query client and expose `startInteraction`, `acknowledgeAfterPaint`, `markProgress`, `settleInteraction`, and `recoverInteraction`.
- Inject `now`, timeout, and frame scheduling so double-frame acknowledgement is deterministic in tests.
- `useResponsiveAction` returns phase, exact-trigger blocking, status props, and `run`; its caller supplies the acknowledgement predicate/state rather than treating handler return as feedback.

- [ ] Write failing tests for synchronous activation, refusal to acknowledge while the manifest DOM/ARIA predicate is false, acknowledgement only after the predicate commits and survives both frames, 300ms progress, five-second sustained state, exact-trigger blocking, failure recovery, cleanup, and provider composition.
- [ ] Confirm the focused tests fail for the absent provider/hook.
- [ ] Implement the provider and hook without serializing invocations or installing a production observation sink.
- [ ] Run both focused suites and the provider suite to green.
- [ ] Commit the green provider slice.

### Task 3: Registered actions and runtime watchdog

**Files:**

- Create: `apps/web/src/lib/interactions/runtime-watchdog.ts`
- Create: `apps/web/tests/interactions/runtime-watchdog.test.ts`
- Modify: `apps/web/src/lib/actions/types.ts`
- Modify: `apps/web/src/lib/actions/registry.ts`
- Modify: `apps/web/src/lib/actions/registry-context.tsx`
- Modify: `apps/web/src/lib/actions/interaction-provider.tsx`
- Modify: `apps/web/src/lib/actions/index.ts`
- Modify: `apps/web/tests/interactivity/action-registry.test.ts`
- Modify: `apps/web/tests/interactivity/action-registration.test.tsx`

**Interfaces:**

- Require each async `ActionDefinition` to declare a responsiveness category and receipt id.
- Begin the receipt at invocation entry but leave painted acknowledgement to the rendered owner.
- In development/test, flag trusted interactions that start asynchronous work without a receipt owner or never acknowledge; allow only declared autonomous work.

- [ ] Add failing action tests for required metadata, root/child ownership, pre-settlement activation, and no duplicate receipt.
- [ ] Add failing watchdog tests for unowned async work, missing acknowledgement, autonomous exceptions, and cleanup.
- [ ] Implement registry integration and the development/test watchdog.
- [ ] Run the action and watchdog suites to green.
- [ ] Commit the green action slice.

### Task 4: Navigation intent and immediate URL state

**Files:**

- Create: `apps/web/src/lib/interactions/navigation.tsx`
- Create: `apps/web/src/lib/interactions/immediate-url-state.ts`
- Create: `apps/web/tests/interactions/navigation.test.tsx`
- Create: `apps/web/tests/interactions/immediate-url-state.test.tsx`
- Modify: `apps/web/src/components/docket-link.tsx`
- Modify: `apps/web/src/lib/app-location.tsx`
- Modify: `apps/web/src/components/app-shell-utils.tsx`
- Modify: `apps/web/src/components/views/use-view-state.ts`
- Modify: `apps/web/src/components/views/use-layout-mode.ts`

**Interfaces:**

- `useResponsiveRouter` and `ResponsiveNavigationProvider` publish a requested destination immediately, preserve current content, and settle only when the canonical location matches.
- `DocketLink` owns pointer/keyboard navigation acknowledgement online and retains its existing offline history behavior.
- `useImmediateUrlState` overlays a local choice until the matching search params commit and never lets an older navigation overwrite a newer selection.

- [ ] Write failing tests with a held navigation for immediate destination state, false-`aria-current` prevention, offline parity, focus continuity, rapid replacement, and failure recovery.
- [ ] Write failing URL-state tests for same-turn visible selection, later canonical adoption, and out-of-order replacement.
- [ ] Implement the shared provider/router/link and URL overlay.
- [ ] Migrate the two shared view/layout hooks and run their focused tests to green.
- [ ] Commit the green navigation slice.

### Task 5: Responsive reads and search continuity

**Files:**

- Create: `apps/web/src/lib/interactions/responsive-read.ts`
- Create: `apps/web/tests/interactions/responsive-read.test.tsx`
- Modify: `apps/web/src/lib/query.ts`
- Modify: `apps/web/src/components/command-palette/use-hub-search.ts`
- Modify: `apps/web/src/components/command-palette/command-palette.tsx`
- Modify: `apps/web/src/components/search/search-client.tsx`
- Create: `apps/web/tests/components/command-palette/use-hub-search.test.tsx`
- Modify: `apps/web/tests/components/command-palette/command-palette.test.tsx`
- Modify: `apps/web/tests/components/search/search-client.test.tsx`

**Interfaces:**

- Query-backed interactions echo local input immediately, retain the last useful result, mark stale/searching state locally, and publish only the latest request.
- Extend typed query definitions with explicit receipt ownership metadata instead of attempting to preserve async context across React renders.

- [ ] Write failing tests for held remote search, retained rows, latest-request wins, first-load skeleton geometry, background error continuity, and receipt settlement.
- [ ] Confirm the failures show prior-result blanking rather than timing noise.
- [ ] Implement the read adapter and integrate it with the typed query layer.
- [ ] Migrate hub search and full search, then run the focused suites to green.
- [ ] Commit the green read slice.

### Task 6: Source inventory, manifest, exceptions, and zero-debt policy

**Files:**

- Create: `packages/test-utils/src/interaction-inventory.ts`
- Create: `packages/test-utils/tests/workspace-policies/web-interaction-responsiveness-policy.test.ts`
- Create: `apps/web/src/lib/interactions/interaction-responsiveness-manifest.ts`
- Create: `apps/web/src/lib/interactions/interaction-exceptions.ts`
- Create: `apps/web/src/lib/interactions/interaction-inventory.generated.ts`
- Create: `apps/web/src/lib/interactions/interaction-debt.json`
- Modify: `packages/test-utils/src/index.ts`

**Interfaces:**

- Inventory production JSX handlers, forms/server actions, action definitions, router calls, native listeners, user-facing timers/transitions, typing/scrolling loops, gesture owners, raw TanStack mutations, typed API mutations, pending-derived disabling, and await-then-clear composers.
- Reconcile every source boundary with exactly one manifest owner or closed exception; reject orphaned entries, missing evidence, expired exceptions, new raw async/router/mutation use, and non-empty final debt.
- Require every manifest record to name id/category/criticality/primitive, applicable modalities, widths, themes, reduced-motion state, latency fixture, semantic acknowledgement predicate, focus owner, continuity assertions, and component/browser evidence.
- The final ledger must be empty; it may only ratchet downward during intermediate migration commits.

- [ ] Add hostile fixtures and failing policy tests that prove each forbidden pattern is detected without flagging synchronous local handlers, and reject each individually omitted manifest field.
- [ ] Implement the TypeScript-AST scanner and deterministic artifact generation.
- [ ] Populate the initial manifest/exceptions/debt from the generated inventory and make the policy green without weakening coverage.
- [ ] Run `pnpm --filter @docket/test-utils test -- tests/workspace-policies/web-interaction-responsiveness-policy.test.ts`.
- [ ] Commit the green enforcement slice.

### Task 7: Deterministic browser budget and required CI

**Files:**

- Create: `apps/web/e2e/helpers/responsiveness.ts`
- Create: `apps/web/e2e/responsiveness/interaction-responsiveness.spec.ts`
- Create: `apps/web/playwright.responsiveness.config.ts`
- Modify: `apps/web/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci-gate-policy.ts`
- Modify: tests under `tests/ci/`

**Interfaces:**

- Browser helpers hold transport, activate by pointer/keyboard, wait for the semantic paint marker, assert the promised DOM/ARIA state and focus continuity, then release settlement.
- Collect optional Event Timing and Long Task diagnostics; fail direct-manipulation fixtures on a 50ms long task.
- Run one warm-up and three measured samples with workers `1`, retries `0`, Chromium production build, desktop/mobile, reduced motion, and retained trace on failure.

- [ ] Write a failing critical-flow browser fixture and CI topology tests before changing the workflow.
- [ ] Implement a manifest-driven helper/config that executes every applicable declared variant and prove a fixture fails when acknowledgement is intentionally delayed past 100ms.
- [ ] Add a required `responsiveness` job and include it in production deployment needs.
- [ ] Run the focused browser suite and CI policy tests to green.
- [ ] Commit the green release-gate slice.

### Task 8: Release marker, post-deploy synthetic, documentation, and validation

**Files:**

- Create: `apps/web/src/app/.well-known/docket-release/route.ts`
- Create: `apps/web/e2e/tools/responsiveness-synthetic.ts`
- Create: `.github/workflows/responsiveness-synthetic.yml`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Expose only the deployed commit SHA/build id in the public release marker.
- Poll the marker before synthetic checks and use an environment-scoped production storage-state secret plus seeded org id; expired credentials fail explicitly and never invoke a seed endpoint.
- The synthetic records pass/fail artifacts only and sends no real-user telemetry.

- [ ] Add `apps/web/tests/app/docket-release.test.ts` for privacy-safe release metadata and `apps/web/tests/e2e/responsiveness-synthetic.test.ts` for SHA wait, expired auth, and redacted output.
- [ ] Implement the marker, credentialed synthetic runner, and post-deploy workflow.
- [ ] Record the completed foundation and operational credential-rotation requirement in the worklog; final engineering-spec wording is owned by the zero-debt closeout plan so it cannot describe unshipped migration work.
- [ ] Run focused suites, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Update the worklog with evidence and commit the verified foundation.

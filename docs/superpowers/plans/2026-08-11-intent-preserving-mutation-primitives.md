# Intent-preserving Mutation Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make routine edits, rapid inserts, and server-confirmed transitions respond immediately without stale settlement overwriting newer intent or clearing a newer draft.

**Architecture:** The typed query boundary delegates mutations to three shared lifecycles. A pure field-version journal layers current intent over authoritative cache state and serializes/coalesces transport without delaying local projection. Pending inserts capture immutable drafts and submission keys, while confirmed transitions change to an acknowledged applying phase immediately. One shared status component exposes quiet progress and recovery.

**Tech Stack:** React, TypeScript, TanStack Query, Hono RPC client, Vitest, Testing Library, Playwright.

## Global Constraints

- Apply local intent before awaiting previous transport; ordering applies to delivery, never to presentation.
- Settle only fields/submissions still owned by that version/key; whole-record rollback is forbidden.
- Keep attempted values and pending rows visible after authoritative refusal with edit/retry/discard recovery.
- Clear/refocus rapid-entry input in the submit turn and never let an older resolution clear a newer draft.
- Quiet success uses no toast. Progress appears after 300ms and “Still working” after five seconds.
- Only exact duplicate activation may block; sibling controls and the next draft remain usable.

## Program Order

1. Start after Interaction Responsiveness Foundation Tasks 1–2 are green.
2. Build Tasks 1–2 while Replay-safe Writes proceeds, but do not integrate Task 3 until Replay-safe Writes Tasks 1–6 are green.
3. Complete Tasks 1–4 before either vertical slice or any domain migration.
4. Do not make a 100ms browser claim in Tasks 5–6 until Interaction Responsiveness Foundation Task 7 is green.
5. Final engineering-spec documentation and all-system validation belong to Interaction Migration and Zero-debt Closeout.

---

### Task 1: Pure field-version intent journal

**Files:**

- Create: `apps/web/src/lib/mutations/types.ts`
- Create: `apps/web/src/lib/mutations/intent-journal.ts`
- Create: `apps/web/src/lib/mutations/index.ts`
- Create: `apps/web/tests/support/deferred.ts`
- Create: `apps/web/tests/lib/mutations/intent-journal.test.ts`

**Interfaces:**

- Key intents by entity/query identity plus field, with monotonic field versions and per-version base/local values.
- Derive the rendered overlay from the latest live intent, reconcile authoritative cache beneath it, and expose syncing/needs-attention ownership.
- Serialize/coalesce delivery per entity/field while applying each new local patch synchronously.

- [ ] Write failing pure tests for immediate projection, two-field independence, same-field rapid edits, out-of-order success/failure, base refresh beneath overlay, coalescing, refusal retention, retry, discard, and garbage collection.
- [ ] Confirm the missing module is the expected failure.
- [ ] Implement the journal with TSDoc and no React/query dependency.
- [ ] Run the focused suite to green and commit the pure primitive.

### Task 2: Instant mutation hook and typed query integration

**Files:**

- Create: `apps/web/src/lib/mutations/use-instant-mutation.ts`
- Create: `apps/web/tests/lib/mutations/use-instant-mutation.test.tsx`
- Modify: `apps/web/src/lib/query.ts`
- Modify: `apps/web/tests/lib/query.test.tsx`

**Interfaces:**

- `useInstantMutation` binds the journal to typed query definitions, scoped cache projection, idempotent transport, current-version adoption, invalidation, and application-owned failure mapping.
- Consume the authenticated query boundary's discriminated foreground/queued outcome so wrappers retain the outbox entry id and never mistake durable handoff for failure.
- Make raw `useApiMutation` an internal transport seam; new production callers select a declared lifecycle and interaction id.

- [ ] Write failing hook tests with deferred transport for same-turn cache/render update, enabled sibling edit, ordered delivery, stale response immunity, queued outcome, refusal overlay, retry/discard, and receipt phases.
- [ ] Implement the hook and internalize the lower-level mutation boundary without breaking existing callers during the migration ledger period.
- [ ] Run the focused mutation/query tests to green.
- [ ] Commit the instant-edit adapter.

### Task 3: Immutable submission and pending-insert lifecycle

**Files:**

- Create: `apps/web/src/lib/mutations/submission.ts`
- Create: `apps/web/src/lib/mutations/use-pending-insert.ts`
- Create: `apps/web/tests/lib/mutations/submission.test.ts`
- Create: `apps/web/tests/lib/mutations/use-pending-insert.test.tsx`

**Interfaces:**

- Capture an immutable validated draft, draft version, submission/idempotency key, local projection id, projection context, and owner callback.
- Insert the pending row and return the input owner immediately; settle/adopt only the matching key.
- Model `pending | syncing | needs_attention | settled` and preserve durable outbox-backed projections across reload.

- [ ] Write failing tests for immediate capture/clear/refocus, rapid two-submit ordering, foreground success adoption, ambiguous queue, reload restoration, 4xx refusal, retry-new-key, discard, and older completion preserving a newer draft.
- [ ] Implement the submission model and hook against the replay-safe write registry.
- [ ] Run focused suites to green and commit the pending-insert primitive.

### Task 4: Confirmed transition lifecycle and shared status UI

**Files:**

- Create: `apps/web/src/lib/mutations/use-confirmed-mutation.ts`
- Create: `apps/web/src/components/mutations/mutation-status.tsx`
- Create: `apps/web/tests/lib/mutations/use-confirmed-mutation.test.tsx`
- Create: `apps/web/tests/components/mutation-status.test.tsx`

**Interfaces:**

- `useConfirmedMutation` changes the exact control to applying/checking immediately, exposes `aria-busy`, and suppresses only an exact duplicate.
- `MutationStatus` renders quiet delayed progress, sustained-work copy, needs-attention explanation, and accessible retry/edit/discard controls without layout shift.

- [ ] Write failing tests for same-turn phase/semantics, 300ms and five-second states, neighboring control availability, exact duplicate guard, reduced motion, application-owned error copy, and recovery actions.
- [ ] Implement the hook and status component using the shared receipt timing ladder.
- [ ] Run focused suites to green and commit the confirmed/status slice.

### Task 5: Service-worker update vertical slice

**Files:**

- Modify: `apps/web/src/components/service-worker-provider.tsx`
- Modify: `apps/web/tests/components/service-worker-provider.test.tsx`
- Modify: `packages/service-worker/tests/sw-handshake.test.ts`

**Interfaces:**

- Render **Update available**, **Reload to use the latest version**, and **Reload now** before activation. Activation changes immediately to **Applying update…**, sets `aria-busy`, blocks only the exact trigger, and uses **Reloading…** before the four-second fallback. A missing waiting worker or synchronous `postMessage` failure renders **Couldn’t apply update** with **Retry**.

- [ ] Rewrite the current test that pins an unchanged card into failing ready/applying/reloading/retry semantics, including the missing-worker and synchronous-post failure paths.
- [ ] Implement the confirmed lifecycle without changing the worker handshake.
- [ ] Run web and service-worker focused suites to green.
- [ ] Commit the update-control fix.

### Task 6: Rapid Task creation vertical slice

**Files:**

- Modify: `apps/web/src/components/tasks/quick-add-task-row.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx`
- Modify: `apps/web/src/components/project-detail/milestone-tasks.tsx`
- Modify: `apps/web/tests/components/quick-add-task-row.test.tsx`
- Create: `apps/web/tests/components/quick-add-task-hosts.test.tsx`

**Interfaces:**

- Enter moves the exact captured title into a pending Task row, clears/refocuses immediately, and accepts another title while POST/refetch is held.
- Foreground or outbox settlement adopts the server Task by submission key; refusal keeps the pending row with edit/retry/discard.

- [ ] Add failing component/host tests for held transport, focus continuity, two rapid tasks with independent keys/in-flight requests, either-order settlement keyed to the correct projection, queued persistence, refusal/recovery, permission behavior, and no duplicate.
- [ ] Implement QuickAdd on `usePendingInsert` and migrate all three hosts.
- [ ] Run focused unit/integration tests to green.
- [ ] Add a production-build browser journey with 2.5s held responses and the 100ms acknowledgement helper.
- [ ] Commit the rapid-create slice.

### Task 7: Documentation and validation

**Files:**

- Modify: `docs/WORKLOG.md`

- [ ] Record the completed primitive APIs, vertical-slice evidence, and remaining migration count in the worklog; final engineering-spec wording is owned by the zero-debt closeout plan.
- [ ] Run all new primitive suites plus existing task/project mutation suites.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Self-review for whole-record rollback, await-before-projection, pending input disablement, and stale draft clearing.
- [ ] Update the worklog and commit the verified primitives/vertical slices.

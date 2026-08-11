# Replay-safe Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make foreground and queued application writes replay-safe so an ambiguous response can never create a duplicate or clear the wrong local projection.

**Architecture:** Route-owned idempotent command helpers claim a user-scoped key, hash the canonical operation and input, execute domain writes and the completed receipt in one database transaction, and reauthorize before replaying a validated cached response. A closed client write registry persists the same key and projection metadata through the page outbox, then emits keyed settlement before removing exactly one entry.

**Tech Stack:** Hono, TypeScript, Drizzle/PostgreSQL/PGlite, Zod, TanStack Query, IndexedDB, Vitest, Playwright.

## Global Constraints

- Authenticate, authorize membership/capability, and recheck current resource visibility before returning a cached response.
- A key reused with a different operation/path/body returns the stable 422 `idempotency_key_reuse` problem.
- Domain writes and idempotency completion share one transaction; concurrent claims execute domain work at most once.
- Ambiguous retry reuses the original key. Editing/retrying an authoritative refusal creates a new key and supersedes the refused submission.
- Queue only operations in the closed replay-safe registry. Multipart uploads and unknown writes remain explicitly non-queueable.
- The service worker remains read-only; page-owned outbox behavior is unchanged in ownership.

## Program Order

1. Start after Interaction Responsiveness Foundation Tasks 1–2 are green.
2. Complete this plan's Tasks 1–6 before Pending Insert integrates with durable replay.
3. Complete remaining route adoption before the matching domain enters the replay-safe client registry or migration ledger reaches zero.
4. Final engineering-spec documentation and all-system validation belong to Interaction Migration and Zero-debt Closeout.

---

### Task 1: Idempotency record and migration

**Files:**

- Modify: `packages/db/src/schema/infra.ts`
- Create: next generated migration and snapshot under `packages/db/drizzle/`
- Create: `packages/db/tests/schema/idempotency-key.test.ts`

**Interfaces:**

- Extend the existing `(userId, key)` record with a closed operation id, response schema/version, current-view resource type/id, claim token/timestamps, and completed outcome metadata needed for safe concurrency and replay.
- Preserve the 24-hour expiry index and atomically reclaim expired keys.

- [ ] Add failing schema tests for required metadata, index/constraints, and expiry semantics.
- [ ] Modify the Drizzle schema and run `pnpm --filter @docket/db db:generate`; inspect the generated SQL/snapshot rather than hand-authoring it.
- [ ] Run database tests and a clean PGlite migration to green.
- [ ] Commit the schema slice with migration and tests.

### Task 2: Transactional API idempotency helper

**Files:**

- Create: `apps/api/src/lib/idempotency.ts`
- Create: `apps/api/tests/lib/idempotency.test.ts`
- Modify: `apps/api/src/error.ts`

**Interfaces:**

- Provide a typed `executeIdempotentCommand` that accepts operation id, authenticated user/org, canonical request input, response schema, replay authorization callback, and a transaction-owned command.
- Canonically hash method, route template, and validated input; claim or wait on the existing key; persist only schema-validated application output.
- Fresh execution reports `executed`; safe replay reports `replayed`; conflicts and in-progress expiry use stable application errors.

- [ ] Write failing PGlite tests for first execution, identical replay, mismatched body/path/operation, concurrent calls, transaction rollback, crash-shaped incomplete claims, expiry reclaim, response validation, and current-authorization refusal.
- [ ] Confirm the focused suite fails because the helper does not exist.
- [ ] Implement the helper using typed Drizzle transactions and cryptographic hashing available in the runtime.
- [ ] Run `pnpm --filter @docket/api test -- tests/lib/idempotency.test.ts` to green.
- [ ] Commit the helper slice.

### Task 3: Header, CORS, and OpenAPI contract

**Files:**

- Modify: `apps/api/src/cors.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/tests/core/cors.test.ts`
- Modify: `apps/api/tests/core/openapi-spec.test.ts`

**Interfaces:**

- Allow `Idempotency-Key` only on trusted session/API origins covered by the existing CORS policy.
- Document the optional header on each adopted route, its 24-hour scope, conflict behavior, and replay response without claiming unsupported universal coverage.

- [ ] Add failing trusted/untrusted preflight tests and OpenAPI operation assertions.
- [ ] Implement the allow-header and route-level documentation.
- [ ] Run focused API tests to green and verify no wildcard origin/header regression.
- [ ] Commit the contract slice.

### Task 4: Task commands as the first transactional adopters

**Files:**

- Modify: `apps/api/src/routes/tasks.ts`
- Create: `apps/api/tests/routes/idempotent-tasks.test.ts`
- Modify: `apps/api/tests/routes/tasks-detail.test.ts`

**Interfaces:**

- Adopt Task create, Task patch, and Task state transition, including subtask creation through `parentTaskId`.
- Keep task row, label/dependency/activity/search/event writes that define the command outcome inside the transaction.
- Run post-commit best-effort announcements only for fresh execution, never cached replay.

- [ ] Add failing route tests for duplicate-safe create, patch/state event deduplication, body mismatch, concurrency, rollback, deleted-resource replay, lost membership/capability, and same-authorized replay.
- [ ] Refactor domain work into transaction-aware commands and wrap the three operations.
- [ ] Run the focused task API suites to green.
- [ ] Commit the Task adoption slice.

### Task 5: Closed replay-safe client registry and durable entry model

**Files:**

- Modify: `apps/web/src/components/pwa/outbox-model.ts`
- Modify: `apps/web/src/components/pwa/outbox-store.ts`
- Modify: `apps/web/tests/pwa/outbox-model.test.ts`
- Create: `apps/web/tests/pwa/outbox-store.test.ts`

**Interfaces:**

- Replace “any `/v1` write” queueability with a typed operation registry naming method, route matcher, response schema, interaction class, projection kind, and invalidation/adoption contract.
- Persist idempotency key, submission key, operation id, response schema version, and structured projection metadata without user-visible labels or payload data in diagnostics.
- Migrate old entries conservatively to blocked/expired rather than replaying them without a safe contract.

- [ ] Write failing registry tests for adopted routes, unknown routes, multipart exclusion, exact method matching, and invalid metadata.
- [ ] Write failing storage-migration tests for legacy entries and new durable fields.
- [ ] Implement the closed registry/model migration and run focused suites to green.
- [ ] Commit the client-model slice.

### Task 6: Foreground capture, replay, and keyed settlement

**Files:**

- Modify: `apps/web/src/components/pwa/offline-write.ts`
- Modify: `apps/web/src/components/pwa/outbox.ts`
- Modify: `apps/web/src/components/pwa/offline-sync.tsx`
- Modify: `apps/web/src/lib/query.ts`
- Modify: `apps/web/tests/pwa/offline-queue.test.ts`
- Modify: `apps/web/tests/lib/query.test.tsx`
- Create: `apps/web/tests/pwa/outbox-runtime.test.ts`

**Interfaces:**

- Send the same idempotency key on the foreground request and every ambiguous replay.
- Surface exactly one typed queued outcome from the authenticated query boundary, including the outbox entry id, without also invoking the ordinary failure callback.
- Validate successful responses by registry schema, publish `{entryId, submissionKey, outcome, response, projection}` to the keyed owner, adopt/refetch, and remove the exact entry only after adoption succeeds.
- Preserve 4xx refusals as blocked recovery records; do not let a global invalidation clear unrelated pending rows.

- [ ] Write failing tests for lost-response enqueue, preserved header, exactly-once queued callback with no ordinary failure callback, accepted replay, schema-invalid success, keyed adoption-before-removal, two simultaneous submissions, 4xx block, network retry, and superseding edit/retry.
- [ ] Implement foreground capture and runtime settlement without changing service-worker ownership.
- [ ] Run all PWA unit suites to green.
- [ ] Commit the outbox-runtime slice.

### Task 7: Remaining replay-safe route adoption

**Files:**

- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/routes/programs.ts`
- Modify: `apps/api/src/routes/initiatives.ts`
- Modify: `apps/api/src/routes/cycles.ts`
- Modify: `apps/api/src/routes/teams.ts`
- Modify: `apps/api/src/routes/milestones.ts`
- Modify: `apps/api/src/routes/comments.ts`
- Modify: `apps/api/src/routes/updates.ts`
- Modify: `apps/api/src/routes/attachment-routes.ts`
- Create: `apps/api/tests/routes/idempotent-write-adoption.test.ts`
- Modify: `apps/api/tests/routes/projects-detail.test.ts`
- Modify: `apps/api/tests/routes/programs-detail.test.ts`
- Modify: `apps/api/tests/routes/initiatives-detail.test.ts`
- Modify: `apps/api/tests/routes/cycles-detail.test.ts`
- Modify: `apps/api/tests/routes/teams.test.ts`
- Modify: `apps/api/tests/routes/milestones-detail.test.ts`
- Modify: `apps/api/tests/routes/comments-threading.test.ts`
- Modify: `apps/api/tests/routes/updates-detail.test.ts`
- Modify: `apps/api/tests/routes/attachments.test.ts`
- Modify: `apps/web/src/components/pwa/outbox-model.ts`

**Interfaces:**

- Adopt replay-safe pending inserts and side-effecting patches for Project, Program, Initiative, Cycle, Team, Milestone, Comment, Update, and URL attachment operations used by the web mutation migration.
- Keep multipart attachment upload non-queueable and visibly recoverable.
- Add each operation to the client registry only after its server transaction and response schema are proven.

- [ ] Add an exact checked-in route-operation matrix to `idempotent-write-adoption.test.ts`, with first-execution/replay/conflict/current-auth cases for every adopted command; this matrix is the prerequisite and bounded file list for the domain commits.
- [ ] Refactor each route into a transaction-aware command and adopt it one domain at a time.
- [ ] Extend the client registry and response validators only after each domain is green.
- [ ] Run affected API and PWA suites after every domain commit.
- [ ] Commit each coherent domain adoption separately.

### Task 8: Browser proof, documentation, and validation

**Files:**

- Modify: `apps/web/e2e/platform/pwa-offline-sync.spec.ts`
- Modify: `docs/WORKLOG.md`

- [ ] Add browser journeys for committed-response loss, offline rapid Task creation, reload survival, keyed reconciliation, authoritative refusal, retry/edit/discard, and no duplicate after reconnect.
- [ ] Record the completed replay-safe routes, exclusions, and validation evidence in the worklog; final engineering-spec wording is owned by the zero-debt closeout plan.
- [ ] Run focused DB/API/web/PWA suites, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Self-review transaction boundaries and prove `rg 'Idempotency-Key'` matches every documented adopter and replay path.
- [ ] Update the worklog and commit the verified write-safety system.

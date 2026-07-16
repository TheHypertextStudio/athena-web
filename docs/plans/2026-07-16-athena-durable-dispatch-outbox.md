# Athena Durable Dispatch Outbox Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use test-driven development to implement this plan task-by-task.

**Goal:** Make every production Athena enqueue and wake recoverable across API/Worker crashes while bounding execution ingress and outbound calls.

**Architecture:** Add a Docket-owned `agent_session_dispatch` outbox keyed to a durable run and dispatch action. The transaction that creates a queued run or records a human continuation also inserts its unique intent; delivery derives only the opaque run identity, marks success after Worker `202`, and a bounded sweeper retries due intents with capped backoff. Cloudflare and Docket ingress read request streams with a hard byte ceiling, every cross-runtime fetch has an abort timeout, expired exact-generation claims recheck owner capacity under the owner lock, and only the documented Workflow timeout shape starts another wait epoch.

**Tech Stack:** Drizzle/Postgres, Hono, Vitest/PGlite, Cloudflare Workers Queues and Workflows, Wrangler.

---

### Task 1: Persisted enqueue outbox and crash recovery

**Files:**

- Modify: `packages/db/src/schema/agents.ts`
- Create: `packages/db/drizzle/0045_*.sql`
- Modify: `apps/api/src/agent/run-generation.ts`
- Modify: `apps/api/src/agent/async-runner.ts`
- Test: `apps/api/tests/agent/async-generation.test.ts`
- Test: `apps/api/tests/agent/async-runner.test.ts`

1. Write real-database tests proving run creation also commits one pending enqueue intent, failed Worker delivery leaves it pending, a later sweep delivers and marks it, and duplicate sweeps/redelivery do not create another intent.
2. Run the focused tests and capture failure because no outbox exists.
3. Add the outbox schema, generated migration/snapshot, unique run/action constraint, due index, retry metadata, delivery service, and capped exponential backoff.
4. Change async admission to deliver the persisted intent rather than an ephemeral message and expose a bounded due-intent sweeper.
5. Run the focused DB/API tests to green.

### Task 2: Atomic human wake intents

**Files:**

- Modify: `apps/api/src/routes/agent-session-approval.ts`
- Modify: `apps/api/src/routes/me-athena.ts`
- Modify: `apps/api/src/routes/agent-sessions.ts`
- Modify: `apps/api/src/agent/transcript.ts`
- Test: `apps/api/tests/routes/me-athena-async.test.ts`
- Test: `apps/api/tests/routes/agent-session-owner-privacy.test.ts`

1. Write route/DB crash-window tests for activity decisions, groups, reply, resume, and awaiting-input chat showing the human state and exactly one wake intent commit before a failing fetch.
2. Run them red against the current post-commit fetch calls.
3. Extend the decision/reply transactions with an optional wake-intent insert; make awaiting-input chat activity, transcript, and wake intent one transaction; make resume persist its intent in a short transaction.
4. Audit canonical and org-compatibility handlers so only production personal Athena persists/delivers wake intents; registered agents and local/test remain synchronous.
5. Run both route suites to green, including duplicate wake delivery and owner-hidden failures before intent creation.

### Task 3: Bounded ingress and network timeouts

**Files:**

- Modify: `apps/api/src/routes/internal-athena-execution.ts`
- Modify: `apps/api/src/agent/async-runner.ts`
- Modify: `apps/runner/src/http.ts`
- Modify: `apps/runner/src/workflow.ts`
- Test: `apps/api/tests/routes/internal-athena-execution.test.ts`
- Test: `apps/api/tests/agent/async-runner.test.ts`
- Test: `apps/runner/tests/http.test.ts`
- Test: `apps/runner/tests/workflow.test.ts`

1. Add stream tests that omit or lie in `Content-Length`, exceed the limit across chunks, observe cancellation, and prove authentication/state effects never run.
2. Add tests that inspect/trigger abort signals for API-to-Worker, Worker nonce-claim, and Workflow-to-Docket calls.
3. Run tests red, then add one bounded byte-reader per runtime and explicit timeout signals with safe 503/error behavior.
4. Run API and runner boundary tests green.

### Task 4: Recovery capacity and Workflow timeout classification

**Files:**

- Modify: `apps/api/src/agent/run-generation.ts`
- Modify: `apps/runner/src/workflow.ts`
- Test: `apps/api/tests/agent/async-generation.test.ts`
- Test: `apps/runner/tests/workflow.test.ts`

1. Add a real-DB test where an expired exact run is excluded from its own active count but another fresh run fills the owner ceiling, so reclaim is rejected under the owner lock.
2. Add Workflow tests where the documented timeout exception starts the next epoch and an unrelated exception escapes immediately.
3. Run red, then share the owner-capacity query with exact reclaim and implement a narrow documented timeout predicate.
4. Run focused recovery and Workflow tests green.

### Task 5: Recovery surface, documentation, and verification

**Files:**

- Modify: `apps/api/src/routes/internal-athena-execution.ts`
- Create: `apps/runner/src/scheduled.ts`
- Modify: `apps/runner/src/index.ts`
- Modify: `apps/runner/wrangler.jsonc`
- Modify: `docs/engineering/cloudflare-athena-execution.md`
- Modify: `docs/engineering/specs/athena-agent.md`
- Modify: `docs/WORKLOG.md`
- Test: matching internal/operator route tests

1. Add a protected bounded recovery entry that invokes the same due-intent sweeper and returns counts only; never return prompts, users, secrets, or tool data.
2. Add an actual signed Worker `scheduled()` handler and every-minute Wrangler cron that call that endpoint with the same outbound timeout; retain the endpoint as the documented manual operator recovery surface.
3. Document retry/backoff, crash recovery, timeout/body limits, owner-capacity recovery, and operator use.
4. Run DB migration validation, focused API/runner suites, package typecheck/lint, Wrangler type/dry-run/startup checks, and `git diff --check`; keep generated declarations byte-current unless the generator changes them.
5. Self-review the requirement matrix, commit atomically with a substantive Conventional Commit body, and do not amend, rebase, merge, push, deploy, or create resources.

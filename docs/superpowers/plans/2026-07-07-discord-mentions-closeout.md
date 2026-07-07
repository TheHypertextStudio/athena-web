# Discord Mentions Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Discord mentions firehose closeout so the project can be marked complete with current documentation, a green validation story, and linear-history/pending-state evidence.

**Architecture:** The Discord implementation is already code-complete on the server-side slice: observer, token ingest, participant attribution, OAuth link, and relay tests pass. The closeout work is a small cleanup lane: correct stale tracking docs, repair the current root typecheck drift caused by later calendar AppType/client mismatch, run the required gates, and record the final state.

**Tech Stack:** TypeScript, Hono RPC/AppType, Vitest, Turborepo, pnpm 11.9.0, Drizzle migrations, Better Auth account linking.

---

### Task 1: Correct Discord Closeout Bookkeeping

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/engineering/specs/discord-observation.md`
- Modify: `TASKS.yaml`

- [ ] **Step 1: Update the WORKLOG entry status**

  In `docs/WORKLOG.md`, edit `[DISCORD-001] Discord mentions in the activity firehose`:
  - Change `Status` from `REVIEW ... pending commit` to `COMPLETED`.
  - Update the gate note to reflect current closeout evidence, not the old mid-session state:
    - Discord relay: typecheck/lint/test passed, 10/10 tests.
    - Boundaries: `observer-discord` covered in boundaries test run.
    - API targeted tests passed: `ingest-discord` 4/4, `ingest-discord-token` 3/3, `event-sync-attribution` 3/3.
    - Auth Discord OAuth-link test passed.
    - Server-side contract packages typecheck/lint passed: `@docket/{types,env,auth,boundaries,api}`.

- [ ] **Step 2: Update the Discord spec header**

  In `docs/engineering/specs/discord-observation.md`, replace the stale status header:

  ```markdown
  > **Status**: implemented; Phase 1 serverless seam, identity attribution, firehose UI hooks, and
  > Phase 2 Gateway relay are in-tree. Live Discord test-guild smoke remains the deployment
  > acceptance check, not an implementation blocker.
  ```

- [ ] **Step 3: Update `TASKS.yaml`**

  In `TASKS.yaml`, under `INTEG-002`:
  - Change `discord-integration` status from `backlog` to `done`.
  - Leave `slack-integration` unchanged unless current repo evidence proves otherwise.

- [ ] **Step 4: Verify docs-only edits**

  Run:

  ```bash
  git diff -- docs/WORKLOG.md docs/engineering/specs/discord-observation.md TASKS.yaml
  ```

  Expected: only status/gate/bookkeeping text changes for Discord closeout.

- [ ] **Step 5: Commit**

  ```bash
  git add docs/WORKLOG.md docs/engineering/specs/discord-observation.md TASKS.yaml
  git commit -m "docs(integrations): close out discord mention observation"
  ```

### Task 2: Repair Current Root Typecheck Drift

**Files:**

- Inspect/modify as needed: calendar routes and exports under `apps/api/src/routes/`
- Inspect/modify as needed: calendar web callers under `apps/web/src/app/(app)/calendar/` and `apps/web/src/components/calendar/`
- Inspect/modify as needed: API type export/build output if this repo intentionally consumes `apps/api/dist`

- [ ] **Step 1: Reproduce the current root failure**

  Run:

  ```bash
  pnpm typecheck
  ```

  Expected initial failure: `@docket/web#typecheck` reports missing RPC members such as calendar `items`, `layers`, and `scopeState`.

- [ ] **Step 2: Identify whether this is stale API dist or route export drift**

  Run:

  ```bash
  rg -n "calendar.*items|items.*calendar|layers|scopeState" apps/api/src packages/types/src apps/web/src
  pnpm --filter @docket/api build
  pnpm --filter @docket/web typecheck
  ```

  Decision rule:
  - If rebuilding `@docket/api` makes `@docket/web typecheck` pass, commit the generated/API build artifact only if it is tracked and expected in this repo.
  - If rebuilding does not fix it, wire the missing calendar routes/response fields into the exported Hono AppType or update web callers to the actual route shape.

- [ ] **Step 3: Add or adjust the narrow regression check**

  If route export wiring changes, add/adjust an API or web type-level test that exercises the calendar RPC path used by:
  - `apps/web/src/components/calendar/calendar-data.ts`
  - `apps/web/src/components/calendar/calendar-mutations.ts`
  - `apps/web/src/app/(app)/calendar/page.tsx`

  The test should fail before the route/AppType repair and pass after it.

- [ ] **Step 4: Verify typecheck**

  Run:

  ```bash
  pnpm typecheck
  ```

  Expected: all 14 packages typecheck successfully.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api apps/web packages/types
  git commit -m "fix(calendar): restore calendar rpc type contract"
  ```

  Stage only files actually changed by this task.

### Task 3: Run Closeout Validation Gates

**Files:**

- No planned source edits.

- [ ] **Step 1: Run Discord targeted gates**

  ```bash
  pnpm --filter @docket/discord-relay typecheck
  pnpm --filter @docket/discord-relay lint
  pnpm --filter @docket/discord-relay test
  pnpm --filter @docket/types typecheck
  pnpm --filter @docket/env typecheck
  pnpm --filter @docket/auth typecheck
  pnpm --filter @docket/boundaries typecheck
  pnpm --filter @docket/api typecheck
  pnpm --filter @docket/types lint
  pnpm --filter @docket/env lint
  pnpm --filter @docket/auth lint
  pnpm --filter @docket/boundaries lint
  pnpm --filter @docket/api lint
  cd apps/api && pnpm exec vitest run tests/routes/ingest-discord.test.ts --maxWorkers=1 --no-file-parallelism
  cd apps/api && pnpm exec vitest run tests/routes/ingest-discord-token.test.ts --maxWorkers=1 --no-file-parallelism
  cd apps/api && pnpm exec vitest run tests/routes/event-sync-attribution.test.ts --maxWorkers=1 --no-file-parallelism
  cd packages/auth && pnpm exec vitest run tests/auth.test.ts -t "Discord" --maxWorkers=1 --no-file-parallelism
  ```

  Expected: all commands exit 0.

- [ ] **Step 2: Run repo gates**

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  ```

  Expected: all commands exit 0. If a gate fails outside Discord/calendar closeout, stop and classify it as unrelated drift before changing scope.

- [ ] **Step 3: Optional live smoke**

  If Discord credentials and a test guild are available, run the relay against the test guild and mention a linked Discord user. Acceptance: an event reaches the personal Stream within the drain interval with Discord source and mention relevance.

### Task 4: Final Git Closeout

**Files:**

- Modify: `docs/WORKLOG.md` only if validation evidence needs a final timestamp/result entry.

- [ ] **Step 1: Audit pending state**

  ```bash
  git status --porcelain=v1 -b
  git worktree list --porcelain
  git branch --no-merged main
  git stash list
  git rev-list --merges --count origin/main..HEAD
  ```

  Expected:
  - Working tree clean except intentional final docs evidence before the final commit.
  - Merge count is `0`.
  - Existing unrelated active worktrees/branches are identified but not modified unless explicitly in scope.

- [ ] **Step 2: Record final evidence if needed**

  If `docs/WORKLOG.md` does not yet include the fresh closeout evidence from Task 3, append it to `[DISCORD-001]` and commit:

  ```bash
  git add docs/WORKLOG.md
  git commit -m "docs(integrations): record discord closeout validation"
  ```

- [ ] **Step 3: Final linear-history check**

  ```bash
  git status --porcelain=v1 -b
  git rev-list --merges --count origin/main..HEAD
  git show -s --format='%h %P %s' HEAD
  ```

  Expected: clean tree, merge count `0`, HEAD is a single-parent commit.

- [ ] **Step 4: Report closeout**

  Final report should state:
  - Discord mentions firehose is complete.
  - Stale docs/tasks were corrected.
  - Current repo validation results, with command names and pass/fail.
  - Whether live Discord smoke was run or skipped due to missing credentials.
  - Any unrelated active worktrees/branches left untouched.

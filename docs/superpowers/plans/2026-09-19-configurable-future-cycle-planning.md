# Configurable Future Cycle Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each team configure 1–365 day cycles and assign work to a generated cycle at any future date without moving work already planned.

**Architecture:** Replace week-indexed cycle math with calendar-day schedule math keyed by team and native window start. Add explicit bounded range generation and transactional cadence updates, then feed one future-aware roster into every task assignment surface. Team Settings owns cadence edits, while the existing task move endpoint remains the only assignment write.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Hono, React, TanStack Query, Vitest, Playwright, Turbo, GitHub Actions, GCP Cloud Run.

---

### Task 1: Day-based cadence storage and contracts

**Files:**

- Modify: `packages/db/src/schema/identity.ts`
- Modify: `apps/api/src/contracts/team.ts`
- Modify: `apps/web/src/lib/contracts/team.ts`
- Modify: `domains/work/src/contracts/cycle.ts`
- Test: `apps/api/tests/routes/teams.test.ts`
- Create: generated migration under `packages/db/drizzle/`

- [ ] **Step 1: Write failing contract and route tests**

Add assertions that `TeamDetail` returns `cycleCadenceDays: 7`, `cycleCadenceAnchor: YYYY-MM-DD`, and `cycleCadenceRevision`, and that create/update reject cadence lengths outside 1–365.

```ts
expect(
  TeamUpdate.safeParse({ cycleCadenceDays: 1, cycleCadenceAnchor: '2026-09-21' }).success,
).toBe(true);
expect(TeamUpdate.safeParse({ cycleCadenceDays: 0 }).success).toBe(false);
expect(TeamUpdate.safeParse({ cycleCadenceDays: 366 }).success).toBe(false);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm --filter @docket/api test -- tests/routes/teams.test.ts --maxWorkers=2`
Expected: FAIL because the cadence fields are not in the contracts or response.

- [ ] **Step 3: Add schema and mirrored contracts**

Replace `cycleCadenceWeeks` with:

```ts
cycleCadenceDays: integer('cycle_cadence_days').notNull().default(7),
cycleCadenceAnchor: date('cycle_cadence_anchor', { mode: 'string' }).notNull().default('2024-01-01'),
cycleCadenceRevision: integer('cycle_cadence_revision').notNull().default(1),
```

Expose the same fields on `TeamOut`, `TeamDetail`, `TeamCreate`, and `TeamUpdate` in both API and web contract mirrors. Generate a Drizzle migration that copies `cycle_cadence_weeks * 7`, sets the Monday anchor, and drops the old column only after copying.

- [ ] **Step 4: Run migration and focused tests GREEN**

Run: `pnpm --filter @docket/db db:generate && pnpm --filter @docket/api test -- tests/routes/teams.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit the storage slice**

Commit as `feat(cycles): Store team cadence in calendar days` with a body explaining the compatible week-to-day migration.

### Task 2: Calendar-day cycle generation

**Files:**

- Modify: `apps/api/src/lib/cycle-window.ts`
- Modify: `apps/api/tests/lib/cycle-window.test.ts`

- [ ] **Step 1: Replace week tests with failing schedule tests**

Cover 1, 7, 10, and 365 days, leap day, a DST transition, a target years ahead, stable starts, and a 400-window request cap.

```ts
const slots = cycleWindowsThrough({ anchor: '2026-03-07', cadenceDays: 1 }, '2026-03-10');
expect(slots.map((slot) => slot.startDate)).toEqual([
  '2026-03-07',
  '2026-03-08',
  '2026-03-09',
  '2026-03-10',
]);
```

- [ ] **Step 2: Run generator tests RED**

Run: `pnpm --filter @docket/api test -- tests/lib/cycle-window.test.ts --maxWorkers=2`
Expected: FAIL because the day schedule API does not exist.

- [ ] **Step 3: Implement pure date math**

Export `normalizeCadenceDays`, `cycleWindowContaining`, and `cycleWindowsThrough`. Use UTC calendar-date arithmetic, derive inclusive timestamp boundaries only at the edge, and throw `CycleRangeLimitError` above 400 returned windows.

- [ ] **Step 4: Run generator tests GREEN**

Run: `pnpm --filter @docket/api test -- tests/lib/cycle-window.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit the generator**

Commit as `feat(cycles): Generate cycles from day-based schedules`.

### Task 3: Explicit through-date generation API

**Files:**

- Modify: `packages/db/src/schema/work.ts`
- Modify: `apps/api/src/routes/cycle-helpers.ts`
- Modify: `apps/api/src/routes/cycles.ts`
- Modify: `domains/work/src/contracts/cycle.ts`
- Test: `apps/api/tests/routes/cycles-autoroll.test.ts`
- Test: `apps/api/tests/routes/cycles.test.ts`
- Create: generated migration under `packages/db/drizzle/`

- [ ] **Step 1: Write failing API tests**

Add `POST /v1/orgs/:orgId/cycles/ensure` cases for a quarter-ahead daily team, repeated and concurrent calls, several years ahead via bounded pages, cross-org team ids, a through date before the anchor, more than 400 windows, and provider-linked teams.

```ts
const response = await app.request(`/v1/orgs/${orgId}/cycles/ensure`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ teamId, throughDate: '2026-12-31' }),
});
expect(response.status).toBe(200);
```

- [ ] **Step 2: Run route tests RED**

Run: `pnpm --filter @docket/api test -- tests/routes/cycles-autoroll.test.ts tests/routes/cycles.test.ts --maxWorkers=2`
Expected: FAIL with the route missing.

- [ ] **Step 3: Make native start dates the idempotency key**

Add a partial unique index for native cycles on `(team_id, starts_at)`. Stop using `number` as the conflict target. Preserve `number` as compatibility metadata and allocate it transactionally without exposing it as a name.

- [ ] **Step 4: Implement bounded ensure**

Add a Zod body `{ teamId, throughDate, fromDate? }`, require `contribute`, lock the team row, reject provider-owned cadence, generate at most 400 windows, insert with `onConflictDoNothing` against the native start key, refresh native lifecycle status, and return date-ordered `CycleOut` items.

- [ ] **Step 5: Update compatibility reads**

Make `/cycles/current` and `roll=true` use the day schedule while preserving their response purpose. Rename `cadenceWeeks` to `cadenceDays` and include the anchor in `CycleWindow`.

- [ ] **Step 6: Run route tests GREEN**

Run: `pnpm --filter @docket/api test -- tests/routes/cycles-autoroll.test.ts tests/routes/cycles.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit the API slice**

Commit as `feat(cycles): Generate future cycles through any date`.

### Task 4: Safe cadence changes

**Files:**

- Modify: `apps/api/src/routes/teams.ts`
- Create: `apps/api/src/services/team-cycle-cadence.ts`
- Test: `apps/api/tests/routes/team-cycle-cadence.test.ts`

- [ ] **Step 1: Write failing preservation tests**

Test a cadence change with current work, an occupied future cycle, empty future cycles before and after it, a stale revision, a later explicit anchor, and a provider-linked team. Assert every existing task keeps its `cycleId`.

- [ ] **Step 2: Run cadence tests RED**

Run: `pnpm --filter @docket/api test -- tests/routes/team-cycle-cadence.test.ts --maxWorkers=2`
Expected: FAIL because cadence update behavior does not exist.

- [ ] **Step 3: Implement the transaction service**

Lock the team, compare `cycleCadenceRevision`, find the latest future native cycle referenced by any task, preserve the old schedule through that boundary, delete only empty native generated cycles after it, validate the requested anchor against the safe boundary, update cadence and increment the revision, then return `{ team, effectiveAnchor, removedEmptyCycles }`.

- [ ] **Step 4: Wire Team PATCH to the service**

Use the cadence service only when cadence fields are present. Keep ordinary Team patches on their existing path. Return stable `409 cadence_changed` for a stale revision and field errors for an unsafe anchor.

- [ ] **Step 5: Run cadence tests GREEN**

Run: `pnpm --filter @docket/api test -- tests/routes/team-cycle-cadence.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit cadence changes**

Commit as `feat(cycles): Preserve planned work across cadence changes`.

### Task 5: Shared future-cycle roster

**Files:**

- Create: `apps/web/src/lib/future-cycle-roster.ts`
- Create: `apps/web/src/components/pickers/future-cycle-picker.tsx`
- Modify: `apps/web/src/components/pickers/options.tsx`
- Test: `apps/web/tests/cycles/future-cycle-roster.test.ts`
- Test: `apps/web/tests/cycles/future-cycle-picker.test.tsx`

- [ ] **Step 1: Write failing roster and picker tests**

Cover end-of-next-quarter calculation, iterative 400-window paging, date jump, Current/Upcoming grouping, chronological ordering, completed-option exclusion, retained selected completed cycle, refresh after a cadence conflict, and application-owned error copy.

- [ ] **Step 2: Run web tests RED**

Run: `pnpm --filter @docket/web test -- tests/cycles/future-cycle-roster.test.ts tests/cycles/future-cycle-picker.test.tsx --maxWorkers=2`
Expected: FAIL because the shared roster does not exist.

- [ ] **Step 3: Implement the roster query and picker**

The roster calls `cycles/ensure`, then refreshes the cycle list for one team. The picker renders current/upcoming sections and a `DatePicker`-backed **Go to date…** action. It does not assign until an option is selected.

- [ ] **Step 4: Run web tests GREEN**

Run: `pnpm --filter @docket/web test -- tests/cycles/future-cycle-roster.test.ts tests/cycles/future-cycle-picker.test.tsx --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit the shared roster**

Commit as `feat(cycles): Browse future cycles from one assignment picker`.

### Task 6: Use the roster on every assignment surface

**Files:**

- Modify: `apps/web/src/components/pickers/use-composer-options.ts`
- Modify: `apps/web/src/components/tasks/create-task.tsx`
- Modify: `apps/web/src/components/tasks/task-form-pickers.tsx`
- Modify: `apps/web/src/lib/use-task-detail.ts`
- Modify: `apps/web/src/components/task-detail/use-task-rosters.ts`
- Modify: `apps/web/src/components/task-detail/task-secondary-properties.tsx`
- Modify: `apps/web/src/components/canvas/canvas-properties-editor.tsx`
- Test: `apps/web/tests/composers/create-task.test.tsx`
- Test: `apps/web/tests/task-detail/task-secondary-properties.test.tsx`
- Test: `apps/web/tests/components/canvas/canvas-properties-errors.test.tsx`

- [ ] **Step 1: Add failing surface tests**

For composer, detail, and canvas, open the cycle picker, select a generated quarter-ahead cycle, and assert the existing create/move command receives its id. Assert switching teams clears the cycle and reloads the team-scoped roster.

- [ ] **Step 2: Run all three tests RED**

Run: `pnpm --filter @docket/web test -- tests/composers/create-task.test.tsx tests/task-detail/task-secondary-properties.test.tsx tests/components/canvas/canvas-properties-errors.test.tsx --maxWorkers=2`
Expected: FAIL because those surfaces still consume raw cycle lists.

- [ ] **Step 3: Replace raw cycle options**

Use `FutureCyclePicker` and its shared roster in all three surfaces. Delete duplicate cycle fetching and filtering. Keep the task move mutation as the only assignment write.

- [ ] **Step 4: Run all three tests GREEN**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit surface integration**

Commit as `feat(tasks): Assign work to any future cycle`.

### Task 7: Team cadence settings

**Files:**

- Create: `apps/web/src/components/team-detail/team-cadence-settings.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx`
- Test: `apps/web/tests/team-detail/team-cadence-settings.test.tsx`

- [ ] **Step 1: Write failing settings tests**

Cover manage-only visibility, 1 and 365 day values, rejection of 0 and 366, three-window preview, effective-anchor minimum, stale revision feedback, removal count confirmation, and provider-owned read-only copy.

- [ ] **Step 2: Run settings tests RED**

Run: `pnpm --filter @docket/web test -- tests/team-detail/team-cadence-settings.test.tsx --maxWorkers=2`
Expected: FAIL because Team Settings does not exist.

- [ ] **Step 3: Build Team Settings**

Add a Settings tab only for managers. Compose existing `SettingsGroup`, `SettingRow`, number input, and `DatePicker` primitives. Compute the preview through the same pure schedule helper shared with API-compatible date semantics. Save the current revision and refresh Team plus cycle roster queries on success.

- [ ] **Step 4: Run settings tests GREEN**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit Team Settings**

Commit as `feat(cycles): Configure cadence from team settings`.

### Task 8: Documentation and local acceptance

**Files:**

- Modify: `apps/docs/guides/concepts/cycles.mdx`
- Modify: `docs/WORKLOG.md`
- Create: `apps/web/e2e/work/future-cycle-planning.spec.ts`
- Create: screenshots under `.data/design-review/2026-09-19-future-cycles/` (ignored evidence)

- [ ] **Step 1: Add the end-to-end journey**

Create a team, set a one-day cadence, jump at least one quarter ahead, create and assign a task, reload, and assert the assignment persists.

- [ ] **Step 2: Run targeted checks**

Run with bounded concurrency:

```bash
pnpm turbo typecheck lint test --filter=@docket/api --filter=@docket/web --filter=@docket/db --concurrency=2
```

Expected: PASS.

- [ ] **Step 3: Run the documented UI stack and capture evidence**

Use `scripts/dev-stack.sh`, `e2e/tools/dev-session.ts`, and `e2e/tools/capture-shots.ts`. Capture Team Settings and the task picker at 1440×900 and 390×844 in both themes. The 320-pixel overflow check must pass. Reset the shared database afterward.

- [ ] **Step 4: Update documentation and work log**

Document arbitrary future planning, 1–365 day cadence, safe cadence changes, provider ownership, validation commands, screenshot paths, decisions, and learnings. Mark the work-log task complete only after all acceptance evidence exists.

- [ ] **Step 5: Run repository release validation**

Run `~/.claude/resource-limits/agentctl status`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:release` with the repository's bounded concurrency where supported. Expected: all exit 0.

- [ ] **Step 6: Commit acceptance and docs**

Commit as `feat(cycles): Verify configurable future planning`.

### Task 9: Linear integration and production deployment

**Files:**

- Inspect: `docs/engineering/deployment.md`
- Inspect: `.github/workflows/ci.yml`
- Modify only if evidence requires: deployment or migration configuration in scope

- [ ] **Step 1: Rebase onto current origin/main**

Fetch `origin`, rebase the completed commits, rerun affected tests after any conflict, and verify `git rev-list --merges --count origin/main..HEAD` prints `0`.

- [ ] **Step 2: Integrate linearly into main**

Fast-forward or cherry-pick the verified commits into the primary main checkout according to the repository runbook. Verify the origin remote is SSH and the resulting history has no merge commit.

- [ ] **Step 3: Run final main checks and push once**

Run the local release checks against the exact main SHA, then push `main` once. Do not create a pull request.

- [ ] **Step 4: Watch the production workflow**

Inspect the one workflow run for that SHA until every gate and `deploy-production` completes. Rerun only a transient failed job at the same SHA. Do not push a no-op commit.

- [ ] **Step 5: Verify production**

Confirm the production API exposes the cadence and ensure contracts, migration completed, the web serves the new Team Settings assets, and an authenticated production journey can configure cadence and assign a task at least one quarter ahead without moving existing planned work.

- [ ] **Step 6: Record deployment evidence**

Add the deployed SHA, workflow run, production probes, authenticated acceptance result, and any unverified external gate to `docs/WORKLOG.md`. Commit and push this evidence only if repository policy treats it as product history; otherwise report it without creating a second deployment.

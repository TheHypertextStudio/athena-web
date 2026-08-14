# Athena-guided Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Today into an Athena-first daily operating surface that identifies the current and
next action, connects them to larger work, and offers feasible momentum when the accepted plan is
clear.

**Architecture:** Extend `GET /v1/hub/today` into a bounded, visibility-filtered read model instead
of composing several client-side queries. Keep ranking and state derivation in pure projection
functions, keep mutations semantic and server-owned, and build the page from focused components
using the existing typed TanStack Query, Athena conversation, timer, and agenda primitives.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle, PostgreSQL/PGlite, Next.js App Router, React,
TanStack Query, Vitest, Testing Library, Playwright, Tailwind CSS, Docket UI primitives.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-12-athena-guided-today-design.md` as the product source of
  truth.
- Render exactly one current item, one following item, at most four status cards, and at most three
  momentum suggestions.
- Athena is the default composer destination; deterministic task capture remains explicitly
  selectable.
- Treat `not_generated` with no personal plan rows as Unplanned; treat `empty_week` and an accepted
  but completed plan as Cleared.
- Do not infer a planning receipt from missing rows. Removing the last row returns the day to
  Unplanned unless scheduling reports a generated day.
- “Complete” must update the Task workflow and daily-plan representation in one server operation.
- Every task, Project, and Initiative in the response must pass `resolveResourceAccess` for the
  caller.
- Never render provider or exception text. Errors use application-owned copy.
- Common actions stay inline; detailed Task, approval, Project, Initiative, and calendar workflows
  open their main pages.
- The shell agenda rail remains the only chronological day surface.
- Preserve keyboard access, visible focus, reduced-motion behavior, and 44px minimum touch targets.
- No new runtime dependency is required.

---

## File map

- `packages/types/src/hub.ts` owns the public Today DTOs and semantic-action contracts.
- `apps/api/src/services/hub/today-projection.ts` owns pure plan-state, focus, status, and momentum
  selection.
- `apps/api/src/routes/hub-today.ts` loads bounded candidate rows, resolves access in batches, and
  assembles the projection.
- `apps/api/src/routes/hub-today-actions.ts` owns atomic Today mutations.
- `apps/api/src/routes/hub.ts` exposes the read and action routes.
- `apps/web/src/app/(app)/today/use-today-data.ts` is the single typed Today read hook.
- `apps/web/src/app/(app)/today/use-today-actions.ts` centralizes mutations and cache coherence.
- `apps/web/src/components/today/today-prompt.tsx` owns the Athena-first entry field.
- `apps/web/src/components/today/plan-today-card.tsx` owns the Unplanned affordance.
- `apps/web/src/components/today/focus-sequence.tsx` owns Now and After this.
- `apps/web/src/components/today/work-in-motion.tsx` owns Project and Initiative cards.
- `apps/web/src/components/today/keep-the-momentum.tsx` owns Cleared suggestions.
- `apps/web/src/app/(app)/today/page.tsx` composes the finite page states.

---

### Task 1: Define and prove the Today read model

**Files:**

- Modify: `packages/types/src/hub.ts`
- Create: `apps/api/src/services/hub/today-projection.ts`
- Create: `apps/api/tests/services/hub-today-projection.test.ts`

**Interfaces:**

- Consumes: existing `HubTaskItem`, `DailyPlanItemStatus`, task priority/state, and ISO timestamps.
- Produces: `HubTodayPlanState`, `HubTodayPlanItem`, `HubTodayFocus`, `HubTodayStatusCard`,
  `HubTodaySuggestion`, `derivePlanState(input)`, `selectFocus(input)`,
  `selectStatusCards(input)`, and `selectMomentum(input)`.

- [x] **Step 1: Write failing contract and selector tests**

  Cover these exact cases in table-driven Vitest tests:

  ```ts
  expect(derivePlanState({ readiness: 'not_generated', items: [] })).toBe('unplanned');
  expect(derivePlanState({ readiness: 'empty_week', items: [] })).toBe('cleared');
  expect(derivePlanState({ readiness: 'ready', items: [planned] })).toBe('active');
  expect(derivePlanState({ readiness: 'ready', items: [done] })).toBe('cleared');
  expect(selectFocus({ items: [blocked, current, following], now })).toEqual({
    now: current,
    after: following,
  });
  expect(selectStatusCards(statusCandidates)).toHaveLength(4);
  expect(selectMomentum(momentumCandidates)).toEqual([fitsAndUnblocks, fitsAndDue]);
  ```

  Also assert that focus skips completed work, momentum excludes blocked/invisible/already-planned
  work, cards prefer focus-linked entities, and every selector returns stable ordering for equal
  scores.

- [x] **Step 2: Run the focused test and observe the missing-module failure**

  Run:

  ```bash
  pnpm --filter @docket/api exec vitest run tests/services/hub-today-projection.test.ts
  ```

  Expected: FAIL because `today-projection.ts` and the new contracts do not exist.

- [x] **Step 3: Add the typed contracts**

  Define discriminated schemas with these stable shapes:

  ```ts
  HubTodayPlanState = z.enum(['unplanned', 'active', 'cleared']);
  HubTodayPlanItem = HubTaskItem.extend({
    planItemId: DailyPlanItemId,
    planStatus: z.enum(['planned', 'done']),
    position: z.number().int(),
    estimateMinutes: z.number().int().positive().nullable(),
    timeboxStartsAt: z.string().nullable(),
    timeboxEndsAt: z.string().nullable(),
    blocked: z.boolean(),
    reason: z.string(),
  });
  HubTodayFocus = z.object({
    now: HubTodayPlanItem.nullable(),
    after: HubTodayPlanItem.nullable(),
  });
  HubTodayStatusCard = z.discriminatedUnion('kind', [
    HubTodayProjectStatus,
    HubTodayInitiativeStatus,
  ]);
  HubTodaySuggestion = HubTaskItem.extend({
    estimateMinutes: z.number().int().positive(),
    reason: z.string(),
  });
  ```

  Add TSDoc for every exported schema/type and replace the obsolete “three-pane cockpit” wording.

- [x] **Step 4: Implement deterministic pure selectors**

  Use explicit score tuples rather than AI-authored copy:

  ```ts
  const compareTuple = (left: readonly number[], right: readonly number[]): number => {
    for (let index = 0; index < left.length; index += 1) {
      const delta = (right[index] ?? 0) - (left[index] ?? 0);
      if (delta !== 0) return delta;
    }
    return 0;
  };
  ```

  Focus order is active timer, current timebox, then accepted plan position. Momentum order is
  dependency impact, priority, due proximity, start-date readiness, recent context, then id; filter
  estimates greater than remaining availability. Status cards score focus linkage, Today linkage,
  semantic risk, staleness, approaching target, and update recency, then de-duplicate exact entities
  and cap at four.

- [x] **Step 5: Run the projection tests**

  Run the command from Step 2. Expected: PASS.

- [x] **Step 6: Commit the contract slice**

  Stage only the three files and commit as `feat(hub): Define the Today operating projection` with
  a substantive body explaining the finite server-owned selection rules.

### Task 2: Assemble a visible, grounded Today payload

**Files:**

- Modify: `apps/api/src/routes/hub-today.ts`
- Modify: `apps/api/src/routes/hub.ts`
- Modify: `apps/api/tests/routes/hub-aggregation.test.ts`

**Interfaces:**

- Consumes: Task 1 selectors and `resolveResourceAccess(userId, refs)`.
- Produces: `buildHubTodayPayload(userId, date)` returning the extended `HubTodayOut`.

- [x] **Step 1: Extend route tests with realistic multi-org fixtures**

  Assert the endpoint returns only accepted daily-plan rows in `plan`, derives `planState`, selects
  Now/After, includes no more than four visible status cards, and returns no more than three fitting
  suggestions. Add a private Task, private Project, and denied Initiative fixture and assert none of
  their identifiers or titles appears anywhere in the serialized response.

- [x] **Step 2: Run the route test and confirm the new assertions fail**

  Run:

  ```bash
  pnpm --filter @docket/api test -- tests/routes/hub-aggregation.test.ts
  ```

  Expected: FAIL because the route still appends due tasks to `plan` and has no new projection.

- [x] **Step 3: Load bounded candidate sets**

  Keep each query org-scoped and capped before projection. Load: personal plan rows for `date`,
  their Tasks and dependency blockers, current timer/session state, due/assigned momentum candidates,
  linked Projects and Initiatives, latest durable updates, next milestones, task progress, and unread
  attention counts. Due work remains in `needsAttention.dueToday`; it never becomes accepted plan
  work merely by sharing a date.

- [x] **Step 4: Apply one batched visibility pass before selection**

  Build refs for every candidate and filter with:

  ```ts
  const access = await resolveResourceAccess(userId, refs);
  const canView = (ref: ResourceAccessRef): boolean =>
    access.get(resourceAccessKey(ref))?.canView === true;
  ```

  Remove invisible Tasks before dependency/focus/momentum calculations, and invisible Projects or
  Initiatives before status selection. Never use organization membership alone as view permission.

- [x] **Step 5: Resolve scheduling readiness and assemble `HubTodayOut`**

  Reuse `loadDayContext` and the scheduling directive receipt for the requested day; map it to
  `not_generated | ready | empty_week`, then call the pure selectors. Return a concise deterministic
  `brief` sentence derived from attention count and plan state, not model-generated prose.

- [x] **Step 6: Run route and contract tests**

  Run:

  ```bash
  pnpm --filter @docket/api test -- tests/routes/hub-aggregation.test.ts tests/services/hub-today-projection.test.ts
  pnpm --filter @docket/types typecheck
  ```

  Expected: PASS.

- [x] **Step 7: Commit the read-model slice**

  Commit as `feat(hub): Ground the Today brief in visible work` with the route, tests, and any
  focused helper extracted from `hub-today.ts`.

### Task 3: Make completion a single semantic action

**Files:**

- Create: `apps/api/src/routes/hub-today-actions.ts`
- Modify: `apps/api/src/routes/hub.ts`
- Modify: `apps/api/src/lib/task-state.ts`
- Modify: `packages/types/src/hub.ts`
- Create: `apps/api/tests/routes/hub-today-actions.test.ts`

**Interfaces:**

- Consumes: `setTaskState`, caller actor context, team workflow states, and a daily-plan item id.
- Produces: `POST /v1/hub/today/items/:planItemId/complete` returning
  `{ task: HubTaskItem; planItem: DailyPlanItemOut }`.

- [x] **Step 1: Write failing action tests**

  Prove the action: chooses the Team’s `type === 'completed'` state, updates Task state and
  `completedAt`, marks the plan row done, emits the existing task audit/event side effects, rejects
  another user’s plan row as 404, rejects an invisible Task as 404, and leaves both records
  unchanged when no completed state exists.

- [x] **Step 2: Run the focused test and observe 404/missing-route failures**

  ```bash
  pnpm --filter @docket/api test -- tests/routes/hub-today-actions.test.ts
  ```

- [x] **Step 3: Define the request/response contracts and route**

  The route accepts no client-supplied organization, Task, user, or state id. Resolve all four from
  the authenticated Hub-owned plan row. Validate caller visibility with `resolveResourceAccess`.

- [x] **Step 4: Make the state transition transaction-safe**

  Refactor `setTaskState` only enough to accept a Drizzle transaction for its row mutation. In one
  transaction: lock/load the plan row and Task, resolve the completed workflow state, run the Task
  transition, and update `dailyPlanItem.status = 'done'`. Run search/notification/recurrence work
  through the existing post-transition path only after the transaction succeeds.

- [x] **Step 5: Run action, task-state, and route tests**

  ```bash
  pnpm --filter @docket/api test -- tests/routes/hub-today-actions.test.ts tests/routes/task-state.test.ts tests/routes/hub-aggregation.test.ts
  ```

  Expected: PASS with no partially updated row in the failure cases.

- [x] **Step 6: Commit the action slice**

  Commit as `feat(hub): Complete Today work semantically` with a body explaining why the browser
  does not coordinate two writes.

### Task 4: Centralize Today client data and cache coherence

**Files:**

- Modify: `apps/web/src/app/(app)/today/use-today-data.ts`
- Create: `apps/web/src/app/(app)/today/use-today-actions.ts`
- Create: `apps/web/tests/today/use-today-actions.test.tsx`

**Interfaces:**

- Consumes: `apiQueryOptions`, `useApiQuery`, `useApiMutation`, semantic completion route, existing
  daily-plan mutations, timer controls, and query keys.
- Produces: `useTodayActions()` with `complete`, `defer`, `swapFocus`, `timebox`, `startFocus`,
  `addSuggestion`, `startSuggestion`, and `dismissSuggestion`.

- [ ] **Step 1: Write failing hook tests**

  Render a harness under the existing Query test provider. Assert each successful mutation
  invalidates/refetches Today, daily plan, day directive, agenda, and the affected Task key. Assert
  failed mutations expose application-owned copy and restore optimistic cache state.

- [ ] **Step 2: Run the hook test and observe the missing-hook failure**

  ```bash
  pnpm --filter @docket/web test -- tests/today/use-today-actions.test.tsx
  ```

- [ ] **Step 3: Implement typed hooks only**

  Move Today reads to `apiQueryOptions`/`useApiQuery`; do not introduce `useEffect` plus `fetch`.
  Reuse agenda mutation helpers for reorder/timebox/defer and timer hooks for focus. Keep dismissed
  suggestion ids local to the current page/session and never persist them to the Task.

- [ ] **Step 4: Run hook and source-policy tests**

  ```bash
  pnpm --filter @docket/web test -- tests/today/use-today-actions.test.tsx tests/source-policy.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the client-data slice**

  Commit as `feat(web): Coordinate Today actions through shared data hooks`.

### Task 5: Put Athena and planning first

**Files:**

- Modify: `apps/web/src/components/today/today-prompt.tsx`
- Create: `apps/web/src/components/today/plan-today-card.tsx`
- Modify: `apps/web/tests/today/today-prompt.test.tsx`
- Create: `apps/web/tests/today/plan-today-card.test.tsx`

**Interfaces:**

- Consumes: `onStartSession(draft)`, `planState`, and the server-provided `brief`.
- Produces: Athena-default `TodayPrompt` and `PlanTodayCard`.

- [ ] **Step 1: Write interaction tests**

  Assert the default field is labeled “Ask Athena about today”, submitting opens the shared session,
  the destination control explicitly switches to “Add a task”, keyboard submission works, and the
  Unplanned card calls `onStartSession('Plan today')`. Assert no Plan card renders for Active or
  Cleared.

- [ ] **Step 2: Run tests and confirm current task-default behavior fails**

  ```bash
  pnpm --filter @docket/web test -- tests/today/today-prompt.test.tsx tests/today/plan-today-card.test.tsx
  ```

- [ ] **Step 3: Implement the Athena-first composer and plan card**

  Keep the composer compact at rest, name both destinations, preserve the existing in-place
  `TodaySession` transition, and show one linked brief sentence beneath it. Use existing Docket UI
  primitives and semantic tokens; avoid decorative gradients and icon-only primary actions.

- [ ] **Step 4: Run focused tests**

  Expected: PASS, including existing `today-session.test.tsx`.

- [ ] **Step 5: Commit the Athena entry slice**

  Commit as `feat(web): Make Athena the front door to Today`.

### Task 6: Build Now, After this, and inline controls

**Files:**

- Create: `apps/web/src/components/today/focus-sequence.tsx`
- Create: `apps/web/tests/today/focus-sequence.test.tsx`
- Modify: `apps/web/src/app/(app)/today/page.tsx`

**Interfaces:**

- Consumes: `HubTodayFocus`, organization labels, `useTodayActions()`, and primary entity routes.
- Produces: `FocusSequence` with one strong Now card and one quieter After this continuation.

- [ ] **Step 1: Write behavior tests**

  Assert Now precedes After this, blocked/approval intervention copy replaces a non-actionable
  position, start/resume focus calls the timer action, complete calls the semantic endpoint, defer
  and swap use plan mutations, timebox exposes the shared simple editor, and titles open the full
  Task page. Assert no third plan item is rendered.

- [ ] **Step 2: Run the test and observe the missing component**

  ```bash
  pnpm --filter @docket/web test -- tests/today/focus-sequence.test.tsx
  ```

- [ ] **Step 3: Implement the finite sequence**

  Show title, workspace, scheduled time or estimate, deterministic reason, state, and blocker. Keep
  the default row to two visible actions plus a labeled overflow menu at narrow widths. Give every
  interactive target a visible focus ring and at least 44px touch area.

- [ ] **Step 4: Replace the generic `TodaysWork` placement on the page**

  Render `FocusSequence` only for Active state. Leave `NeedsYou` available only for interventions
  that are not already represented in the two focus positions; do not reintroduce an attention
  dashboard.

- [ ] **Step 5: Run focused Today tests**

  ```bash
  pnpm --filter @docket/web test -- tests/today/focus-sequence.test.tsx tests/today/today-sections.test.tsx tests/today/today-session.test.tsx
  ```

- [ ] **Step 6: Commit the focus slice**

  Commit as `feat(web): Put the next two actions at the center of Today`.

### Task 7: Connect execution to Projects and Initiatives

**Files:**

- Create: `apps/web/src/components/today/work-in-motion.tsx`
- Create: `apps/web/tests/today/work-in-motion.test.tsx`
- Modify: `apps/web/src/app/(app)/today/page.tsx`

**Interfaces:**

- Consumes: `HubTodayStatusCard[]` and entity routes.
- Produces: `WorkInMotion` with discriminated Project and Initiative card compositions.

- [ ] **Step 1: Write card tests**

  Assert a Project renders task progress, an Initiative renders connected-work health, latest update
  excerpts and ages are grounded fields, missing updates say “No update yet”, target/milestone dates
  render when present, and only four cards render. Assert links target the full Project/Initiative.

- [ ] **Step 2: Run the test and observe the missing component**

  ```bash
  pnpm --filter @docket/web test -- tests/today/work-in-motion.test.tsx
  ```

- [ ] **Step 3: Implement editorial status cards**

  Use a two-column grid at wide container widths and one column at narrow widths. Project cards use
  restrained progress; Initiative cards use health composition. Healthy work stays quiet; at-risk,
  off-track, and stale states receive semantic emphasis. Workspace/entity display color is a narrow
  accent, never the sole status signal.

- [ ] **Step 4: Add `WorkInMotion` below focus on the page**

  Omit the entire section when there are no cards. Do not fetch individual overview endpoints from
  each card.

- [ ] **Step 5: Run component and accessibility tests**

  Run the focused test plus the existing web accessibility policy tests. Expected: PASS.

- [ ] **Step 6: Commit the status slice**

  Commit as `feat(web): Show the larger work moving through Today`.

### Task 8: Offer feasible momentum when the day is clear

**Files:**

- Create: `apps/web/src/components/today/keep-the-momentum.tsx`
- Create: `apps/web/tests/today/keep-the-momentum.test.tsx`
- Modify: `apps/web/src/app/(app)/today/page.tsx`

**Interfaces:**

- Consumes: Cleared `planState`, `HubTodaySuggestion[]`, and `useTodayActions()`.
- Produces: `KeepTheMomentum` with Start now, Add to today, Open task, and Dismiss actions.

- [ ] **Step 1: Write behavior tests**

  Assert the section renders only in Cleared state, shows at most three suggestions, names the
  deterministic reason and estimate, adds in the next position, Start now adds then focuses, Open
  navigates without mutation, and Dismiss removes only the local suggestion.

- [ ] **Step 2: Run the test and observe the missing component**

  ```bash
  pnpm --filter @docket/web test -- tests/today/keep-the-momentum.test.tsx
  ```

- [ ] **Step 3: Implement the suggestion list and cleared receipt**

  Use Athena voice in the section heading and explanation, but never fabricate candidate rationale.
  If no feasible candidate fits, render a short “You’re clear” receipt with an explicit Athena
  entry action rather than an empty panel.

- [ ] **Step 4: Compose all three page states**

  The resting order must be: compact heading, Athena field/brief, Plan card when Unplanned,
  FocusSequence when Active, WorkInMotion when non-empty, and KeepTheMomentum when Cleared. Retire
  generic sections from the route when their information is represented by the projection.

- [ ] **Step 5: Run all Today unit tests**

  ```bash
  pnpm --filter @docket/web test -- tests/today
  ```

- [ ] **Step 6: Commit the cleared-state slice**

  Commit as `feat(web): Let Athena sustain momentum after the plan clears`.

### Task 9: Verify behavior, craft, and production readiness

**Files:**

- Modify: `apps/web/e2e/work/verify-today.spec.ts`
- Modify: `docs/WORKLOG.md`
- Modify only if evidence demands it: Today implementation and tests from Tasks 1–8.

**Interfaces:**

- Consumes: completed Today surface and the live local app.
- Produces: regression coverage, craft evidence, review resolution, and a completed worklog record.

- [ ] **Step 1: Extend the critical Today E2E journey**

  Cover Unplanned → open Athena planning session, Active → complete Now and observe After this
  advance, and Cleared → add a momentum suggestion. Assert the shell agenda remains present and no
  duplicate calendar appears in the main pane.

- [ ] **Step 2: Run focused API, web, and E2E validation**

  ```bash
  pnpm --filter @docket/api test -- tests/services/hub-today-projection.test.ts tests/routes/hub-aggregation.test.ts tests/routes/hub-today-actions.test.ts
  pnpm --filter @docket/web test -- tests/today
  pnpm --filter @docket/web test:e2e -- e2e/work/verify-today.spec.ts
  ```

- [ ] **Step 3: Run the full repository gates serially**

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm format:check
  ```

  All commands must exit 0, or a confirmed unrelated baseline failure must be recorded separately
  with exact output and the owned change revalidated by focused commands.

- [ ] **Step 4: Run the Docket Craft Rubric**

  Use `.agents/skills/design-review/SKILL.md` exactly: capture Today at two widths and both themes,
  exercise Unplanned/Active/Cleared and session expansion, score all eight dimensions, and fix every
  Critical/Major finding. Re-run affected tests after each correction.

- [ ] **Step 5: Perform an independent code review**

  Review `origin/main..HEAD` for correctness, access control, transactionality, cache consistency,
  accessibility, responsive behavior, and test strength. Resolve every actionable finding and rerun
  the relevant gate; record “no findings” only when the diff supports it.

- [ ] **Step 6: Complete the worklog and commit validation artifacts**

  Move `[TODAY-001]` to Completed with files changed, validation evidence, craft findings, review
  resolution, and learnings. Commit as `feat(web): Finish the Athena-guided Today surface` if the
  E2E/worklog changes are not already part of the last product slice.

- [ ] **Step 7: Verify linear history**

  ```bash
  git rev-list --merges --count origin/main..HEAD
  git status --short
  ```

  Expected: `0` merge commits and a clean tree.

### Task 10: Land, deploy, and prove production

**Files:**

- No source files unless deployment evidence uncovers a regression.

**Interfaces:**

- Consumes: fully validated linear commits.
- Produces: updated `main`, successful CI/deploy runs, and production behavior evidence.

- [ ] **Step 1: Refresh remote truth and rebase if necessary**

  Fetch `origin`, compare exact divergence, and rebase the Today commits onto current `origin/main`.
  Restore the `[TODAY-001]` worklog entry if the repository’s keep-ours merge driver drops it, then
  rerun affected validation.

- [ ] **Step 2: Fast-forward the local integration worktree**

  Inspect every worktree and the local `main` status. Only with a clean integration worktree,
  fast-forward local `main` to the validated Today head. Never create a merge commit.

- [ ] **Step 3: Push main and monitor exact CI/deployment runs**

  Push the fast-forwarded `main`. Record the commit SHA and follow the GitHub Actions CI and
  production deployment workflows to completion. Treat web, API, database migration, and admin
  deployment states separately.

- [ ] **Step 4: Verify the deployed bundle and behavior**

  Probe `https://docket-api.hypertext.studio/v1/health`,
  `https://docket.hypertext.studio`, and `https://docket-admin.hypertext.studio`. Confirm the web
  deployment serving production contains the pushed SHA, then run a production Today smoke journey
  for Athena expansion and the current page hierarchy without mutating unrelated user data.

- [ ] **Step 5: Report exact release state**

  State local commit, remote `main`, CI, deployment workflow, deployed bundle, and production smoke
  evidence independently. Mark the goal complete only after all required states are confirmed.

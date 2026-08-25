# Program Card activity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Program Cards an optional, designed portfolio presentation with a real eight-week
activity pulse and shared health semantics.

**Architecture:** Extend only the typed `ProgramViewRow` returned by the existing work-view query.
The API will aggregate visible Program, attached-Project, and attached-Task events into a bounded
eight-week summary inside the existing roster statement. A Program-specific card renderer will
consume that summary while every other renderer and target keeps using the generic path.

**Tech Stack:** TypeScript, Zod, Drizzle SQL, Hono API tests, React, Tailwind/MD3 primitives,
Vitest, Playwright visual review.

---

### Task 1: Define the Program activity-pulse contract

**Files:**

- Modify: `packages/types/src/work-view.ts:1308-1329`
- Modify: `packages/types/tests/work-view.test.ts:39-265`

- [ ] **Step 1: Write the failing schema test.**

```ts
expect(
  ProgramViewRow.parse({
    ...programRow,
    activity: {
      weeks: [0, 2, 0, 1, 0, 0, 3, 1],
      latestOccurredAt: '2026-08-24T12:00:00.000Z',
    },
  }).activity,
).toEqual({
  weeks: [0, 2, 0, 1, 0, 0, 3, 1],
  latestOccurredAt: '2026-08-24T12:00:00.000Z',
});
```

- [ ] **Step 2: Run the focused types test and confirm it fails because `activity` is unknown.**

Run: `pnpm --filter @docket/types test packages/types/tests/work-view.test.ts`

- [ ] **Step 3: Add the exact Zod contract.**

```ts
export const ProgramActivitySummary = z
  .object({
    weeks: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    latestOccurredAt: TimestampString.nullable(),
  })
  .strict();
```

Add `activity: ProgramActivitySummary` to `ProgramViewRow`. The eight slots run oldest to newest.

- [ ] **Step 4: Re-run the focused types test and confirm it passes.**

Run: `pnpm --filter @docket/types test packages/types/tests/work-view.test.ts`

### Task 2: Aggregate real visible Program activity inside the work-view statement

**Files:**

- Create: `apps/api/src/lib/work-views/program-activity-sql.ts`
- Modify: `apps/api/src/lib/work-views/projection-sql.ts:97-121`
- Modify: `apps/api/src/lib/work-views/contracts.ts:1-40`
- Modify: `apps/api/src/lib/work-views/query.ts:180-214`
- Test: `apps/api/tests/work-views/query.test.ts`
- Test: `apps/api/tests/work-views/query-plan.test.ts`

- [ ] **Step 1: Write failing API tests for the exact activity boundary.**

Seed one Program, one attached Project, one directly attached Task, one Project Task, and events in
weeks 1, 4, and 8. Assert `weeks` is oldest-to-newest, `latestOccurredAt` names the newest event,
and an event on an unrelated/private work item never appears. Capture the query statement and
assert the request still issues two statements: actor resolution and the single roster aggregate.

- [ ] **Step 2: Run the focused API tests and confirm missing `activity` fails response parsing.**

Run: `pnpm --filter @docket/api test tests/work-views/query.test.ts tests/work-views/query-plan.test.ts`

- [ ] **Step 3: Implement `programActivitySummarySql`.**

The helper accepts `e.id` and the cursor-stable viewer execution context: organization id, actor
id, user id, and `asOf`. It builds eight Monday-aligned UTC buckets with `generate_series(0, 7)`.
It counts `event` rows whose
`docket_entity_id` is the Program id, an unarchived Project with `program_id = e.id`, or a Task
that points directly to the Program or to one of those Projects. It restricts each joined Project
and Task to the same visibility predicate used for a Program viewer before counting its event.
It returns JSON `{ weeks, latestOccurredAt }`, coalescing empty buckets to `0` and the latest time
to `null`.

- [ ] **Step 4: Thread the cursor-stable viewer execution context into the Program projection.**

Replace `projection(context, organizationId)` with
`projection(context, { organizationId, actorId, userId, asOf })` in the contract registry and its
one call in `queryWorkView`. Add
`programActivitySummarySql(sql\`e.id\`, execution) as activity`to the Program projection. The
helper applies`compileAuthorizationSql('project', ...)`and`compileAuthorizationSql('task', ...)`to the associated aliases before aggregating their events.
Do not add a request per card or derive activity from`updatedAt`.

- [ ] **Step 5: Re-run the focused API tests and query-plan test.**

Run: `pnpm --filter @docket/api test tests/work-views/query.test.ts tests/work-views/query-plan.test.ts`

### Task 3: Render the Program-only Cards lens

**Files:**

- Create: `apps/web/src/components/work-views/program-work-card.tsx`
- Modify: `apps/web/src/components/work-views/work-cards.tsx:1-178`
- Create: `apps/web/src/components/work-views/program-work-card.test.tsx`

- [ ] **Step 1: Write failing DOM tests for a Program Card.**

```tsx
render(<ProgramWorkCard row={programRow({ health: 'at_risk', activity: activeWeeks })} />);
expect(screen.getByText('At risk')).toBeVisible();
expect(screen.getByLabelText('Activity: 0, 2, 0, 1, 0, 0, 3, 1 events')).toBeVisible();
expect(screen.queryByText('Connected work')).not.toBeInTheDocument();
expect(screen.queryByText('Project count')).not.toBeInTheDocument();
```

Also cover a null health, missing summary, and all-zero pulse. The all-zero card must say
`No recent activity`, not render an em dash or a fake bar.

- [ ] **Step 2: Run the focused Web test and confirm the component is absent.**

Run: `pnpm --filter @docket/web test src/components/work-views/program-work-card.test.tsx`

- [ ] **Step 3: Implement `ProgramWorkCard`.**

Render the existing neutral `Layers` identity glyph, a truncated name, an optional two-line
summary, and the existing Program/Initiative health dot-label treatment. Render eight neutral,
height-normalized bars with a readable `aria-label`; use no hardcoded colors, project/task counts,
owner rows, redundant entity-type text, alert icon, or health-coloured bars. The only card action
remains its shared link/selection behavior.

- [ ] **Step 4: Dispatch `target === 'program'` to `ProgramWorkCard`.**

Keep `WorkObjectCard`, selection, drag targets, links, load-more behavior, and all non-Program
targets unchanged. The generic `WorkCards` property renderer remains the fallback for Task,
Project, and Initiative Cards.

- [ ] **Step 5: Re-run the focused Web test and the existing work-view tests.**

Run: `pnpm --filter @docket/web test src/components/work-views/program-work-card.test.tsx src/components/work-views`

### Task 4: Validate, document, and release

**Files:**

- Modify: `docs/WORKLOG.md:9-33`
- Create: `docs/design/audits/2026-08-24-program-cards.md`

- [ ] **Step 1: Run targeted static and behavior checks.**

Run: `pnpm --filter @docket/types typecheck && pnpm --filter @docket/api typecheck && pnpm --filter @docket/web typecheck`

Run: `pnpm --filter @docket/api lint && pnpm --filter @docket/web lint`

- [ ] **Step 2: Capture Cards screenshots.**

Capture the authenticated Program Cards view at 1440×900 and 390×844 in light and dark themes.
Include a long title, null health, empty summary, and zero-activity Program. Verify no horizontal
overflow at 320px and keyboard focus reaches the card link and selection control.

- [ ] **Step 3: Write the required scorecard and finish the work log.**

Record evidence for every Docket Craft Rubric dimension and gate. Mark
`PROGRAM-CARD-ACTIVITY-001` `REVIEW` only after all targeted tests and screenshots pass.

- [ ] **Step 4: Commit, fast-forward, deploy, and verify the exact revision.**

Commit the product slice with a substantive body. Rebase onto current `origin/main`, verify
`git rev-list --merges --count origin/main..HEAD` returns `0`, and fast-forward from the primary
checkout. Push the exact revision, wait for required CI and deployment completion, then open the
authenticated production Programs Cards view and verify the eight-week pulse and health treatment.

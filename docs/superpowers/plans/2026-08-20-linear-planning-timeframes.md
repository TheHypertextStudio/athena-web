# Linear-Compatible Planning Timeframes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Linear-compatible year, half-year, quarter, month, and precise-day planning to Project starts, Project targets, and Initiative targets.

**Architecture:** Keep the existing date columns as canonical anchors and add Linear's nullable resolution fields. Store a server-owned fiscal-month snapshot with every broad value so a later workspace setting change cannot rename or move saved work. One pure `@docket/work` module owns calendar arithmetic, while typed API routes, shared pickers, list views, timelines, exports, MCP, and Linear reconciliation consume that contract.

**Tech Stack:** TypeScript, Zod, Drizzle/Postgres, Hono, React 19, Next.js App Router, TanStack Query, Radix/shadcn primitives, Vitest, Playwright.

---

## Global Constraints

- `DateResolution` has exactly `month`, `quarter`, `halfYear`, and `year`.
- A precise day uses a null resolution. Athena never persists a `day` resolution.
- A broad Project start stores the first day of its period.
- A broad Project or Initiative target stores the final day of its period.
- The server owns the fiscal snapshot. Create and update bodies cannot supply it.
- Exact-date clients remain compatible because a date without a resolution remains precise.
- Tasks, Milestones, Cycles, and calendar events retain `DatePicker` or `DateRangePicker`.
- Calendar arithmetic operates on `YYYY-MM-DD` components. It never relies on local-time `Date`
  construction.
- The Work structure setting affects new broad selections only.

### Task 1: Create the planning-timeframe domain

**Files:**

- Create: `domains/work/src/planning-timeframe.ts`
- Create: `domains/work/tests/planning-timeframe.test.ts`
- Modify: `domains/work/package.json`

**Interfaces:**

- Produces `DateResolution`, `PlanningTimeframe`, `timeframeBounds`, `timeframeAnchor`,
  `timeframeLabel`, `timeframeKey`, and `isCanonicalTimeframeAnchor`.
- Accepts zero-based fiscal months from `0` through `11`.
- Returns date-only strings and never returns a `Date` object.

- [x] **Step 1: Write the failing enum and boundary tests**

```typescript
import { describe, expect, it } from 'vitest';

import {
  DateResolution,
  timeframeAnchor,
  timeframeBounds,
  timeframeKey,
  timeframeLabel,
} from '../src/planning-timeframe';

describe('planning timeframes', () => {
  it('uses Linear resolution values', () => {
    expect(DateResolution.options).toEqual(['month', 'quarter', 'halfYear', 'year']);
  });

  it('resolves a calendar quarter to both canonical anchors', () => {
    expect(timeframeBounds('2026-05-19', 'quarter', 0)).toEqual({
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(timeframeAnchor('2026-05-19', 'quarter', 0, 'start')).toBe('2026-04-01');
    expect(timeframeAnchor('2026-05-19', 'quarter', 0, 'target')).toBe('2026-06-30');
  });

  it('keeps a July fiscal year stable in its label and key', () => {
    expect(timeframeBounds('2026-11-03', 'year', 6)).toEqual({
      start: '2026-07-01',
      end: '2027-06-30',
    });
    expect(timeframeLabel('2027-06-30', 'year', 6)).toBe('FY 2027');
    expect(timeframeKey('2027-06-30', 'year', 6)).toBe('2027-06-30|year|6');
  });
});
```

- [x] **Step 2: Run the domain test and verify the missing module fails**

Run: `pnpm --filter @docket/work test -- tests/planning-timeframe.test.ts`

Expected: FAIL because `src/planning-timeframe.ts` does not exist.

- [x] **Step 3: Implement the public types and calendar-component helpers**

```typescript
import { z } from 'zod';

export const DateResolution = z.enum(['month', 'quarter', 'halfYear', 'year']);
export type DateResolution = z.infer<typeof DateResolution>;

export interface PlanningTimeframe {
  readonly date: string;
  readonly resolution: DateResolution | null;
  readonly fiscalYearStartMonth: number | null;
}

export interface TimeframeBounds {
  readonly start: string;
  readonly end: string;
}

export type TimeframeEdge = 'start' | 'target';
```

Implement integer Gregorian helpers for parsing, leap years, month lengths, adding months, and
formatting `YYYY-MM-DD`. Reject invalid dates and fiscal months outside `0..11` with `RangeError`.

- [x] **Step 4: Implement bounds, anchors, labels, keys, and validation**

```typescript
export function timeframeAnchor(
  selectedDate: string,
  resolution: DateResolution,
  fiscalYearStartMonth: number,
  edge: TimeframeEdge,
): string {
  const bounds = timeframeBounds(selectedDate, resolution, fiscalYearStartMonth);
  return edge === 'start' ? bounds.start : bounds.end;
}

export function isCanonicalTimeframeAnchor(value: PlanningTimeframe, edge: TimeframeEdge): boolean {
  if (value.resolution === null) return value.fiscalYearStartMonth === null;
  if (value.fiscalYearStartMonth === null) return false;
  return (
    timeframeAnchor(value.date, value.resolution, value.fiscalYearStartMonth, edge) === value.date
  );
}
```

Use the fiscal year-ending convention. A July 2026 through June 2027 year formats as `FY 2027`.
January workspaces format `year`, `halfYear`, and `quarter` as `2027`, `H1 2027`, and `Q2 2027`.

- [x] **Step 5: Add exhaustive leap-year and fiscal-month coverage**

```typescript
for (let fiscalMonth = 0; fiscalMonth < 12; fiscalMonth += 1) {
  it(`round-trips every resolution for fiscal month ${fiscalMonth}`, () => {
    for (const resolution of DateResolution.options) {
      const bounds = timeframeBounds('2028-02-29', resolution, fiscalMonth);
      expect(timeframeAnchor(bounds.start, resolution, fiscalMonth, 'start')).toBe(bounds.start);
      expect(timeframeAnchor(bounds.end, resolution, fiscalMonth, 'target')).toBe(bounds.end);
    }
  });
}
```

- [x] **Step 6: Export the module and run the domain package gates**

Add this package export:

```json
"./planning-timeframe": "./src/planning-timeframe.ts"
```

Run: `pnpm --filter @docket/work test -- tests/planning-timeframe.test.ts && pnpm --filter @docket/work typecheck && pnpm --filter @docket/work lint`

Expected: PASS.

- [x] **Step 7: Commit the domain slice**

Commit type/scope: `feat(projects)` with a body that explains the null precise-day resolution and
the calendar-component invariant.

### Task 2: Extend DTOs, schema, and migration

**Files:**

- Modify: `packages/types/src/project.ts`
- Modify: `packages/types/src/initiative.ts`
- Modify: `packages/types/src/organization.ts`
- Create: `packages/types/tests/dto/planning-timeframes.test.ts`
- Modify: `packages/db/src/enums.ts`
- Modify: `packages/db/src/schema/identity.ts`
- Modify: `packages/db/src/schema/work.ts`
- Create: `packages/db/drizzle/0094_mighty_martin_li.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0094_snapshot.json`
- Modify: `packages/db/tests/schema/initiative-experience-schema.test.ts`
- Create: `packages/db/tests/schema/planning-timeframe-schema.test.ts`

**Interfaces:**

- Project create/update accepts `startDateResolution` and `targetDateResolution`.
- Initiative create/update accepts `targetDateResolution`.
- Project and Initiative outputs include resolution and read-only fiscal snapshot fields.
- Workspace settings include `fiscalYearStartMonth` as an integer from `0` through `11`.

- [x] **Step 1: Write failing DTO tests for Linear wire compatibility**

```typescript
expect(
  ProjectCreate.parse({
    name: 'Launch Ada',
    startDate: '2026-06-01',
    startDateResolution: 'month',
    targetDate: '2026-06-30',
    targetDateResolution: 'month',
  }),
).toMatchObject({ startDateResolution: 'month', targetDateResolution: 'month' });

expect(
  ProjectCreate.parse({ name: 'Precise launch', targetDate: '2026-06-17' }),
).not.toHaveProperty('targetDateResolution');

expect(WorkspaceSettingsUpdate.parse({ fiscalYearStartMonth: 6 })).toEqual({
  fiscalYearStartMonth: 6,
});
expect(WorkspaceSettingsUpdate.safeParse({ fiscalYearStartMonth: 12 }).success).toBe(false);
```

- [x] **Step 2: Run the DTO test and verify the new fields are stripped or rejected**

Run: `pnpm --filter @docket/types test -- tests/dto/planning-timeframes.test.ts`

Expected: FAIL on the missing resolution and workspace fields.

- [x] **Step 3: Add the documented DTO fields**

```typescript
import { DateResolution } from '@docket/work/planning-timeframe';

startDateResolution: DateResolution.nullable().optional();
targetDateResolution: DateResolution.nullable().optional();

startDateFiscalYearStartMonth: z.number().int().min(0).max(11).nullable();
targetDateFiscalYearStartMonth: z.number().int().min(0).max(11).nullable();
```

Create and update schemas include only resolution fields. Output schemas include resolution and
fiscal snapshot fields. Add `fiscalYearStartMonth` to `WorkspaceSettingsOut`, which makes it
optional on `WorkspaceSettingsUpdate` through the existing `.partial()` contract.

- [x] **Step 4: Write failing schema tests for null pairing and migration defaults**

```typescript
expect(organization.fiscalYearStartMonth.notNull).toBe(true);
expect(organization.fiscalYearStartMonth.default).toBe(0);
expect(project.startDateResolution).toBeDefined();
expect(project.startDateFiscalYearStartMonth).toBeDefined();
expect(initiative.targetDateResolution).toBeDefined();
expect(initiative.targetDateFiscalYearStartMonth).toBeDefined();
```

Add integration fixtures that reject a broad resolution without a fiscal snapshot and reject a
precise date with one.

- [x] **Step 5: Add the enum, columns, and schema checks**

```typescript
export const planningDateResolution = pgEnum('planning_date_resolution', [
  'month',
  'quarter',
  'halfYear',
  'year',
]);
```

Add `fiscalYearStartMonth: integer('fiscal_year_start_month').notNull().default(0)` to
`organization`, plus a `between 0 and 11` check. Add resolution and fiscal snapshot columns beside
each planning date. Add checks that pair nulls and enforce the correct first-day or last-day
boundary. Use fiscal-shifted `date_trunc` expressions for quarter, half-year, and year boundaries.

- [x] **Step 6: Generate and inspect migration 0094**

Run: `pnpm db:generate`

Expected: A migration that creates `planning_date_resolution`, adds seven columns, leaves existing
dates unchanged, defaults each organization to January, and installs all pairing and boundary
checks. Rename the generated SQL to `0094_linear_planning_timeframes.sql` only if the repository's
generator permits a stable custom name without breaking the journal.

- [x] **Step 7: Run DTO, schema, and migration gates**

Run: `pnpm --filter @docket/types test -- tests/dto/planning-timeframes.test.ts && pnpm --filter @docket/db test -- tests/schema/planning-timeframe-schema.test.ts tests/schema/initiative-experience-schema.test.ts && pnpm --filter @docket/types typecheck && pnpm --filter @docket/db typecheck`

Expected: PASS.

- [x] **Step 8: Commit the contract and persistence slice**

Commit type/scope: `feat(projects)` with a body that explains additive migration safety, Linear
field parity, and why fiscal snapshots are read-only.

### Task 3: Enforce atomic timeframe mutations in the API

**Files:**

- Create: `apps/api/src/lib/planning-timeframe.ts`
- Create: `apps/api/tests/lib/planning-timeframe.test.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/routes/initiatives.ts`
- Modify: `apps/api/src/routes/orgs.ts`
- Modify: `apps/api/tests/routes/projects-detail.test.ts`
- Modify: `apps/api/tests/routes/initiatives-detail.test.ts`
- Modify: `apps/api/tests/routes/group-d.test.ts`

**Interfaces:**

- Produces a database patch from one date/resolution pair and the current organization setting.
- Rejects partial broad pairs and noncanonical boundaries with stable `ValidationError` details.
- Clears stale resolution and fiscal data when an old client writes a precise date.

- [x] **Step 1: Write failing pair-normalization tests**

```typescript
expect(
  planningDatePatch({
    date: '2026-06-30',
    resolution: 'month',
    fiscalYearStartMonth: 0,
    edge: 'target',
  }),
).toEqual({
  date: new Date('2026-06-30T00:00:00.000Z'),
  resolution: 'month',
  fiscalYearStartMonth: 0,
});

expect(() =>
  planningDatePatch({
    date: '2026-06-17',
    resolution: 'month',
    fiscalYearStartMonth: 0,
    edge: 'target',
  }),
).toThrow('Choose the last day of the selected month');
```

- [x] **Step 2: Run the helper test and verify the missing helper fails**

Run: `pnpm --filter @docket/api test -- tests/lib/planning-timeframe.test.ts`

Expected: FAIL because the helper does not exist.

- [x] **Step 3: Implement the strict server-owned patch builder**

```typescript
export function planningDatePatch(input: {
  readonly date: string | null;
  readonly resolution: DateResolution | null | undefined;
  readonly fiscalYearStartMonth: number;
  readonly edge: TimeframeEdge;
}): PlanningDatePatch {
  if (input.date === null) return { date: null, resolution: null, fiscalYearStartMonth: null };
  if (input.resolution == null) {
    return { date: utcCalendarDate(input.date), resolution: null, fiscalYearStartMonth: null };
  }
  if (
    !isCanonicalTimeframeAnchor(
      {
        date: input.date,
        resolution: input.resolution,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
      },
      input.edge,
    )
  )
    throw invalidTimeframeBoundary(input.resolution, input.edge);
  return {
    date: utcCalendarDate(input.date),
    resolution: input.resolution,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
  };
}
```

- [x] **Step 4: Write failing route tests for create, update, clear, and old clients**

Cover these requests:

```typescript
await createProject({
  startDate: '2026-04-01',
  startDateResolution: 'quarter',
  targetDate: '2026-09-30',
  targetDateResolution: 'quarter',
});

await updateProject({ targetDate: '2026-09-18' });
await updateProject({ targetDate: null });
await updateInitiative({ targetDate: '2027-06-30', targetDateResolution: 'year' });
```

Assert that the first response returns resolution plus fiscal snapshots. Assert that the old-client
update clears previous target metadata. Assert that null clears all three columns. Assert that a
resolution without its date returns 422.

- [x] **Step 5: Wire Project and Initiative serializers and transactions**

Load `organization.fiscalYearStartMonth` inside the same transaction that writes a broad date.
Map the helper result onto the three database columns. Return these fields from every Project and
Initiative serializer:

```typescript
startDateResolution: row.startDateResolution,
startDateFiscalYearStartMonth: row.startDateFiscalYearStartMonth,
targetDateResolution: row.targetDateResolution,
targetDateFiscalYearStartMonth: row.targetDateFiscalYearStartMonth,
```

Keep Project range validation after normalization so it compares canonical anchors.

- [x] **Step 6: Add the fiscal setting to the existing work-structure routes**

```typescript
const rows = await db.select({
  initiativeMaxDepth: organization.initiativeMaxDepth,
  estimationScale: organization.estimationScale,
  fiscalYearStartMonth: organization.fiscalYearStartMonth,
});
```

The update transaction changes only the organization row. It never rewrites a Project or
Initiative. Extend the route description with that stability rule.

- [x] **Step 7: Run the focused API gates**

Run: `pnpm --filter @docket/api test -- tests/lib/planning-timeframe.test.ts tests/routes/projects-detail.test.ts tests/routes/initiatives-detail.test.ts tests/routes/work-structure-timeframes.test.ts && pnpm --filter @docket/api typecheck`

Expected: PASS.

- [x] **Step 8: Commit the API slice**

Commit type/scope: `feat(projects)` with a body that explains atomic pairs, old-client behavior,
and the no-rewrite fiscal setting.

### Task 4: Preserve timeframe meaning through Linear sync and machine surfaces

**Files:**

- Modify: `packages/integrations/src/work-graph.ts`
- Modify: `packages/integrations/src/linear.ts`
- Modify: `packages/integrations/src/fixtures.ts`
- Modify: `packages/integrations/tests/providers/linear.test.ts`
- Modify: `apps/api/src/routes/integration-reconcile-graph.ts`
- Modify: `apps/api/tests/routes/integration-reconcile-graph-appliers.test.ts`
- Modify: `apps/api/src/mcp/list-work.ts`
- Modify: `apps/api/src/mcp/update-tool.ts`
- Create: `apps/api/tests/mcp/planning-timeframes.test.ts`
- Modify: `apps/api/src/lib/export-collect.ts`
- Modify: `apps/api/tests/account/export.test.ts`

**Interfaces:**

- Linear project pulls include `startDateResolution` and `targetDateResolution` unchanged.
- Linear work-graph pulls include the source organization's fiscal start month.
- Reconciliation stamps the source Linear fiscal basis for imported broad values.
- MCP reads return date, resolution, and fiscal snapshot. MCP writes accept date plus resolution.
- Account exports retain every planning metadata column beside its date.

- [ ] **Step 1: Write failing Linear mapping tests**

```typescript
expect(
  toExternalProject({
    id: 'p1',
    name: 'Launch Ada',
    state: 'started',
    url: 'https://linear.app/acme/project/launch-ada',
    startDate: '2026-06-01',
    startDateResolution: 'month',
    targetDate: '2026-06-30',
    targetDateResolution: 'month',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }),
).toMatchObject({ startDateResolution: 'month', targetDateResolution: 'month' });
```

- [ ] **Step 2: Add resolution fields to the provider boundary and GraphQL query**

```typescript
export interface ExternalProject {
  readonly startDate?: string;
  readonly startDateResolution?: DateResolution;
  readonly targetDate?: string;
  readonly targetDateResolution?: DateResolution;
}

export interface WorkGraphSnapshot {
  readonly fiscalYearStartMonth?: number;
  // Existing users, labels, projects, cycles, and items fields remain unchanged.
}
```

Add `startDateResolution targetDateResolution` to `PROJECTS_QUERY`, the raw node, mapper, and mock
fixtures. Parse the values through `DateResolution` instead of casting provider text. Add an
organization query for `fiscalYearStartMonth` and return it on the work-graph snapshot.

- [ ] **Step 3: Write failing reconciliation tests for broad and precise Linear projects**

Assert that a broad imported target stores the resolution and Linear's source fiscal month, even
when Athena's workspace uses a different month. Assert that a later Linear exact-date payload
clears both fields. Assert that a Linear payload with a bad boundary fails the sync item instead of
shifting it.

- [ ] **Step 4: Extend `applyProject` through the shared patch builder**

```typescript
const start = externalPlanningDatePatch({
  date: ext.startDate,
  resolution: ext.startDateResolution,
  fiscalYearStartMonth: ctx.sourceFiscalYearStartMonth,
  edge: 'start',
});
const target = externalPlanningDatePatch({
  date: ext.targetDate,
  resolution: ext.targetDateResolution,
  fiscalYearStartMonth: ctx.sourceFiscalYearStartMonth,
  edge: 'target',
});
```

Load the source fiscal month once from `WorkGraphSnapshot` into `GraphApplyContext` rather than once
per Project. Fall back to Athena's workspace setting only for providers that omit source fiscal
metadata. Linear must never take that fallback.

- [ ] **Step 5: Write failing MCP read and update tests**

```typescript
expect(projectRow).toMatchObject({
  startDate: '2026-06-01',
  startDateResolution: 'month',
  targetDate: '2026-06-30',
  targetDateResolution: 'month',
});

await callUpdateTool({
  entity: 'project',
  id: projectId,
  set: { targetDate: '2026-09-30', targetDateResolution: 'quarter' },
});
```

- [ ] **Step 6: Add timeframe fields to MCP schemas and mutation dispatch**

Add `startDate`, `startDateResolution`, `targetDate`, and `targetDateResolution` where the entity
supports them. Use the same atomic route/service helper. Do not accept fiscal snapshot input.

- [ ] **Step 7: Lock export completeness**

Extend the account export fixture with one broad Project and Initiative. Assert that the exported
database rows contain the date, resolution, and fiscal snapshot. Do not replace semantic fields
with display labels in the machine-readable archive.

- [ ] **Step 8: Run integration, reconciliation, MCP, and export tests**

Run: `pnpm --filter @docket/integrations test -- tests/providers/linear.test.ts && pnpm --filter @docket/api test -- tests/routes/integration-reconcile-graph-appliers.test.ts tests/mcp/planning-timeframes.test.ts tests/account/export.test.ts && pnpm --filter @docket/integrations typecheck && pnpm --filter @docket/api typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the machine-surface slice**

Commit type/scope: `feat(projects)` with a body that explains Linear field pass-through and why all
machine-readable surfaces retain semantic metadata.

### Task 5: Build the shared timeframe pickers

**Files:**

- Create: `packages/ui/src/components/pickers/TimeframePicker.tsx`
- Create: `packages/ui/src/components/pickers/timeframe-options.ts`
- Modify: `packages/ui/src/components/pickers/index.ts`
- Modify: `packages/ui/src/components/index.ts`
- Create: `apps/web/tests/pickers/timeframe-picker-contract.test.tsx`
- Modify: `apps/web/tests/pickers/date-picker-inventory.test.ts`

**Interfaces:**

- `TimeframePicker` consumes a `PlanningTimeframe | null`, the current workspace fiscal month, an
  edge, and `onChange`.
- `TimeframeRangePicker` composes two `TimeframePicker` instances and enforces anchor order.
- `Specific date` delegates to the existing `CalendarGrid` contract.

- [ ] **Step 1: Write failing picker-contract tests**

```tsx
render(
  <TimeframePicker
    label="Target date"
    value={null}
    fiscalYearStartMonth={0}
    edge="target"
    onChange={onChange}
  />,
);

await user.click(screen.getByRole('button', { name: 'Set target date' }));
expect(screen.getByRole('option', { name: 'Month' })).toBeVisible();
expect(screen.getByRole('option', { name: 'Quarter' })).toBeVisible();
expect(screen.getByRole('option', { name: 'Half-year' })).toBeVisible();
expect(screen.getByRole('option', { name: 'Year' })).toBeVisible();
expect(screen.getByRole('option', { name: 'Specific date' })).toBeVisible();
```

Add tests for Enter, arrow navigation, Escape without save, outside click, Clear, fiscal labels,
specific-day delegation, and the 1970 through 2200 bounds inherited from `CalendarGrid`.

- [ ] **Step 2: Run the picker test and verify the missing component fails**

Run: `pnpm --filter @docket/web test -- tests/pickers/timeframe-picker-contract.test.tsx`

Expected: FAIL because `TimeframePicker` does not exist.

- [ ] **Step 3: Implement pure option generation around the active period**

```typescript
export interface TimeframeOption {
  readonly date: string;
  readonly resolution: DateResolution;
  readonly fiscalYearStartMonth: number;
  readonly label: string;
}

export function nearbyTimeframeOptions(
  today: string,
  resolution: DateResolution,
  fiscalYearStartMonth: number,
  edge: TimeframeEdge,
): readonly TimeframeOption[];
```

Return the previous two, current, and next four periods. Previous and next controls shift that
window without changing the selected value.

- [ ] **Step 4: Implement `TimeframePicker` with one committed value**

```typescript
export interface TimeframePickerProps {
  readonly label: string;
  readonly value: PlanningTimeframe | null;
  readonly fiscalYearStartMonth: number;
  readonly edge: TimeframeEdge;
  readonly onChange: (value: PlanningTimeframe | null) => void;
  readonly disabled?: boolean;
}
```

Use `PropertyTrigger`, Radix Popover, roving option focus, and the existing `CalendarGrid`. Render
the semantic label from the value's saved snapshot. New broad selections use the current workspace
setting. Precise selections return a null resolution and null snapshot.

- [ ] **Step 5: Implement `TimeframeRangePicker`**

```typescript
export interface TimeframeRangeValue {
  readonly start: PlanningTimeframe | null;
  readonly target: PlanningTimeframe | null;
}
```

Reject a change when both anchors exist and `start.date > target.date`. Render application-owned
copy: `Start must be on or before target.` The two fields may use different resolutions.

- [ ] **Step 6: Export the pickers and lock the inventory boundary**

Update the inventory test so Project start/target and Initiative target are the only broad planning
surfaces. Assert that Task, Milestone, and Cycle files still use the exact-day picker.

- [ ] **Step 7: Run picker, UI type, and accessibility gates**

Run: `pnpm --filter @docket/web test -- tests/pickers/timeframe-picker-contract.test.tsx tests/pickers/date-picker-contract.test.tsx tests/pickers/date-picker-inventory.test.ts && pnpm --filter @docket/ui typecheck && pnpm --filter @docket/ui lint`

Expected: PASS.

- [ ] **Step 8: Commit the picker slice**

Commit type/scope: `feat(projects)` with a body that explains why broad planning composes the exact
calendar instead of changing it.

### Task 6: Add the fiscal setting and Project timeframe surfaces

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/settings/work-structure/page.tsx`
- Create: `apps/web/tests/components/settings/work-structure-timeframes.test.tsx`
- Modify: `apps/web/src/components/projects/project-form-pickers.tsx`
- Modify: `apps/web/src/components/projects/create-project.tsx`
- Modify: `apps/web/src/components/project-detail/properties-panel.tsx`
- Modify: `apps/web/src/lib/use-project-mutations.ts`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx`
- Modify: `apps/web/src/components/projects/project-catalog.ts`
- Modify: `apps/web/tests/composers/create-project.test.tsx`
- Modify: `apps/web/tests/components/project-detail/project-properties-panel.test.tsx`
- Modify: `apps/web/tests/components/projects/projects-experience-contract.test.ts`
- Create: `apps/web/tests/components/projects/project-timeframe-catalog.test.ts`

**Interfaces:**

- Work structure exposes a month selector that patches `fiscalYearStartMonth`.
- Project create and detail send each date and resolution together.
- Project rows display semantic target labels and group/filter on semantic timeframe keys.

- [ ] **Step 1: Write failing workspace-setting tests**

```tsx
expect(screen.getByLabelText('Fiscal year starts')).toHaveValue('0');
await user.selectOptions(screen.getByLabelText('Fiscal year starts'), '6');
expect(patch).toHaveBeenCalledWith({ fiscalYearStartMonth: 6 });
expect(screen.getByText(/new project and initiative timeframes/i)).toBeVisible();
```

- [ ] **Step 2: Add the month selector through the typed settings mutation**

Use month values `0` through `11` and localized month names. The supporting copy must state:
`This changes new Project and Initiative quarters, halves, and years. Saved timeframes do not move.`

- [ ] **Step 3: Write failing Project create and detail tests**

```tsx
await chooseTimeframe('Project start', 'Quarter', 'Q3 2026');
await chooseTimeframe('Project target', 'Month', 'December 2026');
expect(createProject).toHaveBeenCalledWith(
  expect.objectContaining({
    startDate: '2026-07-01',
    startDateResolution: 'quarter',
    targetDate: '2026-12-31',
    targetDateResolution: 'month',
  }),
);
```

Assert that detail updates invalidate the same query keys as exact updates. Assert that choosing a
specific date sends a null resolution. Assert that clear sends null for both fields.

- [ ] **Step 4: Replace Project date controls and mutation payloads**

Build values from `ProjectOut`:

```typescript
const target = project.targetDate
  ? {
      date: project.targetDate.slice(0, 10),
      resolution: project.targetDateResolution ?? null,
      fiscalYearStartMonth: project.targetDateFiscalYearStartMonth ?? null,
    }
  : null;
```

The create composer reads the current workspace setting. The detail panel uses the saved fiscal
snapshot for labels and the current setting for new selections.

- [ ] **Step 5: Write failing Project catalog tests for semantic display and grouping**

```typescript
expect(formatProjectTarget(monthProject)).toBe('June 2026');
expect(targetTimeframeKey(monthProject)).toBe('2026-06-30|month|0');
expect(targetTimeframeKey(exactProject)).toBe('2026-06-17|day');
```

Create catalog options from the loaded Project rows. Group broad values by `timeframeKey`. Keep
chronological sorting on the canonical target anchor. Keep the existing target-date before/after
filter for exact range comparisons and add a semantic `Target timeframe` enum filter for saved
periods.

- [ ] **Step 6: Update Project list and timeline copy**

Use `timeframeLabel` in the target column and any accessible timeline span copy. Keep timeline
geometry on `startDate` and `targetDate`. A broad month target must display `June 2026`, not
`Jun 30`.

- [ ] **Step 7: Run the focused Project and settings tests**

Run: `pnpm --filter @docket/web test -- tests/components/settings/work-structure-timeframes.test.tsx tests/composers/create-project.test.tsx tests/components/project-detail/project-properties-panel.test.tsx tests/components/projects/projects-experience-contract.test.ts tests/components/projects/project-timeframe-catalog.test.ts tests/timeline && pnpm --filter @docket/web typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the Project and setting slice**

Commit type/scope: `feat(projects)` with a body that explains the user-visible choices, saved label
stability, and unchanged timeline anchors.

### Task 7: Add Initiative timeframe surfaces and semantic readers

**Files:**

- Modify: `apps/web/src/components/initiatives/initiative-form-pickers.tsx`
- Modify: `apps/web/src/components/initiatives/create-initiative.tsx`
- Modify: `apps/web/src/components/initiatives/properties-panel.tsx`
- Modify: `apps/web/src/lib/use-initiative-mutations.ts`
- Modify: `apps/web/src/components/initiatives/format-date.ts`
- Modify: `apps/web/src/components/initiatives/initiative-catalog.ts`
- Modify: `apps/web/src/components/initiatives/roadmap.tsx`
- Modify: `packages/types/src/initiative.ts`
- Modify: `apps/api/src/routes/initiatives.ts`
- Modify: `apps/web/tests/composers/create-initiative.test.tsx`
- Create: `apps/web/tests/components/initiatives/initiative-timeframes.test.tsx`
- Modify: `apps/api/src/search/projectors/work.ts`
- Modify: `apps/api/tests/search/projectors-work.test.ts`
- Modify: `apps/api/src/mcp/resource-work-hydrators.ts`
- Create: `apps/api/tests/mcp/timeframe-resources.test.ts`

**Interfaces:**

- Initiative create and detail use `TimeframePicker` for target only.
- Initiative list and roadmap show semantic Initiative and Project timeframe labels.
- Search facets and MCP resources carry the target resolution and saved fiscal basis.

- [ ] **Step 1: Write failing Initiative picker and mutation tests**

```tsx
await chooseTimeframe('Initiative target', 'Half-year', 'H2 2026');
expect(updateInitiative).toHaveBeenCalledWith(
  expect.objectContaining({
    targetDate: '2026-12-31',
    targetDateResolution: 'halfYear',
  }),
);
```

Cover create, detail update, specific date, clear, Escape, and rendering an old fiscal snapshot.

- [ ] **Step 2: Replace the Initiative target controls and mutation payloads**

Construct `PlanningTimeframe` from the three output fields. Use the current workspace fiscal month
only for a new selection. Send `targetDate` and `targetDateResolution` together.

- [ ] **Step 3: Update Initiative list and roadmap labels**

Change `formatDate` or add `formatPlanningDate` with this signature:

```typescript
export function formatPlanningDate(
  date: string | null,
  resolution: DateResolution | null,
  fiscalYearStartMonth: number | null,
): string | null;
```

Pass all three Initiative fields to roadmap marker titles and accessible names. Extend
`InitiativeTimelineBar` and the timeline route with each Project bar's start and target resolution
plus fiscal snapshot. Use them for semantic bar span copy. Keep all marker and bar placement on the
canonical anchors.

- [ ] **Step 4: Add semantic Initiative grouping and filtering**

Add a `Target timeframe` field to `initiative-catalog.ts`. Use the same `timeframeKey`, label, and
chronological rank as Projects. Build filter options from the loaded rows so the list never offers
empty periods.

- [ ] **Step 5: Preserve metadata in search and MCP resources**

Add these fields to Project and Initiative search facets and MCP resource payloads:

```typescript
targetDate: row.targetDate?.toISOString().slice(0, 10) ?? null,
targetDateResolution: row.targetDateResolution,
targetDateFiscalYearStartMonth: row.targetDateFiscalYearStartMonth,
```

Project resources also carry the corresponding start fields. Human-readable summaries use
`timeframeLabel`; machine fields retain the raw values.

- [ ] **Step 6: Run focused Initiative, search, MCP, and roadmap tests**

Run: `pnpm --filter @docket/web test -- tests/composers/create-initiative.test.tsx tests/components/initiatives/initiative-timeframes.test.tsx && pnpm --filter @docket/api test -- tests/search/projectors-work.test.ts tests/mcp/timeframe-resources.test.ts && pnpm --filter @docket/web typecheck && pnpm --filter @docket/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the Initiative and semantic-reader slice**

Commit type/scope: `feat(projects)` with a body that explains semantic labels and unchanged roadmap
geometry.

### Task 8: Validate the complete behavior and document the result

**Files:**

- Create: `apps/web/e2e/work/planning-timeframes.spec.ts`
- Modify: `docs/design/audits/inventories/date-pickers.md`
- Create: `docs/design/audits/2026-08-20-planning-timeframes.md`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Exercises workspace fiscal settings, Project create/detail/list/timeline, and Initiative
  create/detail/roadmap through the real app.
- Produces desktop/mobile light/dark evidence and a Docket craft scorecard.

- [ ] **Step 1: Add the authenticated end-to-end journey**

```typescript
test('saved planning timeframes retain their fiscal basis', async ({ page }) => {
  await setFiscalStart(page, 'July');
  await createProjectWithTimeframes(page, { start: 'Q1 FY 2027', target: 'H2 FY 2027' });
  await setFiscalStart(page, 'January');
  await openCreatedProject(page);
  await expect(page.getByRole('button', { name: /Q1 FY 2027/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /H2 FY 2027/ })).toBeVisible();
});
```

Also cover a precise date, a month, clear, Project range rejection, Initiative target, semantic
grouping, timeline placement, and a Linear-import fixture with resolution fields.

- [ ] **Step 2: Run the focused package tests serially**

Run: `pnpm --filter @docket/work test -- --maxWorkers=2 && pnpm --filter @docket/types test -- --maxWorkers=2 && pnpm --filter @docket/db test -- --maxWorkers=2 && pnpm --filter @docket/integrations test -- --maxWorkers=2 && pnpm --filter @docket/api test -- tests/lib/planning-timeframe.test.ts tests/routes/projects-detail.test.ts tests/routes/initiatives-detail.test.ts tests/routes/work-structure-timeframes.test.ts tests/routes/integration-reconcile-graph-appliers.test.ts tests/mcp/planning-timeframes.test.ts tests/mcp/timeframe-resources.test.ts tests/account/export.test.ts --maxWorkers=2 && pnpm --filter @docket/web test -- tests/pickers tests/composers/create-project.test.tsx tests/composers/create-initiative.test.tsx tests/components/project-detail/project-properties-panel.test.tsx tests/components/projects/project-timeframe-catalog.test.ts tests/components/initiatives/initiative-timeframes.test.tsx --maxWorkers=2`

Expected: PASS without skipped tests.

- [ ] **Step 3: Run the authenticated Playwright journey**

Run: `pnpm --filter @docket/web test:e2e -- e2e/work/planning-timeframes.spec.ts --workers=1`

Expected: PASS.

- [ ] **Step 4: Run repository validation with bounded concurrency**

Run `~/.claude/resource-limits/agentctl status` first. If the process forest is below its ceiling,
run these commands serially:

```bash
TURBO_CONCURRENCY=2 pnpm typecheck
TURBO_CONCURRENCY=2 pnpm lint
TURBO_CONCURRENCY=2 pnpm test
TURBO_CONCURRENCY=2 pnpm build
```

Expected: All four commands pass. Do not rerun an exit 137 unchanged.

- [ ] **Step 5: Run the design review and capture evidence**

Capture Project create, Project detail, Project list grouping, Initiative create, and Initiative
detail at 1440 by 900 and 390 by 844 in both themes. Check 320-pixel overflow, keyboard navigation,
Escape behavior, focus return, and accessible semantic labels. Record the eight-dimension score
and screenshot paths in `docs/design/audits/2026-08-20-planning-timeframes.md`.

- [ ] **Step 6: Close the worklog with evidence and retrospective**

Move `TIMEFRAME-001` to completed. Record exact test commands, the migration number, design-review
score, any baseline failures, and the fact that existing date rows migrated as precise values.
Record what changed in the approach and what maintainers should reuse.

- [ ] **Step 7: Verify history and commit the closeout**

Run: `git diff --check && git rev-list --merges --count origin/main..HEAD && git status --short`

Expected: no whitespace errors, `0` merge commits, and only owned validation artifacts staged.

Commit type/scope: `feat(projects)` with a body that explains the end-to-end evidence and any
explicitly documented baseline limitation.

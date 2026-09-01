# Task 7 report: Remove the remaining manual roster grids

Task 7 now routes Team and Cycle rosters through `EntityTable`. The shared table owns headers,
column sizing, responsive visibility, scrolling, row height, and row chrome. Each domain module
still owns its identity, metadata, links, accessible names, and object surface.

## RED evidence

The focused RED command was:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/entity-table-ownership.test.ts \
  tests/components/teams/team-list-ui.test.tsx \
  tests/cycles/cycles-list.test.tsx \
  --maxWorkers=1
```

It exited 1 with 5 failed and 13 passed tests. The ownership scan found manual column headers in
Team and Cycle. Team did not import `EntityTable`. Team headers had no shared `data-col` keys.
Team and Cycle also exposed row-role anchors rather than separate link roles. The final adapters
preserve the row-level anchor contract while the other failures turn green.

## Implementation

Team uses one `Column<TeamRow>[]` sequence for Team, States, Projects, and Tasks. Tasks reveal at
priority 1, Projects at priority 2, and workflow States at priority 3. The identity column remains
the 22rem flex column. The row keeps its Team object surface, full-row destination, workflow count,
Project and Task nouns, and Triage badge.

Cycle uses one `Column<CycleRowProps>[]` sequence for Cycle, Status, Progress, and Points. Status
reveals at priority 1, Progress at priority 2, and Points at priority 3. The identity column remains
the 22rem flex column. The row keeps its Cycle object surface, full-row destination, prefetch
handler, inline rename control, team subtitle, status badge, progress values, and points or
carryover content.

`roster-grid.ts` and its source-string contract test are deleted. `ProgramRows` has no production
or test caller. The named `program-list-ui.tsx` file was already absent at base `6cce0a174`, so this
slice did not recreate or modify dead Program row code. Program card rendering remains in the
existing work-card implementation.

The new ownership policy recursively scans `apps/web/src` for quoted or JSX-expression
`columnheader` roles. It also requires Team, Cycle, and WorkList to import `EntityTable`. The policy
does not assert Tailwind utility strings.

The required Project contract test contained three stale checks for the pre-Task-5 `ListView`
implementation. Those checks now follow the current boundaries: WorkViewPage passes grouped pages,
WorkList builds the EntityTable roster at the resolved density height, and `work-list-columns.tsx`
owns target-derived property selection.

## Validation

The final affected-test command passed 31 of 31 tests across four files:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/entity-table-ownership.test.ts \
  tests/components/teams/team-list-ui.test.tsx \
  tests/cycles/cycles-list.test.tsx \
  tests/components/projects/projects-experience-contract.test.ts \
  --maxWorkers=1
```

`pnpm --filter @docket/web typecheck` exited 0. Targeted ESLint over every changed source and test
file exited 0. `git diff --check` exited 0. `git rev-list --merges --count origin/main..HEAD`
printed `0`. `origin` remains the SSH remote.

## Self-review

The review confirmed that application production code contains no owned `columnheader` role and no
roster-grid helper import. Team and Cycle keep real row-level `href` values and object identity data.
The Cycle adapter delegates native link activation to the row instead of also invoking its router
callback. This avoids two navigation requests for one click. The root-owned `docs/WORKLOG.md` and
shared implementation plan remain unstaged.

Task 8 owns the authenticated screenshot matrix and narrow-width browser geometry checks. Task 7
does not start a second visual-verification path.

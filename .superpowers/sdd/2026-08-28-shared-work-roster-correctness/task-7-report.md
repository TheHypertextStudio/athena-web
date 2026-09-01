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

The ownership policy now runs as the `docket-ui/no-app-owned-columnheader` ESLint rule across
`apps/web/src`. The rule rejects direct literals, identifier expressions, template literals,
object spreads, `React.createElement`, and bare `createElement` props. The shared UI package remains
outside the application-only policy. The ownership gate uses ESLint's AST walker and separately
requires an actual `EntityTable` JSX node in Team, Cycle, and WorkList, so a dead import cannot pass.

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

## Review fix round 1

The rule-level TDD cycle first failed because the shared plugin did not export the ownership rule.
After the minimal export passed, eight bypass fixtures failed against the no-op rule. The completed
AST rule passed all 31 rule tests. The replacement web ownership gate then failed because the root
lint config did not compose the new policy. It passed all 3 tests after the application-only config
was added.

The two-file ESLint run over the changed tests emitted no findings but did not finish within the
review cutoff. It was interrupted after about 90 seconds. This round therefore does not claim that
command passed. The rule-level suite and replacement ownership gate both completed successfully.

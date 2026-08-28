# Shared Work Roster Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> **Reader:** The engineer who executes this plan and the reviewer who decides whether the exact
> commit may deploy. Complete the tasks in order. Do not deploy until Task 9 passes.

**Goal:** Make every column-aligned work roster use one responsive layout, return complete
Initiative hierarchy context, refresh immediately after writes, and block deployment when the
rendered user journey breaks.

**Architecture:** Extend the existing `@docket/ui` `EntityTable` instead of adding another roster
component. Keep one column definition, header, scrollport, group flattener, and virtual row model.
Page direct Initiative matches before adding authorized context. Nest roster cache keys below their
entity collections, and invalidate cross-workspace target projections through one helper. Keep
page state, errors, selection, and permissions with the operation or surface that owns them.

**Tech Stack:** TypeScript 5, React 19, TanStack Query, TanStack Virtual, Zod, Hono, Drizzle/Postgres,
Tailwind container queries, Testing Library, Vitest, Playwright, and GitHub Actions.

**Design:** `docs/superpowers/specs/2026-08-28-shared-work-roster-correctness-design.md`

## Non-negotiable contracts

- `EntityTable` remains the only column-header owner for application rosters.
- `EntityTable` remains the only focus and keyboard-navigation owner for table presentations.
- A flex identity column keeps a 22rem preferred floor and uses the available row content width
  below 376px.
- Header and row cells use the same `Column<T>[]`, size function, padding, gap, visibility rule,
  and scrollport.
- Initiative page limits and cursors count direct matches. Ancestor context is added afterward.
- A direct Initiative with an unreadable ancestor is excluded before counts, paging, and cursors.
- `totalCount` and group counts never include context rows.
- Only an initial roster failure with no cached rows can replace the roster.
- Context rows are navigable but cannot enter selection, drag payloads, writes, or direct counts.
- Foreign-owned direct rows remain keyboard-navigable and keep their single-row Open and Copy link
  actions. They cannot enter bulk selection, writes, or drag in a route workspace. Navigation uses
  the row owner.
- Saved-view density determines rendered, virtualized, and rail geometry from one height map.
- Same-workspace collection ancestry and cross-workspace target invalidation refresh every cached
  projection affected by a write.
- Existing `EntityTable` callers retain their behavior unless a task explicitly migrates them.
- No database migration or work-view response migration is part of this change.
- The exact production candidate must pass the required release browser suite before deployment.

---

### Task 1: Unify target cache ownership and cross-workspace invalidation

**Files:**

- Modify: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/lib/work-target-invalidation.ts`
- Modify: `apps/web/src/lib/use-initiative-mutations.ts`
- Modify: `apps/web/src/components/initiatives/create-initiative.tsx`
- Modify: `apps/web/src/components/initiatives/initiative-actions.ts`
- Modify: `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx`
- Modify:
  `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx`
- Modify: `apps/web/src/components/projects/create-project.tsx`
- Modify: `apps/web/src/lib/use-project-mutations.ts`
- Modify: `apps/web/src/components/labels/queries.ts`
- Modify: `apps/web/src/components/statuses/queries.ts`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/settings/work-structure/page.tsx`
- Modify: `apps/web/src/components/work-views/use-work-view-order.ts`
- Modify: `apps/web/src/components/work-views/use-project-timeline-mutations.ts`
- Create: `apps/web/tests/lib/query-keys.test.ts`
- Create: `apps/web/tests/lib/work-target-invalidation.test.ts`
- Modify: `apps/web/tests/lib/use-initiative-mutations.test.ts`
- Modify: `apps/web/tests/lib/use-project-mutations.test.ts`
- Modify: `apps/web/tests/components/initiatives/initiative-actions.test.tsx`
- Modify: `apps/web/tests/composers/create-initiative.test.tsx`
- Modify: `apps/web/tests/composers/create-project.test.tsx`
- Create: `apps/web/tests/lib/work-metadata-invalidation.test.tsx`
- Modify: `docs/engineering/specs/data-layer.md`

**Interfaces:**

- Add a typed target-to-collection prefix helper that maps `task`, `project`, `program`, and
  `initiative` to the existing collection key builders.
- Make `queryKeys.workView(...)` and `queryKeys.workViewFacets(...)` descendants of that prefix.
- Add `invalidateWorkTargetQueries(queryClient, { target, ownerOrganizationId })`. It invalidates
  the owner's collection plus every cached roster and facet for that target across route
  organizations. It returns the active-refetch promise and does not invalidate another target.
- Route Initiative create, patch, delete, status, label, display, relation, hierarchy, order, and
  contributing-Project mutations through that helper.
- Make label and status metadata writes call the helper once for every target whose rendered rows
  can change.
- Remove raw `['org', organizationId, 'work-view']` invalidation arrays and scattered Initiative
  cache-family lists.

- [ ] **Step 1: Write the failing key-ancestry tests**

  Construct one roster key and one facet key for each target. Assert that each starts with its
  collection prefix. Assert that an Initiative key does not start with the Projects prefix.

  ```typescript
  expect(queryKeys.workView(orgId, 'initiative', instance, request, timezone)).toEqual([
    ...queryKeys.initiatives(orgId),
    'work-view',
    'initiative',
    instance,
    timezone,
    request,
  ]);
  ```

- [ ] **Step 2: Prove collection invalidation reaches the mounted cache family**

  Use a real `QueryClient`. Seed Initiative overview, work-view, facet, and Project work-view data.
  Subscribe to the Initiative roster and facet queries. Invalidate `queryKeys.initiatives(orgId)`.
  Assert that the Initiative queries become invalid and refetch while the Project work view stays
  valid.

- [ ] **Step 3: Prove cross-workspace target invalidation**

  Use a real `QueryClient`. Seed an Initiative owned by workspace B into a mounted Initiative
  work-view and facet under route workspace A. Subscribe to those queries and the owner's
  Initiative overview with real query functions and call counters. Seed and subscribe to a Project
  work view under A. Await `invalidateWorkTargetQueries` for B and `initiative`. Assert exactly one
  immediate refetch for A's Initiative roster, A's Initiative facet, and B's Initiative overview.
  Assert zero Project refetches.

- [ ] **Step 4: Prove every Initiative mutation family uses the helper**

  Extend the mutation tests with a real `QueryClient` or narrow injected spy. Cover create, patch,
  delete, status, label, display, relation, hierarchy, order, and contributing-Project paths. Assert
  that each passes the mutated target and owner organization to the helper after the write settles.
  Product controls must start the returned promise without waiting for the refetch to clear their
  pending state.

- [ ] **Step 5: Run the focused tests and verify the old ownership model fails**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/lib/query-keys.test.ts \
    tests/lib/work-target-invalidation.test.ts \
    tests/lib/use-initiative-mutations.test.ts \
    tests/lib/use-project-mutations.test.ts \
    tests/lib/work-metadata-invalidation.test.tsx \
    tests/components/initiatives/initiative-actions.test.tsx \
    tests/composers/create-initiative.test.tsx \
    tests/composers/create-project.test.tsx \
    --maxWorkers=1
  ```

- [ ] **Step 6: Implement the key builder and the centralized invalidation helper**

  Keep the first three tuple members identical to the relevant collection key. Inspect cached
  query keys through the typed target segment so one helper can invalidate every matching route
  workspace without enumerating mounted organizations. Route ordering, Initiative mutation, and
  Project timeline mutations through the helper.

- [ ] **Step 7: Document both invalidation boundaries**

  Add one concrete Initiative example to `data-layer.md`. State that every derived roster and facet
  read belongs below its route entity collection. State that writes also use the centralized target
  helper because a foreign-owned Initiative can appear as context in another route workspace.

- [ ] **Step 8: Run focused tests, web typecheck, and lint**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/lib/query-keys.test.ts \
    tests/lib/work-target-invalidation.test.ts \
    tests/lib/use-initiative-mutations.test.ts \
    tests/lib/use-project-mutations.test.ts \
    tests/lib/work-metadata-invalidation.test.tsx \
    tests/components/initiatives/initiative-actions.test.tsx \
    tests/composers/create-initiative.test.tsx \
    tests/composers/create-project.test.tsx \
    --maxWorkers=1
  pnpm --filter @docket/web typecheck
  pnpm --filter @docket/web lint
  ```

- [ ] **Step 9: Commit the cache-ownership slice**

  Commit as `fix(web): Refresh work rosters with their entity collections`. The body must explain
  why collection ancestry handles local reads and one target-scoped helper handles foreign-owned
  rows in cross-workspace projections.

### Task 2: Page direct Initiative matches before adding context

**Files:**

- Modify: `apps/api/src/lib/work-views/query.ts`
- Modify: `apps/api/src/lib/work-views/context-sql.ts`
- Modify: `apps/api/tests/work-views/query.test.ts`
- Modify: `apps/api/tests/work-views/query-plan.test.ts`
- Modify: `apps/api/tests/work-views/performance.test.ts`
- Modify: `apps/api/tests/routes/work-views.test.ts`
- Modify: `packages/types/src/work-view.ts`

**Interfaces:**

- Preserve `WorkViewQueryResponse` and `InitiativeViewRow.isContext`.
- Apply `limit + 1`, keyset filtering, and cursor creation to direct rows.
- Seed the authorized recursive ancestor closure from the selected direct page.
- Treat a direct row as presentable only when the caller can read its complete ancestor chain.
- Permit `response.rows.length > request.limit` only when the extra rows have `isContext: true`.

- [ ] **Step 1: Add the failing ungrouped page tests**

  First seed one root and one matching child whose parent sorts after it. Query with `limit: 1` and
  assert that the response contains both rows with a null cursor. Then seed a second matching child.
  Assert that page one contains the root context plus child A, page two contains the root context
  plus child B, and the direct-row union is exactly A and B. Assert that `totalCount` is two and each
  non-null cursor is derived from a child.

- [ ] **Step 2: Add the failing grouped and authorization tests**

  Query a child through a group path whose parent does not match the group. Assert that the parent
  returns as context, the group count remains one, and the child never appears without the complete
  authorized ancestor chain. Make the parent unreadable in a second case. Assert that the API
  excludes the child before `totalCount`, group counts, paging, and cursor creation. Assert that the
  response contains neither the child, the parent id, nor a dangling `parentLinkId`. Assert that the
  API does not present the child as a fake root. Add a readable child whose parent link exists but
  whose parent row fails the authorization join. Assert that this missing join does not terminate
  the traversal as though the child were a real root.

- [ ] **Step 3: Add cursor isolation and duplicate-context cases**

  Assert that a cursor for one group path fails for another path. Put the same context parent above
  direct children in two groups and assert that each response contains its own context membership
  without inflating either count.

- [ ] **Step 4: Run the focused API tests and verify context consumes the old limit**

  Run:

  ```bash
  pnpm --filter @docket/api exec vitest run \
    tests/work-views/query.test.ts \
    tests/routes/work-views.test.ts \
    --maxWorkers=1
  ```

- [ ] **Step 5: Refactor the query CTE order**

  Build a presentable-direct CTE from authorized direct rows after group scope. Traverse hierarchy
  links in the requested context independently of the authorized row set. Treat only the absence of
  a parent link as a real root. Reject the direct child when any linked ancestor lacks an authorized
  row. Apply that rule before any count, keyset predicate, page limit, or cursor operation. Keep the
  direct lookahead separate from the rows projected to the response. Resolve ancestors from selected
  direct ids, union those context rows for projection, and create `nextCursor` from the last direct
  row.

- [ ] **Step 6: Preserve statement and query-plan bounds**

  Keep the work-view query at two SQL statements. Extend `query-plan.test.ts` to EXPLAIN the
  recursive page. Extend the performance fixture with a shared depth-three hierarchy so the
  benchmark measures context closure instead of a flat Initiative list.

- [ ] **Step 7: Clarify the request and response contract in TSDoc**

  Document near the work-view request limit and response schema that Initiative limits and cursors
  describe direct matches, while rows can contain additional authorized context.

- [ ] **Step 8: Run focused API validation**

  Run:

  ```bash
  pnpm --filter @docket/api exec vitest run \
    tests/work-views/query.test.ts \
    tests/work-views/query-plan.test.ts \
    tests/work-views/performance.test.ts \
    tests/routes/work-views.test.ts \
    --maxWorkers=1
  pnpm --filter @docket/api typecheck
  pnpm --filter @docket/types typecheck
  ```

- [ ] **Step 9: Commit the API correction**

  Commit as `fix(api): Keep Initiative context outside page limits`. The body must record the
  direct-row cursor invariant and the unchanged wire contract.

### Task 3: Harden `EntityTable` as the roster layout owner

**Files:**

- Modify: `packages/ui/src/components/views/entity-table-columns.ts`
- Create: `packages/ui/src/components/views/entity-table-groups.ts`
- Modify: `packages/ui/src/components/views/entity-table-row.tsx`
- Modify: `packages/ui/src/components/views/EntityTable.tsx`
- Modify: `packages/ui/src/components/views/GroupHeader.tsx`
- Modify: `packages/ui/src/hooks/useListKeyboard.tsx`
- Modify: `packages/ui/src/components/index.ts`
- Modify: `packages/ui/tests/components/views/entity-table.test.tsx`
- Modify: `packages/ui/tests/components/views/entity-table-virtual.test.tsx`

**Interfaces:**

- Extend `ColumnPriority` through the existing 1280px container tier while preserving priorities
  one through three.
- Make a flex column honor `minWidth`.
- Add nested `EntityTableGroup<T>` children, authoritative `count`, and typed `continuation`.
- Add the same typed continuation to the root table page. Keep existing `endAdornment` content as
  display-only backward compatibility.
- Make continuation a discriminated union. Idle and error states require `onActivate`. Loading
  forbids it and renders `aria-disabled="true"` plus `aria-busy="true"`.
- Add `tone`, `rowHeight`, `gridRole`, and `getRowAria` props with backward-compatible defaults.
- Flatten group, subgroup, row, and continuation entries through one pure function.
- Keep `EntityTable` as the sole active-entry and keyboard owner. Expose typed callbacks for active
  entry changes and selection commands, including Shift extension, toggle, select all, and clear.
- Add `getRowSelectionKey(row): string | undefined`, `selectionAnchorKey`, and
  `onSelectionCommand`. Each command includes its command kind, active flattened-entry key, target
  selection key, current anchor key, ordered eligible keys, and pointer modifiers. The table derives
  eligible order from flattened rows. The application never reconstructs it.

- [ ] **Step 1: Write failing flex-minimum and responsive-priority tests**

  Assert that a flex column with `minWidth: '22rem'` emits that minimum in the header and every row.
  Assert that each priority returns the expected container class and that header/cell visibility
  uses the same helper.

- [ ] **Step 2: Write failing nested-group tests**

  Render two server-ordered parent groups, one subgroup, duplicate row ids in different paths, and
  explicit counts larger than the loaded row arrays. Assert full-path keys, server order, group
  nesting, count labels, independent collapse state, and one visible continuation button with a
  stable id, visible application-owned label, and valid gridcell semantics. Assert that idle and
  error continuations activate through Enter. Assert that a loading continuation is disabled and
  busy and that pointer or Enter activation cannot start a duplicate request. Repeat the contract
  for the ungrouped root continuation.

- [ ] **Step 3: Write failing virtual-row tests**

  Assert that nested headers and continuations contribute to virtual count and keyboard indexing.
  Navigate across group headers, subgroups, data rows, and continuations. Assert that Shift reaches
  the selection-extension callback with only selectable data-row keys in flattened order. Assert
  that headers, continuations, and rows whose key resolver returns `undefined` never join a range.
  Assert that Space, Command/Ctrl+A, and Escape reach the toggle, select-all, and clear callbacks
  with the active key, target key, anchor key, ordered eligible keys, and modifiers. Assert that the
  grid has exactly one active descendant and that data rows do not install a second roving DOM focus
  model. Set `rowHeight={56}` and assert that the virtualizer estimate and rendered row variable
  agree. Scroll rows and assert that the header remains inside and sticky to the one scrollport.

- [ ] **Step 4: Write failing treegrid and tone tests**

  Render `gridRole="treegrid"` with row metadata. Assert `aria-level`, `aria-posinset`,
  `aria-setsize`, and `aria-expanded`. Assert that the default tone remains outlined and the tonal
  tone uses the work-roster surface without adding a second wrapper.

- [ ] **Step 5: Run the UI tests and verify the missing contracts fail**

  Run:

  ```bash
  pnpm --filter @docket/ui exec vitest run \
    tests/components/views/entity-table.test.tsx \
    tests/components/views/entity-table-virtual.test.tsx \
    --maxWorkers=1
  ```

- [ ] **Step 6: Implement the column and group helpers**

  Keep size and visibility logic in `entity-table-columns.ts`. Put public group types and the pure
  recursive flattener in `entity-table-groups.ts`. Use encoded full paths for flattened keys. Model
  root and group continuation as typed flattened entries instead of arbitrary adornment nodes. Do
  not attach an activation handler to the loading variant.

- [ ] **Step 7: Implement one scrollport and shared row semantics**

  Keep the header, rowgroup, virtual rows, and group tails under the `EntityTable` scroll element.
  Make the header sticky. Pass row tone, height, and ARIA metadata through `entity-table-row.tsx`.
  Extend `useListKeyboard` so `EntityTable` owns one flattened active-entry index and dispatches
  selection commands through callbacks. Do not add a feature-specific Initiative or app selection
  import to `@docket/ui`.

- [ ] **Step 8: Run UI validation and public export checks**

  Run:

  ```bash
  pnpm --filter @docket/ui exec vitest run \
    tests/components/views/entity-table.test.tsx \
    tests/components/views/entity-table-virtual.test.tsx \
    --maxWorkers=1
  pnpm --filter @docket/ui typecheck
  pnpm --filter @docket/ui lint
  ```

- [ ] **Step 9: Commit the shared component slice**

  Commit as `fix(ui): Keep roster columns aligned across widths`. The body must name the single
  scrollport, single keyboard owner, and flex-minimum invariants. It must state that existing callers
  keep their defaults.

### Task 4: Give every page and error an explicit owner

**Files:**

- Create: `apps/web/src/components/work-views/use-work-view-pages.ts`
- Create: `apps/web/tests/work-views/work-view-pages.test.ts`
- Modify: `apps/web/src/components/work-views/use-work-view.ts`
- Modify: `apps/web/src/components/work-views/renderer-types.ts`
- Modify: `apps/web/src/components/work-views/filter-builder.tsx`
- Modify: `apps/web/src/components/work-views/work-view-page.tsx`
- Modify: `apps/web/src/components/work-views/work-view-load-failure.tsx`
- Modify: `apps/web/tests/work-views/work-view-controller-hook.test.tsx`
- Modify: `apps/web/tests/work-views/work-view-load-failure.test.tsx`

**Interfaces:**

- Key group pages by `workViewGroupPathKey(path)`.
- Add per-path `loading`, `error`, `nextCursor`, and retry input.
- Split controller errors into initial, root continuation, group continuation, facet, preferences,
  save, default, and saved-view-list owners.
- Derive group display order from `response.groups`.

- [ ] **Step 1: Write reducer tests for path-keyed state**

  Resolve B before A and assert that state lookup remains path-based. Append page two to A without
  duplicates. Fail page two and assert that page-one rows and the failed cursor remain available.
  Retry A and assert that B does not change.

- [ ] **Step 2: Write hook tests for canonical group order**

  Return group summaries in A, B order. Resolve B's request first. Assert that the controller still
  exposes A, B. Repeat with nested groups and duplicate context ids.

- [ ] **Step 3: Write failure-ownership tests**

  Cover initial roster, root continuation, group continuation, facet, preference, save, default,
  and saved-view-list failures. Assert that only the first failure with no cached rows renders
  `WorkViewLoadFailure`. Assert that every local retry repeats the request that failed.

- [ ] **Step 4: Run focused tests and verify the combined `error` field fails them**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/work-views/work-view-pages.test.ts \
    tests/work-views/work-view-controller-hook.test.tsx \
    tests/work-views/work-view-load-failure.test.tsx \
    --maxWorkers=1
  ```

- [ ] **Step 5: Extract page state from `use-work-view.ts`**

  Move root and group continuation transitions into the tested module. Store each path in place
  rather than filtering and re-appending it. Merge rows by id within that path only.

- [ ] **Step 6: Route each error to its surface**

  Keep cached rows visible during refetch and continuation failures. Put facet failure and retry in
  the filter builder. Keep failed save input in the open dialog. Show saved-view-list failure beside
  its tabs and retain cached tabs. Use application-owned copy.

- [ ] **Step 7: Run web validation**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/work-views/work-view-pages.test.ts \
    tests/work-views/work-view-controller-hook.test.tsx \
    tests/work-views/work-view-load-failure.test.tsx \
    --maxWorkers=1
  pnpm --filter @docket/web typecheck
  ```

- [ ] **Step 8: Commit the controller slice**

  Commit as `fix(web): Keep work-view failures with their operations`. The body must explain why
  loaded rows survive continuation and mutation failures.

### Task 5: Migrate `WorkList` and correct Initiative hierarchy geometry

**Files:**

- Create: `apps/web/src/components/work-views/work-list-columns.tsx`
- Create: `apps/web/src/components/work-views/work-list-groups.ts`
- Modify: `apps/web/src/components/work-views/work-list.tsx`
- Modify: `apps/web/src/components/work-views/initiative-rails.ts`
- Modify: `apps/web/src/components/work-views/work-view-page.tsx`
- Create: `apps/web/tests/work-views/work-list-columns.test.tsx`
- Create: `apps/web/tests/work-views/work-list-groups.test.ts`
- Modify: `apps/web/tests/work-views/work-list.test.tsx`
- Modify: `apps/web/tests/work-views/initiative-rails.test.ts`
- Remove assertions from: `apps/web/tests/components/initiative-visual-contract.test.ts`

**Interfaces:**

- Build `Column<ListMembership<TTarget>>[]` from numeric field widths and cumulative container
  requirements.
- Use one identity header/cell contract with
  `min(22rem, calc(100cqw - 1.5rem))`, a 32px leading slot, and a 12px gap.
- Use a 24px Initiative depth token inside that identity cell.
- Build nested `EntityTableGroup` values in server-summary order with server counts and per-path
  typed continuations.
- Resolve one work-roster row height from saved-view density. `compact` uses 44px, and
  `comfortable` uses 56px. Pass that value to `EntityTable`, row CSS, hierarchy rails, and geometry
  assertions.

- [ ] **Step 1: Write the failing column-policy tests**

  Select all supported Initiative properties. Assert the numeric width of each column, the
  cumulative priority assigned to it, monotonic visibility, and the responsive identity minimum.
  Assert that the header and root cell render the same leading spacer contract. At 320px, assert
  that the identity cell uses the available content width without table overflow when no metadata
  is visible. Assert that compact density resolves to 44px and comfortable density resolves to
  56px through the exported row-height map.

- [ ] **Step 2: Write the failing hierarchy counterexamples**

  Add `root A -> only child -> grandchild`, followed by root B. Assert that the grandchild's
  ancestor continuation is `[false]`. Add a final root whose first child has a grandchild and a
  later sibling. Assert that the grandchild's continuation is `[true]`. Change the current wrong
  expectation for the existing counterexample.

- [ ] **Step 3: Write path-specific and corrupt-cycle tests**

  Put one context ancestor in two groups. Assert independent positions and rails by full membership
  key. Seed a cycle and assert deterministic termination, one displayed root, and no depth-two
  root.

- [ ] **Step 4: Write grouped continuation and ARIA tests**

  Give a group a server count of 101 and 100 loaded rows. Assert a visible `Load more Active`
  continuation, the count 101, targeted loading state, targeted Retry, stable continuation id, and
  no ungrouped global button. Assert Enter activation, `treegrid`, row levels, positions, set sizes,
  and hidden decorative rails.

- [ ] **Step 5: Run the focused tests and verify the manual header and old rail oracle fail**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/work-views/work-list-columns.test.tsx \
    tests/work-views/work-list-groups.test.ts \
    tests/work-views/work-list.test.tsx \
    tests/work-views/initiative-rails.test.ts \
    --maxWorkers=1
  ```

- [ ] **Step 6: Build the columns and groups adapters**

  Move `FIELD_WIDTH`, property rendering, identity rendering, and breakpoint assignment into
  `work-list-columns.tsx`. Move response-summary ordering, path keys, counts, nested groups, and
  typed continuations into `work-list-groups.ts`. Export the density-to-height map from the column
  policy module so rendering and rail geometry cannot diverge.

- [ ] **Step 7: Fix the rail model**

  Use the next path node when deciding whether an ancestor rail continues. Position elbows at 50
  percent of the row. Compute each position from a membership key. Keep all geometry in named
  constants shared by the model and renderer.

- [ ] **Step 8: Replace the manual header and `ListView` body**

  Reduce `WorkList` to the `EntityTable` adapter and interaction wrappers. Pass
  `rowHeight={WORK_ROSTER_ROW_HEIGHT[definition.presentation.density]}`, `tone="tonal"`, and
  `gridRole="treegrid"` for Initiatives. Pass the same resolved height to the rail renderer. Remove
  local `role="columnheader"`, `@2xl` visibility strings, the absolute Load more button, and
  `ListView` layout code.

- [ ] **Step 9: Replace source-string visual assertions with rendered behavior**

  Delete tests that look for the old `ListView`, `ListRow`, and class strings. Keep visual contract
  tests only when they assert rendered roles, cells, order, or behavior.

- [ ] **Step 10: Run focused web validation**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/work-views/work-list-columns.test.tsx \
    tests/work-views/work-list-groups.test.ts \
    tests/work-views/work-list.test.tsx \
    tests/work-views/initiative-rails.test.ts \
    --maxWorkers=1
  pnpm --filter @docket/web typecheck
  ```

- [ ] **Step 11: Commit the WorkList migration**

  Commit as `fix(web): Render work lists through the shared table`. The body must explain how one
  identity floor and one column array replace the separate header/body layout.

### Task 6: Unify selection, capabilities, and context behavior

**Files:**

- Modify: `packages/ui/src/components/views/EntityTable.tsx`
- Modify: `packages/ui/tests/components/views/entity-table.test.tsx`
- Create: `apps/web/src/components/selection/entity-table-selection.tsx`
- Modify: `apps/web/src/components/selection/selection-context.tsx`
- Modify: `apps/web/src/components/work-views/work-view-page.tsx`
- Modify: `apps/web/src/components/work-views/work-list.tsx`
- Modify: `apps/web/src/components/work-views/work-cards.tsx`
- Modify: `apps/web/src/components/work-views/work-board.tsx`
- Modify: `apps/web/src/components/work-views/work-view-object.ts`
- Modify: `apps/web/src/components/work-views/work-view-toolbar.tsx`
- Modify: `apps/web/src/components/views/task-table.tsx`
- Create: `apps/web/tests/interactivity/entity-table-selection.test.tsx`
- Modify: `apps/web/tests/work-views/work-list.test.tsx`
- Modify: `apps/web/tests/work-views/work-cards.test.tsx`
- Modify: `apps/web/tests/work-views/work-board.test.tsx`
- Modify: `apps/web/tests/work-views/work-view-toolbar.test.tsx`
- Create: `apps/web/tests/work-views/work-view-page.test.tsx`
- Modify: `apps/web/tests/components/views/task-table.test.tsx`

**Interfaces:**

- Wrap every renderer in `SelectionProvider` with visible route-owned direct row objects. Omit
  context and foreign-owned rows from selectable items. Keep foreign-owned rows keyboard-navigable
  with single-row Open and Copy link actions outside bulk selection.
- Key the `SelectionProvider` instance and surface id by organization, target, and query execution
  identity.
- Keep `EntityTable` as the only focus and keyboard owner. Add an application bridge that maps its
  active-entry, pointer, and selection-command callbacks into pure `SelectionIntent` transitions.
- Do not spread `SelectionProvider.containerProps`, `useSelectableRow` focus props, or a second
  roving `tabIndex` model into `EntityTable`.
- Narrow `containerInteraction` to exclude `onKeyDown`, `role`, `tabIndex`, and
  `aria-activedescendant`. Narrow row interaction to pointer, selection, and drag/drop state without
  a focus ref or row `tabIndex`. Preserve the Library roster's ref and scroll observer.
- Expose the selection anchor from `SelectionProvider`. The bridge passes it into `EntityTable` and
  maps the table's typed command payload directly. Add
  `dispatchInOrder(intent, orderedSelectionKeys)`, which validates keys against provider items and
  applies the intent against table order. Keep existing `dispatch(intent)` for non-table surfaces.
  The bridge never rebuilds flattened row order.
- Read `canManage` and `canContribute` once from `useCanManageOrg`.
- Pass the route organization separately from row ownership.
- Permit an entity write, property mutation, reorder, or generic drag only for a direct row whose
  owner equals the route organization and whose route capability allows that action.

- [ ] **Step 1: Write selection-lifecycle tests**

  Select rows, change the search or saved view, and assert that the old selection disappears. Remove
  a row on settled refresh and assert pruning. Change selection after a successful copy and assert
  that the label returns to `Copy links`. Reject the clipboard promise and assert no success state.

- [ ] **Step 2: Write multi-row drag and context-row tests**

  Select two direct route-owned rows and start a drag from one. Assert that both selected objects
  enter the drag payload. Attempt to select and drag a foreign-owned direct row. Assert that it does
  not join the provider selection and cannot start a drag. Render context rows in list, card, and
  board layouts. Assert that list context remains a link and never exposes selection or drag, while
  cards and board exclude it from ordinary items and counts.

- [ ] **Step 3: Write the single-keyboard-owner tests**

  Navigate across group headers, data rows, and continuations with arrows. Extend a range with Shift
  and assert that only direct rows enter selection. Toggle a row with Space. Exercise
  Command/Ctrl+A, Escape, group toggle, and continuation activation. Assert that the grid has one
  `aria-activedescendant`, rows do not add roving focus, and focus restores to the nearest surviving
  flattened entry after a group collapses or a page settles. Run the same ownership assertions
  against `TaskTable`, which currently combines both keyboard systems. Add compile-time or type
  assertions that the shared table rejects injected container keyboard props and row focus props.

- [ ] **Step 4: Write capability tests**

  Render a viewer, contributor, and manager. Assert that the viewer sees no create, rename, order,
  drag, or Set default action. Assert that a contributor can create and reorder but cannot set the
  organization default. Assert that a manager can do both for route-owned direct rows. Render a
  foreign-owned direct row and assert that every role sees it as read-only in this roster. Assert
  that it remains keyboard-navigable and that its single-row Copy link action works. Assert that it
  cannot enter bulk selection. Assert that rename, property edits, reorder, generic drag, and
  group-property mutation stay absent.

- [ ] **Step 5: Write route-owner and cycle-preview tests**

  Render a readable Initiative owned by another authorized organization inside the route context.
  Assert that the root drop target uses the route organization and navigation uses the row owner.
  Assert that a proven cycle rejects, an incomplete local hierarchy stays neutral, and the API
  remains the final mutation authority.

- [ ] **Step 6: Run the focused tests and verify dual focus and unconditional actions fail**

  Run:

  ```bash
  pnpm --filter @docket/ui exec vitest run \
    tests/components/views/entity-table.test.tsx \
    --maxWorkers=1
  pnpm --filter @docket/web exec vitest run \
    tests/work-views/work-list.test.tsx \
    tests/work-views/work-cards.test.tsx \
    tests/work-views/work-board.test.tsx \
    tests/work-views/work-view-toolbar.test.tsx \
    tests/work-views/work-view-page.test.tsx \
    tests/interactivity/entity-table-selection.test.tsx \
    tests/components/views/task-table.test.tsx \
    --maxWorkers=1
  ```

- [ ] **Step 7: Add the table-selection bridge and remove the second focus model**

  Build `entity-table-selection.tsx` as the only adapter between `EntityTable` commands and
  `SelectionIntent`. Expose the provider's anchor and pass it to the table. Use the table-provided
  ordered eligible keys through `dispatchInOrder` instead of deriving order in the bridge. Use
  provider state and `selectedObjects` for list, card, and board bindings. Exclude context rows from
  selectable provider items. Exclude foreign-owned rows because the action context has one owning
  workspace and cannot route a mixed-workspace selection safely. Keep their single-row navigation
  and Copy link actions outside the provider. Put the renderer and bulk-action bar inside one keyed
  provider child so both use the same selection context. Remove the duplicate `selectedIds` toggle
  and keyboard code from `WorkList`. Migrate `TaskTable` to the same bridge instead of treating its
  current dual-owner wiring as precedent.

- [ ] **Step 8: Close the shared-component escape hatches**

  Narrow the shared interaction types after `TaskTable` stops using them for focus. Keep the
  Library roster's `ref` and `onScroll` integration working. Reject externally supplied container
  keyboard ownership, active-descendant state, row focus refs, and row `tabIndex` at the type
  boundary.

- [ ] **Step 9: Apply capabilities and organization context**

  Pass `canContribute` into create, edit, drag, drop, and order paths. Pass `canManage` to default
  controls. Require `row.organizationId === routeOrganizationId` and a direct row before any entity
  or property write, reorder, or generic drag. Build the Initiative root target from the route
  organization instead of `rows[0]`. Use the row owner only for navigation and object identity.

- [ ] **Step 10: Run focused tests, typecheck, and lint**

  Run:

  ```bash
  pnpm --filter @docket/ui exec vitest run \
    tests/components/views/entity-table.test.tsx \
    --maxWorkers=1
  pnpm --filter @docket/web exec vitest run \
    tests/work-views/work-list.test.tsx \
    tests/work-views/work-cards.test.tsx \
    tests/work-views/work-board.test.tsx \
    tests/work-views/work-view-toolbar.test.tsx \
    tests/work-views/work-view-page.test.tsx \
    tests/interactivity/entity-table-selection.test.tsx \
    tests/components/views/task-table.test.tsx \
    --maxWorkers=1
  pnpm --filter @docket/ui typecheck
  pnpm --filter @docket/web typecheck
  pnpm --filter @docket/ui lint
  pnpm --filter @docket/web lint
  ```

- [ ] **Step 11: Commit the interaction slice**

  Commit as `fix(web): Keep work-view actions within visible permissions`. The body must record
  one table keyboard owner, route-owned direct-row selection and multi-object drag, foreign-row
  read-only behavior, and the route-owner distinction.

### Task 7: Remove the remaining manual roster grids

**Files:**

- Modify: `apps/web/src/components/teams/team-list-ui.tsx`
- Modify: `apps/web/src/components/cycles/cycle-row.tsx`
- Modify: `apps/web/src/components/programs/program-list-ui.tsx`
- Delete: `apps/web/src/components/views/roster-grid.ts`
- Delete: `apps/web/tests/components/roster-grid-contract.test.ts`
- Create: `apps/web/tests/components/entity-table-ownership.test.ts`
- Create: `apps/web/tests/components/teams/team-list-ui.test.tsx`
- Modify: `apps/web/tests/cycles/cycles-list.test.tsx`

**Interfaces:**

- Team and Cycle row adapters provide `Column<T>[]` to `EntityTable`.
- `ProgramCards` remains. The unused `ProgramRows`, row-only props, and row-only helpers disappear.
- Application feature code no longer owns `role="columnheader"`.

- [ ] **Step 1: Write failing Team and Cycle behavior tests**

  Assert shared header/body `data-col` keys, links, accessible names, values, and responsive column
  priorities. Assert that existing Team triage and Cycle status content remains present.

- [ ] **Step 2: Write the ownership policy test**

  Scan `apps/web/src` and fail on application-owned `role="columnheader"`. Assert that Team,
  Cycle, and WorkList import `EntityTable`. Do not assert utility-class strings.

- [ ] **Step 3: Run the focused tests and verify the manual grids fail the policy**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/entity-table-ownership.test.ts \
    tests/components/teams/team-list-ui.test.tsx \
    tests/cycles/cycles-list.test.tsx \
    --maxWorkers=1
  ```

- [ ] **Step 4: Migrate Team and Cycle rows**

  Keep each domain's cell rendering in its module. Hand sizing, headers, visibility, scrolling, and
  row chrome to `EntityTable`. Preserve real links, object surfaces, and accessible values.

- [ ] **Step 5: Remove dead Program row code and the CSS-string helper**

  Confirm `ProgramRows` has no production or test caller with `rg`. Remove only the unused row
  renderer and row-only contract. Keep cards and their shared program cells. Delete `roster-grid.ts`
  after its last import disappears.

- [ ] **Step 6: Run the ownership scan and affected page tests**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/entity-table-ownership.test.ts \
    tests/components/teams/team-list-ui.test.tsx \
    tests/cycles/cycles-list.test.tsx \
    tests/components/projects/projects-experience-contract.test.ts \
    --maxWorkers=1
  pnpm --filter @docket/web typecheck
  ```

- [ ] **Step 7: Commit the roster cleanup**

  Commit as `fix(web): Route every roster through the shared table`. The body must state that the
  source policy prevents a feature-owned header/body grid from returning.

### Task 8: Add rendered responsive acceptance and make it a release gate

**Files:**

- Create: `apps/web/e2e/helpers/roster.ts`
- Create: `apps/web/e2e/release/work-roster-acceptance.spec.ts`
- Modify: `apps/web/e2e/work/initiative-roster-shots.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Create: `scripts/run-release-acceptance.sh`
- Modify: `.github/workflows/ci.yml`
- Modify: `repo-tests/ci/ci-gate-policy.test.ts`
- Create: `repo-tests/tooling/release-acceptance-script.test.ts`

**Interfaces:**

- Add `test:e2e:release` as `playwright test e2e/release --workers=1`.
- Make `core-screen-smoke` call that script against the existing PostgreSQL and production build.
- Add a root `test:release` command that starts a disposable PostgreSQL instance, applies
  migrations, builds and starts the API and standalone Web app, waits for both health checks, runs
  the release directory, and tears down every owned process and temporary file.
- Build a run id from the shell PID and `RANDOM`. Name the PostgreSQL 17 container
  `docket-release-<run-id>` and the database `docket_release_<run-id>` after converting hyphens to
  underscores. Bind `127.0.0.1::5432` so Docker chooses an unused database port. Choose unused
  loopback API and Web ports.
- Export the CI test values for `APP_MODE`, app/API URLs, passkey relying party, trusted origins,
  auth secret, and both database URLs. Pass the generated database URL directly to migration. Never
  let migration inherit `DATABASE_URL` or `DATABASE_URL_UNPOOLED` from `.env.local`.
- Assemble `.next/static` and `public` under the standalone server. Record owned PIDs and install
  `EXIT`, `INT`, and `TERM` traps that stop both servers and remove the container and temporary
  directory.
- Commit `scripts/run-release-acceptance.sh` with executable mode.
- Raise the `core-screen-smoke` timeout from 12 minutes to 30 minutes.
- Measure header and body geometry through `data-col` instead of CSS source strings.

- [ ] **Step 1: Build the long-title hierarchy fixture**

  Seed two roots, an only child, a grandchild, a later sibling, and the three reported long titles.
  Add duplicate ancestor context across two groups and 101 direct rows in one group.

- [ ] **Step 2: Add the geometry helper**

  For each visible `data-col`, compare header and first-row cell x-coordinate and width within one
  CSS pixel. Compare header-label and root-title text x-coordinates. Repeat after setting the table
  scrollport's `scrollLeft`. Assert that a depth-N Initiative title starts 24px after its parent
  title. Assert that the document has no horizontal overflow.

- [ ] **Step 3: Add the responsive matrix**

  Run Task, Project, Program, and Initiative work rosters at 1440x900, 1016x1724, 768x900, 390x844,
  and 320x844. Run Team and Cycle adapters at 1016x900 and 390x844. At 1016px, repeat Initiative
  geometry with the sidebar expanded and collapsed. Assert monotonic visible columns, sticky header
  behavior, root and depth-five title floors at widths of at least 390px, local horizontal scrolling
  when metadata requires it, and the three long titles fitting at 1016px. At 1016px and 390px,
  repeat Initiative geometry in compact and comfortable density. Assert 44px and 56px rows with rail
  elbows centered at half the same resolved height. At 320px, assert that a one-column roster fits
  without horizontal scrolling.

- [ ] **Step 4: Add the interaction and recovery journeys**

  Exercise arrow navigation, Enter activation, selection, direct-only drag, group Load more, a
  forced 503 continuation failure, targeted Retry, and preservation of loaded rows. Create, rename,
  and reparent an Initiative through the product UI and assert that the mounted roster changes
  without a reload. Verify the viewer capability boundary. Focus a foreign-owned direct row, copy
  its link through the single-row action, and prove that bulk selection, write controls, and drag
  remain unavailable.

- [ ] **Step 5: Run the new acceptance test against a local production build**

  Implement the root release orchestration first. Run:

  ```bash
  pnpm test:release
  ```

  Assert that the command uses an isolated database, production artifacts, health waits, one
  Playwright worker, and reliable cleanup on success, test failure, or interrupt. Assert that it
  chooses non-conflicting ports, uses a unique container/database name, assembles standalone static
  assets, records owned PIDs, and exports the same test URL/auth variables as CI. Seed a hostile
  `.env.local` database URL in the tooling test and prove that the migration command still receives
  only the generated disposable URL.
  Assert that the runner has executable mode.

- [ ] **Step 6: Update the visual evidence suite**

  Capture light and dark screenshots at 1440px, 1016px, and 390px. Use the same hierarchy and long
  titles as the required test. Keep screenshots as review evidence and geometry as the gate.

- [ ] **Step 7: Gate the complete release directory**

  Add the package script. Replace the individual `core-screen-acceptance.spec.ts` CI command with
  the directory script. Keep one worker and the existing PostgreSQL service. Raise the job timeout
  to 30 minutes. Do not add `continue-on-error`.

- [ ] **Step 8: Lock the deployment dependency in the policy test**

  Assert that the package script names the complete release directory, the smoke job invokes it,
  the root orchestration command owns setup and cleanup through `EXIT`, `INT`, and `TERM`, and the CI
  timeout is at least 30 minutes. Assert that the local command passes its generated database URL to
  migration explicitly and cannot inherit a database from `.env.local`. Assert that `still-latest`
  depends on the smoke job and `deploy-production` depends on both. Assert that an individual-spec
  command fails policy so future release specs join the gate automatically.

- [ ] **Step 9: Run the release and policy gates**

  Run:

  ```bash
  pnpm test:release
  pnpm test:tooling
  ```

- [ ] **Step 10: Commit the release gate**

  Commit as `fix(web): Gate work roster behavior before deployment`. The body must separate the
  deterministic release assertions from the evidence-only screenshots.

### Task 9: Validate the exact release candidate and close the worklog

**Files:**

- Modify: `docs/WORKLOG.md`
- Create: `docs/design/audits/2026-08-28-work-roster.md`

**Interfaces:**

- Record exact test counts, screenshot paths, browser dimensions, commit ids, CI run, deployment
  state, and live verification state separately.
- Do not call production fixed until the deployed runtime has been checked in a real browser.

- [ ] **Step 1: Run the machine resource check**

  Run:

  ```bash
  ~/.claude/resource-limits/agentctl status
  ```

  If the process forest is near its ceiling, report that state before running the root checks. Do
  not disable the watchdog.

- [ ] **Step 2: Run the focused regression matrix one final time**

  Run:

  ```bash
  pnpm --filter @docket/ui exec vitest run \
    tests/components/views/entity-table.test.tsx \
    tests/components/views/entity-table-virtual.test.tsx \
    --maxWorkers=1

  pnpm --filter @docket/web exec vitest run \
    tests/lib/query-keys.test.ts \
    tests/lib/work-target-invalidation.test.ts \
    tests/lib/use-initiative-mutations.test.ts \
    tests/lib/use-project-mutations.test.ts \
    tests/lib/work-metadata-invalidation.test.tsx \
    tests/components/initiatives/initiative-actions.test.tsx \
    tests/composers/create-initiative.test.tsx \
    tests/composers/create-project.test.tsx \
    tests/interactivity/entity-table-selection.test.tsx \
    tests/components/views/task-table.test.tsx \
    tests/work-views/work-view-pages.test.ts \
    tests/work-views/work-view-controller-hook.test.tsx \
    tests/work-views/work-list-columns.test.tsx \
    tests/work-views/work-list-groups.test.ts \
    tests/work-views/work-list.test.tsx \
    tests/work-views/initiative-rails.test.ts \
    tests/work-views/work-cards.test.tsx \
    tests/work-views/work-board.test.tsx \
    --maxWorkers=1

  pnpm --filter @docket/api exec vitest run \
    tests/work-views/query.test.ts \
    tests/work-views/query-plan.test.ts \
    tests/work-views/performance.test.ts \
    tests/routes/work-views.test.ts \
    --maxWorkers=1
  ```

- [ ] **Step 3: Run bounded repository checks**

  Use no more than two concurrent package tasks and one concurrent build task:

  ```bash
  pnpm exec turbo run typecheck --concurrency=2
  pnpm lint
  pnpm test:tooling
  pnpm exec turbo run test --concurrency=2
  pnpm test:release
  ```

  Treat exit 137 with no output as a resource kill. Do not rerun the same command unchanged.

- [ ] **Step 4: Run the visual craft review**

  Use the repository `design-review` skill against the production build. Capture at least desktop
  and mobile in light and dark themes. Record alignment, density, hierarchy, responsive behavior,
  accessibility, and interaction findings in the audit. Fix every P0/P1 finding before proceeding.

- [ ] **Step 5: Self-review the complete diff**

  Confirm that `WorkList` contains no manual header, local width map, or separate scroll body.
  Confirm that application code contains no `role="columnheader"`. Confirm that API response types
  and database schema did not change. Confirm that no test encodes utility strings as product
  behavior.

- [ ] **Step 6: Update the worklog and commit closeout evidence**

  Move `[WORK-ROSTER-CORRECTNESS-001]` to completed only after every local gate passes. Add exact
  commands, results, remaining release state, and retrospective. Include the worklog and visual
  audit in the final release-gate commit or amend that commit before it leaves the worktree.

- [ ] **Step 7: Rebase and verify linear history before integration**

  Rebase onto the current integration target. Re-run affected checks after conflict resolution.
  Verify:

  ```bash
  git rev-list --merges --count origin/main..HEAD
  ```

  The result must be `0`.

- [ ] **Step 8: Verify CI, deployment, and production as separate states**

  Push only after local checks pass. Wait for the exact-SHA required checks. Confirm that the
  release browser job passed before deployment. After deployment, verify the deployed SHA and run
  the long-title, group continuation, create, rename, and reparent journey in the real authenticated
  production surface without creating demo data outside an explicitly approved workspace.

## Completion criteria

The work is complete only when the shared component owns every roster header, the API returns
complete direct-page context, writes refresh mounted rosters, recoverable failures keep loaded data,
the responsive browser matrix passes, the exact SHA deploys, and the production journey has been
verified. A green unit suite without the required browser job does not satisfy this plan.

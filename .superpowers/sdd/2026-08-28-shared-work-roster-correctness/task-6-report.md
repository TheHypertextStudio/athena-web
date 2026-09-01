# Task 6 implementation report

This report is for the Task 6 reviewer. The reviewer should use it to verify the selection and
permission boundaries before integrating commit `fix(web): Keep work-view actions within visible
permissions`.

## Implemented behavior

The shared `EntityTable` now owns the only grid focus and keyboard model. Application row bindings
can add selection state, pointer handlers, and drag or drop refs. They cannot add a container key
handler, an active-descendant owner, a container role or tab index, a row focus ref, or a row tab
index. When a settled page or collapsed group removes the active entry, the table selects the next
surviving flattened neighbor before it falls back to the previous neighbor.

The application bridge maps the table's typed selection commands into `SelectionIntent`. The bridge
uses the table's eligible flattened order. `SelectionProvider.dispatchInOrder` rejects keys that are
not provider items. The provider exposes its anchor without recreating table order. `TaskTable` now
uses this bridge and retains its `L` property shortcut through `EntityTable.onRowPropertyKey`.

Each work renderer now reads selection from one keyed provider. The key and surface id use the route
organization, target, and the controller's exact query execution key. Search changes, saved-view
changes, and settled removals clear or prune stale selection. Bulk copy resets its success label
when selection changes, and a rejected clipboard write never shows success.

List, card, and board drags carry all selected route-owned direct objects when the dragged object is
selected. Context rows remain read-only links in the list and do not appear as ordinary cards or
board items. Foreign direct rows keep their owner-specific navigation and reference-only Open and
Copy actions. They do not enter bulk selection, relation writes, property writes, reorder paths, or
generic drag payloads.

The page reads `canManage` and `canContribute` once. Contributors can create and reorder route-owned
direct rows. Managers can also set the organization default. Viewers receive no create callback,
create action, mutable board destination, schedule mutation, or generic drag capability. The
Project timeline applies the route capability to scheduling and generic drag. The Initiative
timeline is always non-draggable because it is a read-only rollup.

The Initiative root drop target uses the route organization. Row links and object identities use
the row owner. A proven local Initiative cycle marks the relation preview as rejected. An incomplete
local hierarchy stays neutral, so the API remains the final mutation authority. Board drops retain
the exact full-path membership that started the drag, and canceled drops clear that path.

## RED evidence

The TDD failures established the missing boundaries before production changes:

- The shared table command ran 41 tests. Three failed and 38 passed. The failures showed that the
  drag/drop interaction ref was not bound and that removal and collapse restored the wrong active
  entry.
- The seven-suite web command ran 68 tests. Five page tests failed because no keyed selection surface
  existed, and the bridge import failed because the adapter did not exist. The other 63 tests passed.
- The focused `TaskTable` run failed 1 of 10 tests because task rows still added `tabIndex=0` beside
  the grid owner.
- The focused timeline run failed 2 of 7 tests. A Project viewer remained schedulable, and a
  route-owned Initiative remained writable and draggable in the read-only timeline.

The exact RED commands were:

```text
pnpm --filter @docket/ui exec vitest run tests/components/views/entity-table.test.tsx --maxWorkers=1

pnpm --filter @docket/web exec vitest run \
  tests/work-views/work-list.test.tsx \
  tests/work-views/work-cards.test.tsx \
  tests/work-views/work-board.test.tsx \
  tests/work-views/work-view-toolbar.test.tsx \
  tests/work-views/work-view-page.test.tsx \
  tests/interactivity/entity-table-selection.test.tsx \
  tests/components/views/task-table.test.tsx \
  --maxWorkers=1

pnpm --filter @docket/web exec vitest run tests/components/views/task-table.test.tsx --maxWorkers=1

pnpm --filter @docket/web exec vitest run tests/work-views/work-timeline.test.tsx --maxWorkers=1
```

## GREEN evidence

The final validation on 2026-08-31 produced these results:

- The exact shared table command passed 41 of 41 tests in one file.
- The exact seven-suite web command passed 78 of 78 tests in seven files.
- The controller, timeline, and board-policy supplement passed 40 of 40 tests in three files.
- `pnpm --filter @docket/ui typecheck` passed.
- `pnpm --filter @docket/web typecheck` passed.
- `pnpm --filter @docket/ui lint` passed after the nearest-survivor search moved into a named helper.
- Bounded ESLint across every Task 6 web source and test file passed with no findings.
- `git diff --check` passed.

The supplement command was:

```text
pnpm --filter @docket/web exec vitest run \
  tests/work-views/work-view-controller-hook.test.tsx \
  tests/work-views/work-timeline.test.tsx \
  tests/work-views/work-board-interaction-policy.test.tsx \
  --maxWorkers=1
```

The exact package-wide web lint did not complete. Two duplicate attempts consumed the worktree for
about one hour. After their exact commands, process groups, and working directories were confirmed,
the controller authorized their termination. One fresh bounded attempt then ran ESLint for 10
minutes and 29 seconds without output. The controller set a 10-minute cutoff and authorized a
changed-file lint fallback. The fresh process group was terminated with `SIGTERM`, and the fallback
used the repository's `NODE_OPTIONS=--max-old-space-size=3072` cap. The first fallback found nine
Task 6 issues. The implementation moved new branches into named helpers and fixed five test-style
violations. The fallback rerun then passed with no findings. Package-wide web lint remains a
resource-blocked verification gap, not a known lint failure.

The web tests emitted six jsdom `Not implemented: navigation to another Document` messages after
link activation. The test command exited zero, and all 78 assertions passed.

## Files changed

The implementation changed these production files:

- `packages/ui/src/components/views/EntityTable.tsx`
- `packages/ui/src/components/views/entity-table-row.tsx`
- `packages/ui/src/components/index.ts`
- `apps/web/src/components/selection/entity-table-selection.tsx`
- `apps/web/src/components/selection/selection-context.tsx`
- `apps/web/src/components/selection/index.ts`
- `apps/web/src/components/objects/object-surface.tsx`
- `apps/web/src/components/views/task-table.tsx`
- `apps/web/src/components/work-views/use-work-view.ts`
- `apps/web/src/components/work-views/work-view-page.tsx`
- `apps/web/src/components/work-views/work-list.tsx`
- `apps/web/src/components/work-views/work-cards.tsx`
- `apps/web/src/components/work-views/work-board.tsx`
- `apps/web/src/components/work-views/work-view-object.ts`
- `apps/web/src/components/work-views/project-timeline-adapter.tsx`
- `apps/web/src/components/work-views/initiative-timeline.tsx`

The implementation changed these tests:

- `packages/ui/tests/components/views/entity-table.test.tsx`
- `apps/web/tests/interactivity/entity-table-selection.test.tsx`
- `apps/web/tests/components/views/task-table.test.tsx`
- `apps/web/tests/work-views/work-list.test.tsx`
- `apps/web/tests/work-views/work-cards.test.tsx`
- `apps/web/tests/work-views/work-board.test.tsx`
- `apps/web/tests/work-views/work-board-interaction-policy.test.tsx`
- `apps/web/tests/work-views/work-view-toolbar.test.tsx`
- `apps/web/tests/work-views/work-view-page.test.tsx`
- `apps/web/tests/work-views/work-view-controller-hook.test.tsx`
- `apps/web/tests/work-views/work-timeline.test.tsx`

This report is the only Task 6 documentation file. The root controller owns `docs/WORKLOG.md` and
`docs/superpowers/plans/2026-08-28-shared-work-roster-correctness.md`. The root controller also owns
the concurrent `page-layout.tsx` production and test changes. Task 6 does not stage those four files.

## Self-review

I checked the final diff against every Task 6 interface and step. The table has one keyboard owner.
The bridge consumes table order instead of reconstructing it. Provider identity uses the controller
execution key. Provider items contain route-owned direct objects only. Foreign and context rows
cannot enter a write or bulk-selection path. Route capability reaches create, relation, order, board,
and timeline paths. Route ownership and row ownership remain separate. Multi-object drag uses the
provider array instead of renderer-local state. Timeline catalogs close the generic-drag bypass.

I also checked the cancellation path for board dragging, nested controls inside table rows, the
TaskTable label shortcut, clipboard promise races, and the empty-state create action. I found and
fixed the stale board source-path ref and the viewer dependency-lens callback during this review.
Prettier formatted only Task 6 files. `git diff --check` found no whitespace errors. No Task 6 code
adds a TODO, stub, skipped test, complexity exemption, or screenshot change.

## Concerns

The only open concern is the package-wide web lint timeout described above. Every changed web file
passes the same ESLint configuration with the same heap cap, and both package typechecks pass. A
future repository-wide validation run should repeat `pnpm --filter @docket/web lint` when the host
can complete the whole scan.

# Review fix round 1

This addendum is for the Task 6 integrator. The integrator should land the atomic review-fix commit
after `602485eabfdca1eff124d8adee271b3a084425e4` and keep the separate visual commit
`0a59b7742` unchanged.

## Implemented behavior

The keyed selection provider now reads the memberships that the active renderer mounts. A grouped
list uses the same flattened EntityTable entries and collapse set as the list renderer. A board
uses the same visible root columns, lane paths, context filtering, and 100-card cell cap as the
board renderer. Cards and timelines continue to use root rows, and the dependency lens supplies no
roster selection. Collapsing a selected group or hiding its board column now removes that object
from the provider and clears the stale bulk action.

The Project timeline now checks `canSchedule` again at both mutation callback boundaries. A viewer
cannot invoke a retained reschedule or cascade callback even when the row belongs to the route
organization. TimelineCanvas also suppresses and clears its retained undo and cascade state in the
render that removes scheduling permission, so a contributor-to-viewer transition exposes no stale
write action.

## RED evidence

The review tests ran before the production changes with this command:

```text
pnpm --filter @docket/web exec vitest run \
  tests/work-views/work-view-page.test.tsx \
  tests/work-views/project-timeline-adapter.test.tsx \
  tests/timeline/timeline-drag.test.tsx \
  --maxWorkers=2
```

The command ran 20 tests. Four tests failed and 16 passed. The failures showed these exact defects:

- A collapsed grouped-list membership left `1 selected` visible.
- A membership in a hidden board column left `1 selected` visible.
- A contributor-to-viewer transition left both Undo and cascade proposal actions visible.
- The read-only Project timeline adapter still invoked reschedule and cascade callbacks.

No unrelated test failed at the RED boundary.

## GREEN evidence

The final Task 6 commands produced these results:

- The shared EntityTable command passed 41 of 41 tests in 41.94 seconds.
- The seven-suite work-view command passed 80 of 80 tests in 212.53 seconds.
- The controller, timeline, board-policy, adapter, and drag supplement passed 53 of 53 tests in
  85.86 seconds.
- `pnpm --filter @docket/ui typecheck` passed.
- The final `pnpm --filter @docket/web typecheck` passed after the lint refactor.
- Bounded ESLint across all eight changed web source and test files returned exit 0 with the
  repository's 3,072 MB heap cap.
- `git diff --check` passed.

The exact focused commands were:

```text
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

pnpm --filter @docket/web exec vitest run \
  tests/work-views/work-view-controller-hook.test.tsx \
  tests/work-views/work-timeline.test.tsx \
  tests/work-views/work-board-interaction-policy.test.tsx \
  tests/work-views/project-timeline-adapter.test.tsx \
  tests/timeline/timeline-drag.test.tsx \
  --maxWorkers=1
```

The exact final changed-file lint was:

```text
NODE_OPTIONS=--max-old-space-size=3072 \
pnpm --filter @docket/web exec eslint \
  src/components/timeline/timeline-canvas.tsx \
  src/components/work-views/project-timeline-adapter.tsx \
  src/components/work-views/work-board.tsx \
  src/components/work-views/work-list-groups.ts \
  src/components/work-views/work-view-page.tsx \
  tests/timeline/timeline-drag.test.tsx \
  tests/work-views/work-view-page.test.tsx \
  tests/work-views/project-timeline-adapter.test.tsx
```

The first changed-file lint found five issues in the new code. The permission branches pushed two
existing components one point above the complexity limit, generic group checks violated the typed
condition rule, and the partial board mock used an inline import type. Named permission and response
helpers removed the added branches. Boolean group checks and a top-level type-only module import
fixed the other findings. One intermediate lint process lost its final exit status after its child
process disappeared, so the exact command ran again and returned exit 0 against the final code.

The seven-suite command emitted the same six jsdom `Not implemented: navigation to another
Document` notices as the original Task 6 validation. The command exited zero.

## Files changed

The review fix changed these production files:

- `apps/web/src/components/timeline/timeline-canvas.tsx`
- `apps/web/src/components/work-views/project-timeline-adapter.tsx`
- `apps/web/src/components/work-views/work-board.tsx`
- `apps/web/src/components/work-views/work-list-groups.ts`
- `apps/web/src/components/work-views/work-view-page.tsx`

The review fix changed these tests:

- `apps/web/tests/timeline/timeline-drag.test.tsx`
- `apps/web/tests/work-views/project-timeline-adapter.test.tsx`
- `apps/web/tests/work-views/work-view-page.test.tsx`

The review fix also updated this Task 6 report. It did not edit or stage `docs/WORKLOG.md`, the plan,
either screenshot directory, the controller-owned visual files, or either lint-staged backup stash.

## Self-review

I checked selection behavior for ungrouped lists and boards, grouped lists with a collapsed ancestor,
grouped boards with and without lanes, the board cell mount cap, cards, both timelines, and dependency
mode. Route ownership and direct-membership filtering still run after renderer visibility, so foreign
and context rows cannot enter bulk selection. Duplicate visible memberships still collapse to one
canonical object in provider order.

I checked the permission-drop render before the clearing effect runs. The filtered local state hides
Undo and cascade actions in that render, and the effect then discards the retained data. The adapter
checks `canSchedule` before it resolves route ownership or forwards either mutation. It does not call
the cascade mutation with an empty route-owned change set.

The final diff adds no TODO, stub, skipped test, complexity exemption, screenshot change, or new
selection owner. Prettier touched only the eight review-fix source and test files.

## Concerns

The root controller ruled that this fix round should not attempt package-wide web lint while another
worktree's coverage job was still running after 56 minutes with several active workers. The exact
changed-file lint passed. Task 9 owns the reviewer Minor to run repository-wide validation when the
machine load permits it. There is no known Task 6 behavior, type, or changed-file lint failure.

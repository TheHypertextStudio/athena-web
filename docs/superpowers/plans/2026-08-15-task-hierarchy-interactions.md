# Task Hierarchy Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people atomically turn one or more existing tasks into subtasks from menus, searchable
pickers, task-row drops, or the Task graph, while making hierarchy legible as indented xyflow
branches independent from dependencies.

**Architecture:** One serializable batch-reparent service is shared by REST PATCH, registered task
actions, picker selection, and every drop surface. A pure hierarchy model supplies eligibility,
selection-root reduction, previews, filtering, and a compound xyflow layout whose transparent
containers position indented task cards and semantic rails.

**Tech Stack:** TypeScript, Hono, Zod, Drizzle/PostgreSQL, TanStack Query, React, `@xyflow/react`
12, Dagre, Vitest, Testing Library, Playwright.

---

### Task 1: Define and prove the atomic hierarchy contract

**Files:**

- Modify: `domains/work/src/contracts/task.ts`
- Modify: `the deleted legacy type warehouse tests/dto/dto.test.ts`
- Create: `apps/api/src/services/task-hierarchy.ts`
- Create: `apps/api/tests/routes/task-reparent-batch.test.ts`
- Modify: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/routes/task-helpers.ts`

- [ ] Add failing DTO tests for `TaskReparentBatchIn` and `TaskReparentBatchOut`, including a
      non-empty unique move list, nullable targets, and the returned previous-parent assignments.
- [ ] Run `pnpm domain:check` and confirm the new exports are absent.
- [ ] Export the schemas and inferred types from `domains/work/src/contracts/task.ts` with the approved wire
      shape from the design.
- [ ] Run the focused types tests and `pnpm domain:check`.
- [ ] Add route tests for one move, detach, multiple roots with different previous parents,
      selected ancestor/descendant reduction, same-parent no-op, and exact response assignments.
- [ ] Add rejection tests proving zero rows change for self-parenting, a descendant target, a cycle
      created only by the combined batch, duplicate subjects, archived/cross-org rows, missing
      capability, and two conflicting serializable moves.
- [ ] Implement `reparentTasks` as one serializable service: load and lock the involved hierarchy,
      reduce selected descendants only when preservation is requested, validate the final parent map,
      update committed roots, and return before/after assignments.
- [ ] Route both `POST /tasks/reparent` and the `parentTaskId` branch of `PATCH /tasks/:id` through
      the service; preserve the existing stable Problem codes and tenant-existence hiding.
- [ ] Emit the existing task audit, observation, and search-index effects once per committed root.
- [ ] Run the focused API tests and `pnpm --filter @docket/api typecheck`.
- [ ] Commit the atomic API slice with scope `api`.

### Task 2: Build the shared hierarchy model

**Files:**

- Create: `apps/web/src/components/tasks/task-hierarchy-model.ts`
- Create: `apps/web/tests/components/tasks/task-hierarchy-model.test.ts`

- [ ] Write failing tests for forest construction, stable pre-order, ancestor and descendant sets,
      selected-root reduction, valid-parent candidates, depth, continuation rails, and retention of
      ancestors for filtered matches.
- [ ] Add fixtures covering a five-level tree, multiple roots, cross-project children, orphan-safe
      input, an overlapping selection, and a filtered grandchild.
- [ ] Run the focused test and confirm the model module is absent.
- [ ] Implement one immutable hierarchy index with methods for all tested derivations; do not put
      React, API calls, layout coordinates, or rendered copy in this module.
- [ ] Run the focused test and `pnpm --filter @docket/web typecheck`.
- [ ] Commit the hierarchy-model slice with scope `web`.

### Task 3: Add registered hierarchy actions and the parent picker

**Files:**

- Modify: `apps/web/src/components/tasks/task-actions.ts`
- Modify: `apps/web/src/components/pickers/picker-overlay.tsx`
- Create: `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx`
- Create: `apps/web/src/components/tasks/use-task-hierarchy-mutation.ts`
- Modify: `apps/web/tests/components/tasks/task-actions.test.tsx`
- Create: `apps/web/tests/components/tasks/task-hierarchy-picker-overlay.test.tsx`

- [ ] Extend action tests to require “Create subtask,” multi-object `task.makeSubtaskOf`, and
      `task.moveToTopLevel`, with the latter hidden when the context contains no nested root.
- [ ] Add picker tests for workspace task loading, project/team supporting text, text search,
      selected/descendant exclusion, mixed-selection copy, focus restoration, safe read/write errors,
      and immediate close after selection.
- [ ] Add mutation-hook tests proving an optimistic atomic cache patch across task detail, task
      lists, and every graph scope; one-unit rollback; and Undo using different previous parents.
- [ ] Implement the hierarchy mutation hook against the batch endpoint and the existing six-second
      undo treatment used by graph mutations.
- [ ] Add the task-hierarchy request to `PickerOverlayRequest` and render the new overlay alongside
      labels and Initiative hierarchy.
- [ ] Register both actions once in the task domain and ensure menu, command, bulk, and detail
      callers all resolve the same definitions.
- [ ] Run the focused web tests and typecheck.
- [ ] Commit the action-and-picker slice with scope `web`.

### Task 4: Make task lists selection-aware hierarchy drag surfaces

**Files:**

- Modify: `packages/ui/src/components/views/EntityTable.tsx`
- Modify: `packages/ui/src/components/views/entity-table-row.tsx`
- Modify: `apps/web/src/components/views/task-table.tsx`
- Modify: `apps/web/src/components/task-detail/Subtasks.tsx`
- Modify: `apps/web/src/components/dnd/drag-context.tsx`
- Modify: `apps/web/src/components/dnd/drag-payload.ts`
- Modify: `apps/web/src/components/dnd/use-draggable.ts`
- Create: `apps/web/src/components/tasks/task-hierarchy-drop.tsx`
- Modify: `apps/web/tests/interactivity/drag-and-drop.test.tsx`
- Create: `apps/web/tests/components/tasks/task-table-hierarchy.test.tsx`

- [ ] Add a backward-compatible EntityTable row-interaction binding test covering DOM props, refs,
      leading selection control, selected styling, and the unchanged default row path.
- [ ] Add task-table tests for plain/modifier/keyboard selection, checkbox selection, title-link
      navigation, selected-object context menus, and selection pruning after filtering.
- [ ] Extend drag tests so a drag beginning on a selected row carries the ordered selection while
      legacy readers still receive the primary task.
- [ ] Add valid and invalid table/inline-subtask drop tests asserting the inset ring, no-drop
      cursor, indented ghost row, curved preview rail, live-region status, dispatched action context,
      and cleanup after drop/cancel.
- [ ] Implement the generic EntityTable binding without importing app action or task types into
      `@docket/ui`.
- [ ] Wrap canonical TaskTable instances in the existing SelectionProvider contract and keep the
      title as the real task link.
- [ ] Extend the drag payload with a versioned object-set flavor while continuing to write the
      existing single-object and legacy entity flavors.
- [ ] Implement one hierarchy drop adapter shared by TaskTable and inline subtasks; keep calendar
      and planner targets unchanged.
- [ ] Run focused UI/web tests plus both package typechecks.
- [ ] Commit the selection-and-drag slice with scope `web`; the generic UI extension ships only to
      support this product interaction and belongs in the same feature-oriented commit.

### Task 5: Lay out hierarchy as transparent xyflow branches

**Files:**

- Create: `apps/web/src/components/canvas/task-hierarchy-layout.ts`
- Create: `apps/web/src/components/canvas/task-branch-node.tsx`
- Create: `apps/web/src/components/canvas/task-hierarchy-rails.tsx`
- Modify: `apps/web/src/components/canvas/use-task-graph.ts`
- Modify: `apps/web/src/components/canvas/use-dagre-layout.ts`
- Modify: `apps/web/src/components/canvas/use-grouped-layout.ts`
- Create: `apps/web/tests/components/canvas/task-hierarchy-layout.test.ts`
- Create: `apps/web/tests/components/canvas/task-branch-node.test.tsx`

- [ ] Write pure layout tests for parent-before-child ordering, 48px relative indentation,
      recursive branch bounds, stable sibling order, both LR/TB directions, filtered ancestor
      retention, and lane → root → descendant parent chains.
- [ ] Add dependency fixtures proving top-level Dagre receives compound tree dimensions and
      projected cross-tree edges while rendered edges keep their actual nested endpoints.
- [ ] Add node tests requiring a transparent branch surface, header-only `dragHandle`, Initiative-
      style curved rails, ordinary TaskNode header content, and no collapse control or enclosing card.
- [ ] Implement bottom-up tree measurement and relative positioning independently of React.
- [ ] Feed compound root bounds into Dagre and nest whole trees in the lane selected by their root;
      retain child project/team context in TaskNode data.
- [ ] Stop mapping subtask records to rendered xyflow edges while leaving `GraphOut` unchanged.
- [ ] Run the focused graph tests and web typecheck.
- [ ] Commit the hierarchy-layout slice with scope `web`.

### Task 6: Add in-canvas hierarchy dragging and selection bridging

**Files:**

- Modify: `apps/web/src/components/canvas/canvas.tsx`
- Modify: `apps/web/src/components/canvas/task-graph-panel.tsx`
- Modify: `apps/web/src/components/canvas/task-node.tsx`
- Modify: `apps/web/src/components/canvas/bulk-actions-bar.tsx`
- Modify: `apps/web/src/components/canvas/use-task-graph-mutations.ts`
- Create: `apps/web/src/components/canvas/canvas-selection-bridge.tsx`
- Create: `apps/web/src/components/canvas/use-task-hierarchy-drag.ts`
- Create: `apps/web/tests/components/canvas/task-hierarchy-drag.test.tsx`

- [ ] Add selection-bridge tests proving xyflow selection registers with the global selection
      registry, so right-click and drag on one selected node resolve the complete selected task set.
- [ ] Add drag tests for pointer hit-testing, smallest eligible target selection, subtree exclusion,
      ghost branch placement, origin fading, invalid-target feedback, cancellation, commit, rollback,
      and multi-root movement.
- [ ] Add native list-to-canvas drop coverage using `screenToFlowPosition` and the same hierarchy
      action context as in-canvas drag.
- [ ] Expose the required node-drag callbacks from the generic Canvas without adding task semantics
      there; keep target resolution in the task-specific hook.
- [ ] Implement the selection bridge using `useOnSelectionChange` and the existing selection
      registry surface contract.
- [ ] Implement `onNodeDrag`/`onNodeDragStop` hierarchy preview and dispatch; snap controlled nodes
      back on cancellation or rejection.
- [ ] Replace graph-local reparent writes with the shared hierarchy mutation and Undo path.
- [ ] Rename visible focused-surface copy from “Dependency graph” to “Task graph.”
- [ ] Run focused tests, all canvas tests, and web typecheck.
- [ ] Commit the canvas-interaction slice with scope `web`.

### Task 7: Validate the complete experience and document it

**Files:**

- Modify: `docs/core/mvp-plan.md`
- Modify: `docs/WORKLOG.md`
- Create: `apps/web/e2e/task-hierarchy.spec.ts`

- [ ] Add end-to-end scenarios for menu → picker, single row drag, selected-row drag, list → graph,
      graph → graph, nested subtree movement, cross-team hierarchy, top-level detach, Undo, rejected
      cycle, keyboard-only use, and touch use through the picker.
- [ ] Assert dependency rows and blocked/ready/critical-path results are unchanged before and after
      hierarchy movement.
- [ ] Add a deterministic large fixture and assert title/status refreshes do not recompute structural
      layout while hierarchy/dependency changes do.
- [ ] Run focused package tests serially, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
      `pnpm build`; investigate and resolve every new failure while separating known baseline failures.
- [ ] Run the hierarchy Playwright scenario at desktop and narrow widths in light and dark themes;
      save screenshots and inspect task indentation, rails, drag previews, dependency routing, focus,
      clipping, and responsive controls.
- [ ] Run the repository design-review skill against the live Task graph and address every material
      rubric failure in scope.
- [ ] Update the task and graph product prose plus the WORKLOG completion entry and retrospective.
- [ ] Self-review the owned diff for API compatibility, application-owned error copy, accessibility,
      cache invalidation, and absence of incomplete code.
- [ ] Commit the validated documentation and closeout slice with scope `web`.
- [ ] Verify `git rev-list --merges --count origin/main..HEAD` returns `0` before reporting the work
      ready to land.

## Implementation assumptions

- The existing `parent_task_id` column and graph response are sufficient; no migration or breaking
  API removal is part of this work.
- The batch endpoint is additive and the web client ships with it in the same release.
- Dependency insight algorithms continue to ignore hierarchy relations.
- Hierarchy remains fully expanded in the Task graph.
- Property lanes classify an intact hierarchy by its top-level task.
- The implementation reuses existing Material tokens, picker primitives, selection machinery,
  action registry, query layer, and interaction receipts.

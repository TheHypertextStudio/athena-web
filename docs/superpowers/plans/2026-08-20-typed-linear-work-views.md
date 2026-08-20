# Typed Linear-parity Work Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat client filtering with one typed, server-executed view system for Tasks,
Projects, Programs, and Initiatives while correcting the shared detail-header overflow.

**Architecture:** `@docket/work/view-contract` owns the generic algebra and canonicalization.
`@docket/types` closes that algebra over four field catalogs and validates transport values. The
database adds compatible property and preference storage before the API compiles authorized SQL.
The web app consumes one query client and one toolbar across target-specific renderers.

**Tech Stack:** TypeScript 5 const generics, Zod, Hono, Drizzle/Postgres, TanStack Query, React,
Radix, Docket MD3 primitives, Vitest, Testing Library, and Playwright.

---

### Task 1: Correct strategic-work metadata overflow

**Files:**

- Modify: `apps/web/src/components/views/entity-detail-layout.tsx`
- Modify: `packages/ui/src/styles/globals.css`
- Modify: `apps/web/src/components/initiatives/properties-panel.tsx`
- Modify: `apps/web/src/components/initiatives/health.ts`
- Modify: `apps/web/src/components/initiatives/health-pill.tsx`
- Modify: `apps/web/src/components/initiatives/roadmap.tsx`
- Test: `apps/web/tests/components/entity-detail-layout.test.tsx`
- Test: `apps/web/tests/components/initiative-properties-panel.test.tsx`

- [ ] Write component tests that mock `ResizeObserver`, place priorities 0 through 3 in the row,
      resize below and above 40rem, and assert that inline and overflow labels are disjoint.
- [ ] Run `pnpm --filter @docket/web exec vitest run tests/components/entity-detail-layout.test.tsx --maxWorkers=2` and verify the old duplicated overflow fails.
- [ ] Partition `EntityMetadataItem` children by the measured maximum priority and omit the
      overflow trigger when the hidden partition is empty.
- [ ] Wrap inline and overflow lanes in `ControlGroup controlSize="md"`; remove local height,
      padding, type, and icon metrics from `ENTITY_METADATA_CHIP_CLASS`.
- [ ] Remove `RolledUpHealthPill` from Initiative metadata and replace production Initiative
      `verdict` copy with health copy.
- [ ] Run the two focused component files and `pnpm --filter @docket/web typecheck`.
- [ ] Commit the slice as `fix(ui): Keep visible properties out of header overflow` with a body
      that records container ownership and the single-health decision.

### Task 2: Finish the generic typed view contract

**Files:**

- Create: `domains/work/src/view-contract.ts`
- Create: `domains/work/tests/view-contract.test.ts`
- Modify: `domains/work/package.json`

- [ ] Keep the failing type tests for invalid field/operator/operand/layout combinations.
- [ ] Implement const-generic field declarations, precomputed predicate unions, recursive boolean
      nodes, arrangements, presentations, drafts, runtime schemas, and deterministic canonicalization.
- [ ] Run `pnpm --filter @docket/work exec vitest run tests/view-contract.test.ts --maxWorkers=2`
      and `pnpm --filter @docket/work typecheck`.
- [ ] Commit the slice as `feat(work): Define typed work-view queries`.

### Task 3: Instantiate all four entity contracts

**Files:**

- Create: `packages/types/src/work-view.ts`
- Create: `packages/types/tests/work-view.test.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/saved-view.ts`
- Modify: `packages/types/src/hub-preferences.ts`

- [ ] Keep type tests that reject cross-target status keys, Initiative boards, Program timelines,
      invalid contexts, and read-only group mutations.
- [ ] Declare the complete Task, Project, Program, and Initiative field catalogs and target layouts.
- [ ] Add symbolic actor/date operands, ranks, target cursors, canonical query fingerprints,
      instance keys, definitions, rows, facets, ordering requests, defaults, and saved-view schemas.
- [ ] Add v1-to-v2 saved-view migration and preference-precedence domain tests.
- [ ] Run focused Types tests plus `pnpm --filter @docket/types typecheck`.
- [ ] Commit the slice as `feat(work): Close work views over every planning level`.

### Task 4: Add compatible storage and migration

**Files:**

- Modify: `packages/db/src/schema/work.ts`
- Modify: `packages/db/src/schema/joins.ts`
- Modify: `packages/db/src/schema/crosscutting.ts`
- Modify: `packages/db/src/schema/hub.ts`
- Create: the next numbered SQL migration under `packages/db/drizzle/`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/tests/schema/work-view-schema.test.ts`
- Test: `packages/db/tests/migrations/work-view-migration.test.ts`

- [ ] Write failing schema and migration tests for Project priority, primary/multiple teams,
      members, Initiative lead team, shared ranks, v2 saved views, defaults, and personal state.
- [ ] Add tables and columns without removing `project.teamId` or legacy saved-view columns.
- [ ] Generate the migration, add primary-edge and v1-definition backfills, and assert idempotent
      additive deployment against existing fixtures.
- [ ] Run focused DB tests, schema typecheck, and migration validation.
- [ ] Commit the slice as `feat(data): Store typed work views and shared ordering`.

### Task 5: Compile authorized server queries

**Files:**

- Create: `apps/api/src/lib/work-views/contracts.ts`
- Create: `apps/api/src/lib/work-views/filter-sql.ts`
- Create: `apps/api/src/lib/work-views/sort-sql.ts`
- Create: `apps/api/src/lib/work-views/group-sql.ts`
- Create: `apps/api/src/lib/work-views/cursor.ts`
- Create: `apps/api/src/lib/work-views/query.ts`
- Test: `apps/api/tests/work-views/query.test.ts`
- Test: `apps/api/tests/work-views/cursor.test.ts`

- [ ] Write SQL integration cases for each operator family, nested logic, authorization, relation
      `EXISTS`, semantic/null ordering, fan-out groups, ancestor closure, and cursor continuation.
- [ ] Define field compiler maps with `satisfies` against each target's derived keys.
- [ ] Apply authorization before filters, facets, counts, grouping, and keyset pagination.
- [ ] Bind cursor fingerprints to the canonical query, group path, sort tuple, and entity id.
- [ ] Run focused API integration tests and `pnpm --filter @docket/api typecheck`.
- [ ] Commit the slice as `feat(api): Query authorized typed work views`.

### Task 6: Expose query, facet, ordering, default, and saved-view routes

**Files:**

- Create: `apps/api/src/routes/work-views.ts`
- Modify: `apps/api/src/app.ts`
- Modify: existing saved-view route and service files found under `apps/api/src/routes/`
- Test: `apps/api/tests/routes/work-views.test.ts`
- Test: existing saved-view route tests

- [ ] Write contract tests for all four query/result variants, typed facets, reorder rejection,
      default permissions, contextual attachment, and legacy response compatibility.
- [ ] Add the four `/v1/orgs/:orgId/work-views/*` operations and migrate saved-view persistence.
- [ ] Reject computed/read-only reorder groups and route mutable drops through canonical mutations.
- [ ] Run focused route tests, API lint, and API typecheck.
- [ ] Commit the slice as `feat(api): Expose typed work-view operations`.

### Task 7: Build the shared web view controller and toolbar

**Files:**

- Create: `apps/web/src/components/work-views/use-work-view.ts`
- Create: `apps/web/src/components/work-views/work-view-toolbar.tsx`
- Create: `apps/web/src/components/work-views/filter-builder.tsx`
- Create: `apps/web/src/components/work-views/sort-builder.tsx`
- Create: `apps/web/src/components/work-views/display-controls.tsx`
- Create: `apps/web/src/components/work-views/view-state.ts`
- Test: `apps/web/tests/work-views/view-state.test.ts`
- Test: `apps/web/tests/work-views/work-view-toolbar.test.tsx`

- [ ] Write failing precedence, reset, draft, multi-sort, property, and responsive-overflow tests.
- [ ] Implement URL refinement over saved/default filters and personal presentation/arrangement
      overrides over saved/default definitions.
- [ ] Keep incomplete editor state in `FilterDraft`; parse before applying or saving.
- [ ] Use named MD3 type roles, semantic colors, `ControlGroup`, and shared primitives only.
- [ ] Run focused controller/toolbar tests plus web typecheck and lint.
- [ ] Commit the slice as `feat(web): Add one controller for typed work views`.

### Task 8: Add list, board, and timeline adapters

**Files:**

- Create: `apps/web/src/components/work-views/work-list.tsx`
- Create: `apps/web/src/components/work-views/work-board.tsx`
- Create: `apps/web/src/components/work-views/project-timeline-adapter.tsx`
- Create: `apps/web/src/components/work-views/initiative-timeline.tsx`
- Test: `apps/web/tests/work-views/work-list.test.tsx`
- Test: `apps/web/tests/work-views/work-board.test.tsx`
- Test: `apps/web/tests/work-views/work-timeline.test.tsx`

- [ ] Write failing tests for sticky nested groups, bounded mounting, keyboard selection, hidden
      columns, lazy pagination, create-in-column, mutable drops, and Initiative ancestor context.
- [ ] Adapt the existing virtual `ListView`, Project timeline, and dependency lens instead of
      replacing their proven interaction code.
- [ ] Add board columns/swimlanes and route drops through the typed ordering operation.
- [ ] Run focused renderer tests and web typecheck.
- [ ] Commit the slice as `feat(web): Render typed work views across supported layouts`.

### Task 9: Switch all four main pages and validate rollout

**Files:**

- Modify: current Task, Project, Program, and Initiative overview page clients under
  `apps/web/src/app/(app)/orgs/[orgId]/`
- Modify: `docs/WORKLOG.md`
- Test: `apps/web/e2e/work/work-views.spec.ts`
- Test: `apps/web/e2e/work/work-views-responsive.spec.ts`
- Create: seeded performance fixture and query benchmark under existing API test infrastructure

- [ ] Switch all four pages together while retaining detail endpoints, dependency view, legacy URL
      decoder, and rollback readers.
- [ ] Exercise filter, nested filter, group, subgroup, ordered sort, save, reload, share, favorite,
      layout, selection, bulk action, drag, and reset for every target.
- [ ] Validate 1440, 768, 390, and 320 pixels in both themes, keyboard-only use, screen-reader names,
      focus restoration, and reduced motion.
- [ ] Benchmark warm 100-row pages at 50,000 Tasks, 5,000 Projects, 1,000 Programs, and 1,000
      Initiatives; fail when p95 exceeds 300ms or mounted rows/cards become unbounded.
- [ ] Run focused checks, then bounded root typecheck, lint, test, and build gates.
- [ ] Complete the WORKLOG entry with evidence, remaining compatibility cleanup, and rollout risks.
- [ ] Commit the page switch as `feat(web): Replace flat rosters with typed work views`.

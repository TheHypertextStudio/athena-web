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

- [x] Write component tests that mock `ResizeObserver`, place priorities 0 through 3 in the row,
      resize below and above 40rem, and assert that inline and overflow labels are disjoint.
- [x] Run `pnpm --filter @docket/web exec vitest run tests/components/entity-detail-layout.test.tsx --maxWorkers=2` and verify the old duplicated overflow fails.
- [x] Partition `EntityMetadataItem` children by the measured maximum priority and omit the
      overflow trigger when the hidden partition is empty.
- [x] Wrap inline and overflow lanes in `ControlGroup controlSize="sm"`; remove local height,
      padding, type, and icon metrics from `ENTITY_METADATA_CHIP_CLASS`.
- [x] Remove `RolledUpHealthPill` from Initiative metadata and replace production Initiative
      `verdict` copy with health copy.
- [x] Run the two focused component files and `pnpm --filter @docket/web typecheck`.
- [x] Commit the slice as `fix: Keep visible properties out of header overflow` with a body
      that records container ownership and the single-health decision.

### Task 2: Finish the generic typed view contract

**Files:**

- Create: `domains/work/src/view-contract.ts`
- Create: `domains/work/tests/view-contract.test.ts`
- Modify: `domains/work/package.json`

- [x] Keep the failing type tests for invalid field/operator/operand/layout combinations.
- [x] Implement const-generic field declarations, precomputed predicate unions, recursive boolean
      nodes, arrangements, presentations, drafts, runtime schemas, and deterministic canonicalization.
- [x] Run `pnpm --filter @docket/work exec vitest run tests/view-contract.test.ts --maxWorkers=2`
      and `pnpm --filter @docket/work typecheck`.
- [x] Commit the slice as `feat: Define typed work-view queries`.

### Task 3: Instantiate all four entity contracts

**Files:**

- Create: `packages/types/src/work-view.ts`
- Create: `packages/types/tests/work-view.test.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/saved-view.ts`
- Modify: `packages/types/src/hub-preferences.ts`

- [x] Keep type tests that reject cross-target status keys, Initiative boards, Program timelines,
      invalid contexts, and read-only group mutations.
- [x] Declare the complete Task, Project, Program, and Initiative field catalogs and target layouts.
- [x] Add symbolic actor/date operands, ranks, target cursors, canonical query fingerprints,
      instance keys, definitions, rows, facets, ordering requests, defaults, and saved-view schemas.
- [x] Add v1-to-v2 saved-view migration and preference-precedence domain tests.
- [x] Run focused Types tests plus `pnpm --filter @docket/types typecheck`.
- [x] Commit the slice as `feat: Close work views over every planning level`.

### Task 4: Add compatible storage and migration

**Files:**

- Modify: `packages/db/src/schema/work.ts`
- Modify: `packages/db/src/schema/joins.ts`
- Modify: `packages/db/src/schema/crosscutting.ts`
- Modify: `packages/db/src/types.ts`
- Create: the next numbered SQL migration under `packages/db/drizzle/`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/tests/schema/work-view-schema.test.ts`
- Test: `packages/db/tests/migrations/work-view-migration.test.ts`

- [x] Write failing schema and migration tests for Project priority, primary/multiple teams,
      members, Initiative lead team, shared ranks, v2 saved views, defaults, and personal state.
- [x] Add tables and columns without removing `project.teamId` or legacy saved-view columns.
- [x] Generate the migration, add primary-edge and v1-definition backfills, and assert additive
      deployment against fresh and existing fixtures.
- [x] Run focused DB tests, schema typecheck, and migration validation.
- [x] Commit the slice as `feat: Store typed work views and shared ordering`.

### Task 5: Compile authorized server queries

**Files:**

- Create: `apps/api/src/lib/work-views/contracts.ts`
- Create: `apps/api/src/lib/work-views/authorization-sql.ts`
- Create: `apps/api/src/lib/work-views/context-sql.ts`
- Create: `apps/api/src/lib/work-views/filter-sql.ts`
- Create: `apps/api/src/lib/work-views/temporal-sql.ts`
- Create: `apps/api/src/lib/work-views/sort-sql.ts`
- Create: `apps/api/src/lib/work-views/group-sql.ts`
- Create: `apps/api/src/lib/work-views/group-query-sql.ts`
- Create: `apps/api/src/lib/work-views/projection-sql.ts`
- Create: `apps/api/src/lib/work-views/project-team-sql.ts`
- Create: `apps/api/src/lib/work-views/relation-sql.ts`
- Create: `apps/api/src/lib/work-views/cursor.ts`
- Create: `apps/api/src/lib/work-views/query.ts`
- Test: `apps/api/tests/work-views/query.test.ts`
- Test: `apps/api/tests/work-views/compiler.test.ts`
- Test: `apps/api/tests/work-views/query-plan.test.ts`
- Test support: `apps/api/tests/work-views/request-fixtures.ts`
- Test: `apps/api/tests/work-views/scalar-relations.test.ts`
- Test: `apps/api/tests/work-views/tenant-relations.test.ts`
- Test: `apps/api/tests/work-views/cursor.test.ts`

- [x] Write SQL integration cases for each operator family, nested logic, authorization, relation
      `EXISTS`, semantic/null ordering, fan-out groups, ancestor closure, and cursor continuation.
- [x] Define field compiler maps with `satisfies` against each target's derived keys.
- [x] Apply authorization before filters, counts, grouping, and keyset pagination.
- [x] Bind cursor fingerprints to the canonical query, group path, sort tuple, and entity id.
- [x] Run focused API integration tests, raised-heap API typecheck, and changed-file lint.
- [x] Commit the slice as `feat: Query authorized typed work views`.

### Task 6: Expose query, facet, ordering, default, and saved-view routes

**Files:**

- Create: `apps/api/src/routes/work-views.ts`
- Modify: `apps/api/src/routes/orgs.ts` so the work-view routes retain the organization context
  middleware instead of bypassing it through direct `apps/api/src/app.ts` registration
- Modify: existing saved-view route and service files found under `apps/api/src/routes/`
- Test: `apps/api/tests/routes/work-views.test.ts`
- Test: existing saved-view route tests

- [x] Write contract tests for all four query/result variants, typed facets, reorder rejection,
      default permissions, contextual attachment, and legacy response compatibility.
- [x] Add the four `/v1/orgs/:orgId/work-views/*` operations and migrate saved-view persistence.
- [x] Reject computed/read-only reorder groups and route mutable drops through canonical mutations.
- [x] Enforce owner and Team visibility, scope-specific sharing invariants, and the validated v2
      Task-to-legacy compatibility projection on every saved-view operation.
- [x] Keep group mutations and rank writes atomic, require `assign` for assignment drops, preserve
      canonical status side effects, and clear nullable groups without leaking database errors.
- [x] Apply manual rank within equal explicit priority values, compile truthful options for every
      filterable facet field, and bind facet and query cursors to their complete execution identity.
- [x] Run focused route tests, API lint, and API typecheck.
- [x] Commit the slice as `feat: Expose typed work-view operations`.

**Evidence:** The Types contract suites pass 10 tests. The API query-engine suites pass 33 tests,
the typed route suite passes 26 tests, and the shared group-route suite passes 29 tests. Empty
query and facet cursors fail with application-owned `400` responses. Saved Team visibility joins
both membership and Team ownership to the saved-view organization. Task and Project label drops
resolve only against tenant-valid owning Teams. Task mutations require subject-level `contribute`,
and assignment drops also require subject-level `assign`. Task milestone drops use the canonical
Project compatibility check. Cross-Team Task drops use the canonical state-transition writer with
the destination Team's default status and derived terminal timestamps; same-Team drops change only
rank. Initiative order membership authorizes only the exact item and neighbor ids, then reverse
walks their context ancestry without materializing the query-page roster. Rank candidates are
validated before writes, so an exhausted 128-character tail triggers the same bounded 16/32/64
neighborhood rebalance and retry. A separate 50,000-row test caps changed ranks at 129 and proves
signed-cursor continuation. Foreign-owned Initiative nodes remain context-readable but reject
context-organization property writes, and label clearing carries the join tenant. V2-only Task
definitions remain authoritative. A definition that the legacy algebra cannot express receives a
guaranteed no-match legacy filter, and legacy filter patches reject it instead of erasing v2 state.
Each facet request accepts exactly one field and removes only that field's predicate while the
response distinct count keeps the original effective filter. Date options use `YYYY-MM-DD`, and
datetime options use canonical UTC ISO values without truncating PostgreSQL's six fractional
digits; the returned absolute operand selects the original row. Compatible legacy patches replace
only filter and arrangement while preserving the v2 layout, properties, density, and empty-group
presentation. Project, Program, and Initiative saved views store and emit the same guaranteed
no-match Task projection for rollback clients. Typed reads and updates preserve their target
definitions, while legacy patches remain invalid. Independently authorized relation catalogs include
searchable zero-count options when other filters produce an empty roster. The catalogs exclude
private entities that the caller cannot read. Initiative catalogs use an unfiltered authorized
context universe, so foreign parent, owner, lead Team, Label, organization, and status options
remain available at zero count. Each option, including the status name, resolves through its owner
organization. Query and facet routes resolve the same session Hub
timezone and bind it into cursor identity. Relation-many order requests carry source and destination
memberships, including an empty destination, so Label and Project Team moves preserve unrelated
memberships. Project Team moves keep exactly one primary edge aligned with `project.team_id` when
that compatibility field is non-null. Removing the primary promotes the lexically first remaining
Team, while removing the last membership clears the scalar and every primary edge. Relation
catalogs apply search, continuation, and the page limit before materialization. The one-field request
cap keeps facet execution to one bounded bucket statement. A stable
organization/target/context advisory lock serializes each rank transaction. Occupied candidates
then allocate distinct positions for overlapping moves. Fresh validation passes
12 Types contract tests, 33 query-engine tests, 41 typed route tests, and 35 shared group-route tests.
The clean API declaration build and 16 core transport tests pass. The built RPC contract retains
typed query, facet, order, default, saved-view v2, and Hub personal view-state inputs and outputs.
Organization-default reads and writes leave runtime response validation to the shared output
serializer. Corrupt stored or returned rows therefore produce the application-owned `500` problem
without exposing Zod field paths.
The consuming web typecheck and response-union contract preserve canonical Hub preference identity
and allow legacy Task callers to validate the discriminated saved-view response without a cast.
Named Hono routes keep Zod wire inputs separate from parsed handler values. RPC callers can omit
defaulted query, facet, order-context, saved-view scope, and schema-version fields while responses
retain their exact target-discriminated types.
Both typechecks, changed-file lint, and whitespace validation pass.

### Task 7: Build the shared web view controller and toolbar

**Files:**

- Create: `apps/web/src/components/work-views/use-work-view.ts`
- Create: `apps/web/src/components/work-views/work-view-toolbar.tsx`
- Create: `apps/web/src/components/work-views/filter-builder.tsx`
- Create: `apps/web/src/components/work-views/sort-builder.tsx`
- Create: `apps/web/src/components/work-views/display-controls.tsx`
- Create: `apps/web/src/components/work-views/view-state.ts`
- Test: `apps/web/tests/work-views/view-state.test.ts`
- Test: `apps/web/tests/work-views/work-view-controller.test.ts`
- Test: `apps/web/tests/work-views/work-view-toolbar.test.tsx`
- Test: `apps/web/tests/work-views/work-view-types.test.ts`

- [x] Write failing precedence, reset, draft, multi-sort, property, and responsive-overflow tests.
- [x] Implement URL refinement over saved/default filters and personal presentation/arrangement
      overrides over saved/default definitions.
- [x] Keep incomplete editor state in `FilterDraft`; parse before applying or saving.
- [x] Use named MD3 type roles, semantic colors, `ControlGroup`, and shared primitives only.
- [x] Run focused controller/toolbar tests plus web typecheck and lint.
- [x] Commit the slice as `feat: Add one controller for typed work views`.

The controller keeps URL refinement separate from its durable definition, validates every API
response and filter draft through the shared Zod contract, and deletes personal state on reset. The
controller also binds facet reads to the active definition, context, URL refinement, search, and
viewer timezone. Facets use typed cursor pagination, retain names for active relation operands, and
load named actor and relation choices without exposing their stored ids. The controller keys local
state by target and view instance, ignores stale query data during switches, and serializes personal
preference writes so edit/reset races cannot restore an older override. The recursive editor uses
named facet options with counts, multi-value and range operands, absolute datetime conversion,
symbolic date operands, and node-local all, any, and not groups while incomplete drafts remain
non-executable. Stable draft-node identities keep not wrappers attached to their nodes when siblings
are inserted or removed.
Generic component contracts keep definitions, filter fields, sort fields, layouts, contexts,
results, and setters tied to one target. The toolbar keeps Filter and Save view visible, assigns
lower-priority controls to one exact responsive partition, and renders only hidden controls in
overflow. Narrow overflow actions open usable inline controls instead of unanchored popovers. Active
filters reopen as seeded drafts, and the property catalog uses button-list keyboard semantics with
focus restoration. Fresh validation passes the focused web tests, the web typecheck, changed-file
lint, and whitespace checks.

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
- [ ] Commit the slice as `feat: Render typed work views across supported layouts`.

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
- [ ] Commit the page switch as `feat: Replace flat rosters with typed work views`.

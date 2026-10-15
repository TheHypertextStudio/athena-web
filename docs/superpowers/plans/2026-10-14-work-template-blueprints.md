# Work-template Blueprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use subagent-driven-development only when explicitly authorized for execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and maintain bounded reusable work trees through the existing identity/version and creation paths, preserving authored work and scheduler/client compatibility.

**Architecture:** `domains/work` plans immutable, fully resolved blueprint snapshots without database access. One API transaction owner resolves authorization and versions, calls the pure planner, and writes through extractions of existing writers; recurrence and public clients are adapters to that service. Existing row provenance and per-date bindings replace process execution mappings, while a staged retained-data migration preserves the scheduler and historical reads.

**Tech Stack:** TypeScript, existing Zod contracts, Drizzle/PostgreSQL and standard migration runner, existing Hono/OpenAPI/RPC contract, typed TanStack Query definitions, shared `@docket/ui`, Vitest and repository Playwright/dev-stack verification.

**Spec:** [Work-template blueprints](../../engineering/specs/work-template-blueprints.md). The [approved overview](../specs/2026-09-14-work-templates-overview-design.md) remains the governing product model.

## Global constraints

- One creation may produce at most **500 new rows including the root and Milestones**; publish checks all optional children and creation rechecks current nested publications.
- Published versions never change. Missing historical blueprint JSON parses as empty without rewriting that JSON.
- Children are created with the root in one transaction. Completion-relative timing delays dates, not work existence.
- No literal person/team/placement/cycle/absolute-date references in a reusable definition. Parent rules, creation context and schedule-specific overrides resolve them. Existing tenant-scoped label references remain the documented exception.
- Every normal work row has a same-kind/same-workspace template and version; Milestones have provenance but no template.
- No automatic title/body overwrite, manual-date overwrite, child deletion, or completed/canceled work update.
- Manual, REST/MCP, import, connector, plan and scheduler writers share one creation path, existing authorization, provenance and undo. No second DAO, notification engine, scheduler or migration journal.
- Program default schedules, Program Schedules UI, gallery/cross-workspace install and Athena authoring proposals are outside this layer.
- No complexity ledger additions/increases, disabled tests, placeholder execution, interim delivery push, PR, or merge commit. Use the required atomic staging and commit protocol.

## Review focus

1. Same template used twice with the same local step keys must create separate rows and dates; an ordinary same-name row must never absorb generated work (Tasks 1,4,5).
2. A child publication or calendar/permission edit between preview and accept must either preserve the reviewed exact tree or reject all changes, including under serializable retries (Tasks3,5,7).
3. An edited nested due date must survive an outer anchor move while other nested dates still reflow; clearing a date by hand is also an override (Tasks2,6).
4. An old process with multiple roots, literal assignments, pending when-ready steps and retained occurrence retries must migrate once without losing destinations or creating duplicates (Tasks3,9).
5. Hidden descendants, inactive actors, teamless Program context and archived nested references must preserve privacy and produce actionable previews without partial work (Tasks5,7,8).

No new review round is requested by this plan. Each task includes a narrow self-review; root arranges independent review at the final layer boundary.

---

### Task 0: Publish the reviewed contract before source changes

**Files:** Create `docs/engineering/specs/work-template-blueprints.md`; create `docs/superpowers/plans/<execution-date>-work-template-blueprints.md`; update `docs/WORKLOG.md` and relevant engineering index links.

**Interfaces:** Consumes the reviewed private specification and this sequence. Produces the repository specification and active worklog plan that every implementation task references.

- [x] Review and publish the specification before implementation source edits.
- [x] Record scope, paths, migration/compatibility consequences and acceptance checklist in WORKLOG; keep private recovery transcripts out of public documentation.
- [x] Confirm the layer-1 journal ends at 0153; reserve 0154/0155 for blueprint expansion/enforcement, subject to a final concurrent-journal check.
- [x] Publish the accepted documentation before source changes; commit it in the integration sequence without mixing unfinished implementation.

### Task 1: Define and validate the blueprint graph

**Files:** Create `domains/work/src/contracts/work-template-blueprint.ts`, `domains/work/src/blueprints/graph.ts`, `domains/work/src/blueprints/expand.ts`, `domains/work/tests/work-template-blueprint-contract.test.ts`, `domains/work/tests/work-template-blueprint-graph.test.ts`; modify `domains/work/src/{ids.ts,contracts/work-template.ts,package.json}`.

**Interfaces:** Produces `Blueprint`, `BlueprintStep`, `BlueprintDependency`, `BlueprintDateRule`, `ResolvedBlueprintGraph`, `PlannedWorkTree`; `validateBlueprintGraph(input: ResolvedBlueprintGraph): void`; `expandBlueprint(input: ResolvedBlueprintGraph, choices: readonly OptionalChoice[]): ExpandedBlueprint`. Graph inputs contain exact immutable publications, no lookup callback or database handle.

- [ ] Add named failing tests: `accepts_only_kind_matched_steps_and_milestones_under_projects`; `rejects_literal_actor_team_placement_dates_and_unknown_fields`; `qualifies_repeated_child_template_keys_without_collisions`; `detects_template_identity_cycle_across_different_versions`; `rejects_containment_dependency_and_date_prerequisite_cycles`; `rejects_selected_consumer_of_skipped_optional_prerequisite`; `counts_root_and_milestones_at_500_and_rejects_501`; `validates_all_optional_children_at_publication`; `inline_base_identity_does_not_expand_base_children_but_explicit_reference_does`; `parses_old_definition_without_rewriting_snapshot`.
- [ ] Run `pnpm --filter @docket/work exec vitest run tests/work-template-blueprint-contract.test.ts tests/work-template-blueprint-graph.test.ts`; verify the missing behavior fails before implementation.
- [ ] Implement strict discriminated contracts, deterministic DFS/topological traversal, cycle-path reporting and early bounded counting. Export through explicit domain package subpaths; avoid importing full Task/Template models into the leaf identity contract.
- [ ] Run the focused tests, work-domain typecheck and scoped lint. Self-review keys, graph scope, optional closure, bounds and error privacy; commit only after the coherent delivery passes validation.

### Task 2: Plan rules, dates, diffs and capture without database access

**Files:** Create `domains/work/src/blueprints/{rules,dates,diff,capture}.ts`, `domains/work/src/template-merge.ts`; modify the web `templates/merge.ts` to re-export the pure helper; tests `domains/work/tests/work-template-blueprint-{rules,dates,diff,capture}.test.ts`.

**Interfaces:** Consumes Task 1 types. Produces `planBlueprint(input: ResolvedBlueprintInput): PlannedWorkTree`, `reflowBlueprint(input: BlueprintReflowInput): readonly PlannedDateChange[]`, `diffBlueprint(input: BlueprintDiffInput): BlueprintDifference[]`, `captureBlueprint(input: CapturableWorkTree): CapturedTemplateDraft`. Inputs include authorized parent snapshots, completion facts, exact day calendar/timezone and existing per-field bindings. Planner never allocates IDs, reads a clock or writes.

- [ ] Write RED examples with exact results: Thursday2026-10-08 minus21 calendar days =2026-09-17; Friday2026-10-09 plus1 Mon–Fri working day =Monday2026-10-12; negative working offsets cross weekend; zero stays on a weekend; following Monday from Monday is seven days later unless inclusive; leap-day/DST arithmetic does not depend on host timezone.
- [ ] Add RED cases for absent Project anchor, dated Milestone→Task intermediate anchor, nested Task due-anchor reflow, latest of three completed siblings, canceled sibling never satisfying completion, predecessor reopening, root no team and required Task team, Program.ownerId vs Task.assigneeId, inactive Athena resolving unassigned, current-cycle team/window validation, multiple cycle matches refused.
- [ ] Add preservation cases: manual null/date markers; accept new due rule but retain old start rule; terminal child immutable; hand-added same-name child never matched; removed ever-started child not cancellable after status reset; inline independent Save-as capture with literal refs removed and unresolved date warnings; description append once and heading names intact.
- [ ] Implement pure rule/date/diff/capture functions using the existing civil-date helpers extracted into work with a compatible planning re-export; do not add a cyclic work→planning dependency. Store each accepted date rule independently rather than treating root version as proof that every child/date was adopted.
- [ ] Run all four new suites plus existing merge/identity/plan-domain tests affected by extraction. Work-domain types/lint and web merge tests must pass; no API/database checks are needed for this task.

### Task 3: Add persisted invariants and the ordered migration checkpoint

**Files:** New `packages/db/src/schema/work-template-blueprint.ts`, `work-template-blueprint-backfill.ts`, frozen `work-template-blueprint-migration/{schema,definitions,work,recurrence}.ts`; modify `schema/{work-template,work,identity,recurrence}.ts`, schema exports, `migrate-work-templates.ts`, `migration-prefix.ts`; generate actual next journal SQL/snapshots. New DB tests `work-template-blueprint-{schema,migration,interruption}.test.ts` and real-PG migration fixture/cases following existing DB tooling.

**Interfaces:** Consumes Task 1 persisted contracts without making historical migrations import live contracts. Produces `blueprintStep`, `blueprintDependency`, typed work provenance/date bindings/root state, workspace working weekdays, canonical series selection and occurrence root pointers; `backfillWorkTemplateBlueprints(database, options): Promise<BlueprintBackfillResult>` with unique source-revision receipts and bounded resumable batches. Existing `migrateWithWorkTemplateCheckpoint` becomes an ordered composition of the old identity and new blueprint checkpoints, retaining its exported caller contract.

- [ ] Write RED schema tests for foreign tenant/kind/step-version references, duplicate projection keys, unsupported manual date keys, immutable version/step/dependency rows and legal workspace purge. Test restricted-role RLS separately from owner connections.
- [ ] Write RED runner tests proving final layer-1 apply-all cannot skip blueprint conversion; test DBs paused before identity expansion, between identity expansion/enforcement, after identity enforcement and after blueprint expansion. Assertions include unchanged historical migration hashes and journal correctness.
- [ ] Build a retained fixture: personal/team drafts with private image bodies; published/archived types; four-kind work with manual dates; single-task process; Project-root process; multi-root process; literal actor/team/cycle specs; partial when-ready occurrence; existing generated rows and occurrence keys. The frozen mapper must preserve audits/assignments, mark uncertain dates manual and dedupe by source revision.
- [ ] Implement expand→checkpoint→enforce, conservative marker backfill and immutable projection installation. Do not install guards that require rows before the checkpoint creates them. An untranslatable/oversized graph blocks checkpoint rather than truncating or publishing stale/private content.
- [ ] Prove interruption after committed batch, rerun after success, older-ID late insert, stale definition/scheduler write refusal and enforcement failure without journal advancement on real PostgreSQL. Test full fresh journal too. PGlite schema tests supplement rather than replace these runs.
- [ ] Keep old process/scheduler tables and necessary authoring/mapping projections operational; execution cutover waits until Task9's adapter exists and retirement waits for layer3 verification. Coordinate all API tests serially while stack is stopped; do not seed or start runtime during DB checks.

### Task 4: Extract ordinary work writers with behavior parity

**Files:** New `apps/api/src/lib/work-creation/{service,writers,context,effects}.ts`; modify `routes/{tasks,projects,programs,initiatives}.ts`, `lib/organize/place.ts`, `plan-draft/commit.ts`, `milestone-writes.ts`, `work-template-creation.ts`, `provenance/record-created.ts`. Tests `apps/api/tests/lib/work-creation-parity.test.ts` plus existing route/placement/plan tests.

**Interfaces:** Produces `WorkCreationCommand`, `WorkCreationResult`, `WorkCreationBatchCommand`, `WorkCreationBatchResult`, `ResolvedWorkInsert`, `InsertedWork`, `insertWorkRow(tx,input)`, `createWork(command)`, `createWorkInTransaction(tx,command)`, `createWorkBatchInTransaction(tx,command)` exactly as the spec. The trusted batch entry validates all roots/cross-root edges and the aggregate500 cap before any insert; no fabricated visible parent is created. Row insertion never recurses/expands and never does semantic name matching; plan placement can choose a matching existing row before calling it. `WorkCreationResult` carries root/created IDs, one change-set ID and deferred effects; public routes still serialize their existing ordinary response.

- [ ] First add parity tests pinning current four-kind create validation, statuses, labels, membership/privacy, Project Milestones/Initiative links, image subjects, provenance, output identity, failure behavior and postcommit effects. Run against pre-extraction source and retain passing evidence.
- [ ] Extract transaction-aware inserts/effects from existing routes/placement rather than copying them into a second writer. Existing status/label/reference/Milestone helpers accept the caller transaction; no pooled-client await inside it. Keep existing match-or-create plan behavior outside the insert dispatcher.
- [ ] Add RED transaction tests: root/last Milestone failure rolls back all; external enclosing plan transaction can roll back creation; equal-name explicitly created rows remain distinct; effect failure after commit returns the committed receipt and never duplicates work.
- [ ] Route the four manual create endpoints and plan/MCP placement through the new entry points with empty blueprint semantics initially. Run focused parity/route/plan tests, API typecheck/lint and existing recurrence identity tests once. No compiler/complexity debt relaxation.

### Task 5: Resolve and apply blueprint creation everywhere

**Files:** New `apps/api/src/lib/work-template-blueprints/{resolve,context,apply,preview}.ts`; modify `work-template-{creation,selection}.ts`, `templates/{persistence,service,projection,write}.ts`, definition/create contracts/routes and Task4 service. Adapt every current new-row file in the spec's writer inventory; extend web `composer/work-template-picker.tsx`, `template-application-preview.tsx`, `use-template-contribution.tsx`, `use-template-application.ts`, `work-template-draft.ts`, four kind-specific draft codecs/create-body builders/create dialogs for persisted optional choices; update shared MCP capture/organize/template tools. Tests `apps/api/tests/routes/work-template-blueprint-creation.test.ts`, `tests/lib/work-template-blueprint-resolver.test.ts`, and writer-family cases in existing suites.

**Interfaces:** Consumes Task 1/2 planner and Task4 inserts. Produces `resolveBlueprintClosure(tx,selection,mode): Promise<ResolvedBlueprintGraph>`, `loadBlueprintCreationContext(tx,command): Promise<BlueprintCreationContext>`, `applyBlueprintPlan(tx,context,plan): Promise<WorkCreationResult>` and creation-preview contract/endpoint including authorized `blueprint.creationTeamId` fallback for teamless container contexts. API/private modes derive legacy/schedule archive privileges from trusted binding, never request booleans.

- [ ] Write RED: nested latest resolves once per request; pinned version stays exact; archived nested historical edge works but new archived root selection fails; foreign/private/wrong-kind child template never leaks; latest child grows500→501 after parent publication and root transaction is refused; latest child loop appears after parent publication and creation refuses.
- [ ] Write RED: optional subtree unchecked creates none of its rows; selected dependency of omitted optional step refuses; Milestone Task placement correct; same local keys/names in two nested instances create separate rows; Program fallback team required and private root visibility preserved; root omitted identity expands a customized base.
- [ ] Implement closure/context resolution, sorted definition locking, pure planning and parent-order application. Persist all exact versions, origins and per-date bindings; write ordinary edges after IDs exist. Creation preview and accept use exact fingerprints; root title/body/manual values remain authored.
- [ ] Adapt each **new row** path: REST four kinds, MCP organize/capture/content, accepted plan, email acceptance, automation routing, calendar links, timer anchors, voice/elicitation/agent dispatch, integration reconcile/import/Notion. Existing-row sync updates do not call expansion. Keep existing route/MCP return contracts; add optional blueprint choices only.
- [ ] Test one nonempty base blueprint through each writer family, not merely omitted identity on a blank base. Test REST idempotency, MCP/change-set replay, connector dedupe and plan retry after child publication return the original tree.
- [ ] Record one change set, extend existing tracked/undo support for Milestones, and aggregate assignment notices per assignee while retaining each task automation trigger. Last-child/edge/image failure leaves no root/receipt; undo respects later user edits. Run focused suites and API/domain types/lint/build declarations.

### Task 6: Reflow dates atomically with ordinary work mutations

**Files:** New `apps/api/src/lib/work-template-blueprints/reflow.ts`; modify ordinary four-kind date PATCH handlers, `milestone-writes.ts`, `task-state.ts`, calendar anchor-update adapter, work output contracts and typed mutation definitions. Tests `apps/api/tests/routes/work-template-blueprint-dates.test.ts`, `tests/lib/work-template-blueprint-completion.test.ts`.

**Interfaces:** `reflowBlueprintDates(tx,input: BlueprintReflowCommand): Promise<BlueprintReflowResult>` consumes Task 2 dates and persisted field bindings. `markExplicitDateOverrides(tx,input)` only marks keys actually present in an authorized mutation. A typed follow-template-date choice clears one marker after preview. Both are invoked inside the existing write transaction before commit.

- [ ] Add RED community-dinner sequence: no anchor→undated children; set Oct8→Book venue Sep17; pin nested Pay deposit date; move root toOct15→all other managed dates move seven days, deposit stays. Include generated Milestone anchor and manually cleared date.
- [ ] Add RED sibling completion cases: after all three report inputs complete, dependent date uses latest completion; duplicate transition does nothing; cancellation does not satisfy; reopening clears only managed nonterminal dependent dates. Existing timers, auto-completed parents and assignment triggers occur once.
- [ ] Add RED explicit same-date/null patches mark manual, provider/manual writes remain preserved, terminal children unchanged, current weekday calendar changes invalidate stale preview, concurrent anchor/manual edit serializes or conflicts without loss, affected descendants above500 refuse whole anchor write.
- [ ] Integrate reflow with existing date resolution/range validators and state helpers. Root anchor change, descendants and receipt commit together; search/events drain afterward. Do not run a loosely ordered background job to perform the authoritative date rewrite.
- [ ] Run focused date/state/ordinary PATCH tests, meaningful real-PG concurrent anchor/manual-write case, and affected types/lint. Keep authoring marker fields read-only in external output/request schemas.

### Task 7: Extend selective update and Change template previews

**Files:** Existing `domains/work/src/contracts/work-template-reference.ts`; API `work-template-{assignment,change-preview}.ts`, `work-template-blueprints/preview.ts`, `routes/work-template-assignment.ts`; web `templates/work-template-identity-queries.ts`, `work-template-identity-control.tsx`, `work-template-change-preview.tsx`. Tests new API `work-template-blueprint-update.test.ts`, extended domain preview contracts and web `work-template-identity-control.test.tsx`.

**Interfaces:** Extends existing preview with `mode` and discriminated bounded `childChanges`; assignment gains `acceptChildChanges: ChangeId[]` default `[]`. Existing `applyFields` stays default off. An update endpoint delegates to the same acceptance service. Matching is source-template identity+qualified path; individual accepted date bindings do not overwrite declined bindings.

- [ ] Write RED: new child and date offset choices individually accepted; removed untouched child kept unless cancellation explicitly selected; ever-started/reset child not cancellable; completed/canceled child/root not updated; hand-added child never matched/deleted; no title/body replacement in update mode.
- [ ] Write RED: Change template retains all existing children and original provenance; new child checkbox can be unticked; old identity-only request adds zero children; existing starting-field request still works; root version can advance with declined differences while another explicit preview still finds them.
- [ ] Write RED stale acceptance for root prose, child manual date, membership, permissions, labels, dependency, nested publication, offerings and weekday change. Assert409 and zero writes. Hidden child names never appear; acceptance must not mutate inaccessible children.
- [ ] Implement strict opaque change IDs and canonical fingerprint/recheck under deterministic locks. All work/child/date/dependency changes and existing status side effects commit once. Preserve reviewed choices as drafts after conflict; fetch fresh preview through typed query definitions.
- [ ] Extend shared dialog with accessible individual checkboxes, grouped subtree summaries/dates, default-off cancellation, warnings and retry. No component-level fetch or parallel mutation path. Focused API/domain/UI tests, refreshed RPC declarations, web types/lint and keyboard interaction checks pass.

### Task 8: Author, archive and capture reusable blueprints

**Files:** New `apps/api/src/lib/work-template-blueprints/capture.ts`; extend `templates/{service,persistence,projection,images}.ts`, canonical definitions and existing work-template routes; web `templates/work-template-authoring.tsx`, `work-template-fields.tsx`, `use-work-template-form.ts`, `work-template-form-draft.ts`, `work-template-queries.ts`, `work-template-settings.tsx`, `work-template-header.tsx`; new `work-template-blueprint-fields.tsx`, `work-template-blueprint-summary.tsx`; Settings `workspace-general-settings.tsx`, the existing workspace General page, web/API organization contracts and `routes/orgs.ts` for working weekdays. Tests API `work-template-blueprint-capture.test.ts`, `work-template-blueprint-publication.test.ts`, web `work-template-blueprint-authoring.test.tsx`.

**Interfaces:** `captureWorkTemplate(tx,input: CaptureWorkTemplateCommand): Promise<PrivateTemplateDraftResult>`; authorized archive-impact query; publication preview carries refreshed pinned versions+revision; workspace `workingWeekdays` contract/admin write. Save-as preview/create joins the existing draft service and image-subject persistence.

- [ ] RED capture tests: copied edited/generated/manual children are independent inline steps; same-day offsets and no-anchor warnings; literal person/team/cycle removed; only internal sibling dependencies retained; >499 descendants and hidden descendants refuse faithful capture; inaccessible images never copied; result personal/unpublished and source unchanged.
- [ ] RED publication/archive tests: concurrent draft edits/pin-refresh mismatch conflict; pinned update availability; child archive keeps existing parent expansion/schedule valid but cannot be newly selected; uses prevent destructive deletion; archive impact pagination does not expose invisible schedule names; legacy template edit preserves blueprint and an unreviewed canonical draft.
- [ ] Implement normal sample-item child authoring, relative-date controls, actor/team/cycle rule controls, optional defaults, nested same-kind chips and dependency editing using shared primitives. Inline description preserves heading contracts; no new property/condition engine.
- [ ] Add admin weekday settings with nonempty unique Monday–Friday default and typed query invalidation. Wire Save as template from each kind to preview/private draft/sample editor, no implicit publish. Keep guided creation reachable and old canonical authoring APIs compatible.
- [ ] Run focused publication/capture/authoring/General settings tests, types and lint. Reuse existing image and draft tests; avoid a new image store or authoring DAO.

### Task 9: Cut recurrence execution over without replacing its scheduler

**Files:** Existing `lib/recurrence/{process-definition,materialize,series,authoring,recurring-task,calendar-binding,record-materialized}.ts`, `contracts/recurrence.ts`, recurrence routes, MCP repeating/template tools, schema/checkpoint converter from Task 3; new `lib/recurrence/work-template-adapter.ts`. Tests `apps/api/tests/recurrence/work-template-blueprint-compatibility.test.ts`, affected existing MCP/routes/recurrence suites and real-PG converted-run fixture.

**Interfaces:** `materializeTemplateOccurrence(tx,input: TemplateOccurrenceCommand): Promise<MaterializedOccurrence>` calls `createWorkInTransaction` or its trusted forest/batch adapter under the existing occurrence lock/unique key, with the shared aggregate500 cap. `legacyProcessToTemplate(input)` produces canonical template + restricted invocation/schedule overrides and retained ID/key projections. No independent process work inserter remains active. Legacy multi-root invocation retains every original root/destination, with no new visible Program parent; existing mapping projections are mirrored from the canonical result until layer3 verification.

- [ ] RED single-task repeat against base identity, Project process with Milestone/subtasks, multi-root retained process, old output keyed maps/instance IDs, schedule literal-step assignments, retained private invocation presets, paused/resumed series and generated-work backlinks.
- [ ] RED recurrence duplicate/late/out-of-order calendar deliveries, old occurrence key on new series revision, missed/skip/horizon/timezone behavior and archived-template schedule continuity. Calendar move changes root anchor and managed child dates through Task6.
- [ ] RED partial when-ready migration: existing rows/prose/manual dates unchanged, outstanding rows created once in cutover, completion timing subsequently dates existing rows, rereading legacy maps returns same IDs. Explicitly pin the documented all-at-once replacement of lazy physical row creation.
- [ ] Implement compatibility adapters over canonical service; retain cadence/exception/calendar/sweep implementations. Stop legacy blueprint execution writers. Do not add Program Schedules/default-schedule/gallery UI. Retain old scheduler/definition tables and necessary mapping/authoring projections until layer3 verifies their retirement, with forward-only migration recovery and source mappings. Do not make required compatibility writes read-only prematurely.
- [ ] Activate Task 3 checkpoint/enforcement only with this adapter available. Run real-PG retained full-journal and converted replay tests, then focused related API/MCP/recurrence suites serially. Failure blocks release; no source truncation or silent partial conversion.

### Task 10: Verify the complete layer and document its boundaries

**Files:** New `apps/web/e2e/work-template-blueprints.spec.ts`; focused fixtures use existing E2E API helpers. Update public specification/README/OpenAPI and WORKLOG acceptance; audit only necessary writer/retirement documentation.

**Interfaces:** Consumes all task interfaces. Produces final source-state evidence for pure/domain, DB migration/RLS, API compatibility, UI/runtime and built artifacts; no claim that local source proves production.

- [ ] Run affected package graph with repository Turbo tasks; execute only gaps not already proven at the final source state. API tests require stopped/reset stack and the shared API test mutex. Required lint/complexity/type checks cannot use new exemptions.
- [ ] Build API declarations/runtime and web artifact; check legacy RPC/client shapes and migration startup ordering. Public spec includes final exact paths/contracts, semantic when-ready migration change and later-layer exclusions.
- [ ] Follow `docs/engineering/ui-verification.md`, start the existing stack, authenticate/seed through existing tools and run the spec's community-dinner, Partnership Milestone, fundraising Initiative and three-sibling report journeys. Verify optional children, missing anchor, pinned nested version refresh, selective update/cancellation, concurrent stale review, Change template and private Save-as.
- [ ] Verify keyboard-only authoring/checklists and narrow/wide both themes; offline/reconnect retains prose/choices and requires re-preview; live revocation blocks writes. Save captures and acceptance notes once. Stop stack/reset shared DB before any later API tests.
- [ ] Complete source self-review against D10–D22,D40–D50 and every public spec section; root obtains proportionate independent final review. Fix substantive findings with regressions, then integrate linearly under the root's authorized delivery procedure. No intermediate diagnostic push or PR.

## Coverage and sequence audit

- Contracts/hierarchy/loops/dependencies/optional cap: Tasks 1,2,3,5.
- Nested latest/pinned versions and archive continuity: Tasks3,5,7,8,9.
- Parent/team/actor/cycle rules and no row references: Tasks 1,2,5,8,9.
- Date-only working weekdays/snaps, missing/Milestone anchors, sibling completion, manual dates: Tasks2,3,6,8.
- Immutable source provenance, partial adoption, replay/undo/notifications: Tasks3–7,9.
- Selective update/Change template, Save as template, archive/sample authoring: Tasks7,8,10.
- Standard migration ordering, legacy backfill/process semantics, real PG and restricted-role RLS: Tasks3,9,10.
- Existing REST/MCP/scheduler and all writer families share creation: Tasks4,5,9,10.

The public specification governs the implementation tasks above. Each completed task records its validation in the worklog; private recovery records retain execution evidence.

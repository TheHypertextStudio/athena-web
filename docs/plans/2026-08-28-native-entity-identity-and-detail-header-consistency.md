# Native Entity Identity and Detail Header Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give every Docket-owned, user-addressable entity a custom icon and color while fixing the audited Project, Program, and Initiative detail-page failures.

**Architecture:** Keep `entity_display` as the one decoupled presentation store. Expand it through a total subject registry instead of adding icon and color columns to every domain table. Keep `EntityDetailLayout` as the one masthead shell, then add opt-in adaptive section tabs, shared URL tab state, hierarchy-only Initiative context, and shared print composition.

**Tech Stack:** TypeScript, Zod, Drizzle, PostgreSQL/PGlite, Hono, Next.js, React, TanStack Query, Docket UI primitives, Vitest, and Playwright.

---

This plan is for the Docket implementation team. Execute the tasks in order, preserve existing user data, and stop before a production write or deployment until the release owner approves it.

## Product decisions

Use one `entity_display` relation for decorative identity. Do not add icon and color columns to Project, Program, Task, Cycle, Milestone, Team, Initiative, or every other domain table.

The subject registry must classify every organization-scoped native entity as `customizable`, `semantic`, `avatar`, `external`, or `virtual`. No native type may disappear because someone forgot an allowlist entry.

The initial customizable set is Initiative, Program, Project, Task, Cycle, Milestone, and Team. Label and Work Status receive decorative identity while retaining their semantic color in badges, filters, and workflow controls. A custom blue Task must not imply an in-progress status. An external calendar event, avatar, attachment, and virtual Initiative root retain their own explicit policy.

Project ownership remains a separate `ProjectPeopleRow`. That is an intentional composition difference. Program, Project, and Initiative keep distinct section sets because they model different work.

The Initiative eyebrow represents a real, visible parent only. A root Initiative has no generic collection breadcrumb. The initial aggregate must carry a child Initiative's visible direct-parent reference.

At compact widths, section tabs never wrap, clip, or create page overflow. The selected section and highest-priority sections stay visible. The rest move into a named overflow menu.

## Rejected designs

Do not add icon and color fields to each table. That duplicates validation, migrations, defaults, and list projection logic.

Do not use a client-only identity map. It fails for API consumers, lists, search, and reloads.

Do not place a generic “back to collection” breadcrumb on every detail page. It adds height without relationship context.

Do not use horizontal scrolling or wrapping for detail tabs. A controlled overflow menu keeps every section reachable and honors the existing no-wrap contract.

## Task 1: Define the complete presentation-subject contract

**Files:**

- Modify: `packages/types/src/entity-display.ts`
- Modify: `apps/web/src/lib/actions/object.ts`
- Create: `packages/types/tests/entity-display.test.ts`
- Modify: `apps/api/tests/routes/entity-display.test.ts`
- Review: `apps/api/src/routes/orgs.ts`

**Step 1: Write the failing type-contract test.**

Add a table-driven test that requires an explicit presentation policy for every persisted, organization-scoped Docket entity in the route and interaction registries. Cover Initiative, Program, Project, Task, Cycle, Milestone, Team, Label, and Work Status. Require virtual, external, and avatar-backed references to declare why they do not create a display row.

**Step 2: Run it and confirm the failure.**

Run:

```sh
pnpm --filter @docket/types test -- tests/entity-display.test.ts
```

Expected: the current three-value `EntityDisplaySubjectType` fails the complete-policy assertion.

**Step 3: Implement the pure typed registry.**

Replace the three-value enum and subject-specific branches with a total registry in `@docket/types`. It must define the persisted subject type, default icon, default color resolver, and presentation policy. Preserve the current Initiative, Project, and Team defaults. Preserve Team's deterministic color resolver.

**Step 4: Keep semantic and virtual policies separate.**

Do not add `initiative_root`, `calendar_slot`, or other synthetic IDs as `entity_display` subjects. Keep Label and Work Status swatches semantic. Their decorative icon and color render beside an entity title rather than replacing the existing meaning.

**Step 5: Verify and commit.**

Run:

```sh
pnpm --filter @docket/types test -- tests/entity-display.test.ts
pnpm --filter @docket/types typecheck
pnpm --filter @docket/api test -- tests/routes/entity-display.test.ts
```

Commit:

```text
feat: Define universal entity presentation subjects
```

## Task 2: Widen persistence and make the display API exhaustive

**Files:**

- Modify: `packages/db/src/schema/crosscutting.ts`
- Create: `packages/db/tests/migrations/entity-display-subjects-migration.test.ts`
- Generate: `packages/db/drizzle/<next>_*.sql`
- Generate: `packages/db/drizzle/meta/<next>_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `apps/api/src/routes/entity-display.ts`
- Modify: `apps/api/tests/routes/entity-display.test.ts`

**Step 1: Write the migration test.**

Start a PGlite database at the migration immediately before the new SQL. Insert existing Initiative, Project, and Team display rows. Apply the new migration. Prove the existing rows survive and each new customizable subject can insert a valid display row.

**Step 2: Run the failing migration test.**

```sh
pnpm --filter @docket/db test -- tests/migrations/entity-display-subjects-migration.test.ts
```

Expected: the current `entity_display_subject_type_check` rejects a new subject.

**Step 3: Update schema and generate migration.**

Derive the subject-type check from the typed registry. Generate the next Drizzle migration:

```sh
pnpm --filter @docket/db db:generate
```

The migration must widen the check without deleting or backfilling display rows. Add an icon check only when Task or Cycle needs a new stable catalog key.

**Step 4: Make API table mapping total.**

Expand `SUBJECT_TABLE` in `apps/api/src/routes/entity-display.ts` for every persisted customizable type. Keep database table mapping in the API package and defaults in `@docket/types`. Reuse normal resource visibility policies so the display API cannot enumerate hidden records.

**Step 5: Add parameterized route coverage.**

For every customizable subject, prove GET default, PUT icon/palette/custom hex, bulk list, reset, cross-workspace rejection, malformed input rejection, and `contribute` enforcement.

**Step 6: Verify and commit.**

```sh
pnpm --filter @docket/db test -- tests/migrations/entity-display-subjects-migration.test.ts
pnpm --filter @docket/api test -- tests/routes/entity-display.test.ts
pnpm --filter @docket/db typecheck
pnpm --filter @docket/api typecheck
```

Commit:

```text
feat(api): Support custom presentation for native entities
```

## Task 3: Repair Project–Initiative aggregate and mutation state

**Files:**

- Modify: `packages/types/src/detail-aggregate.ts`
- Modify: `packages/types/src/project.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `packages/db/src/schema/joins.ts`
- Generate: `packages/db/drizzle/<next>_*.sql`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`
- Modify: `apps/web/src/lib/use-project-mutations.ts`
- Modify: `apps/web/src/lib/use-initiative-mutations.ts`
- Modify: `apps/web/src/components/actions/entity-navigation-actions.ts`
- Modify: `apps/api/tests/routes/detail-aggregates.test.ts`
- Modify: `apps/api/tests/routes/projects-detail.test.ts`
- Modify: `apps/web/tests/lib/use-project-mutations.test.ts`
- Create: `apps/web/e2e/work/project-initiative-associations.spec.ts`

**Step 1: Write aggregate and mutation failures.**

Seed a Project linked to Initiatives A and B. Require the aggregate to return only `references.initiatives` in deterministic name/id order. Start with `[A, B]`, replace with `[B, C]`, and prove the join rows become exactly `[B, C]`. Cover duplicates, `[]`, omission, and a missing or foreign ID that preserves the original set.

**Step 2: Prove the current break.**

```sh
pnpm --filter @docket/api test -- tests/routes/detail-aggregates.test.ts tests/routes/projects-detail.test.ts
```

Expected: the aggregate omits links, the route passes `initiativeIds={[]}`, and the mutation reads the obsolete cache.

**Step 3: Extend the bounded aggregate.**

Add strict `ProjectInitiativeReference` values with `id` and `name`. Add `references.initiatives` to `ProjectDetailAggregate`. Query only joined Initiatives for this Project after the Project row resolves. Do not put relationships on `ProjectOut` or send the organization-wide Initiative roster.

**Step 4: Make Project PATCH replace associations atomically.**

Add optional `initiativeIds` to `ProjectUpdate`. Omission leaves links untouched. An array replaces the complete set. `[]` removes all links. Validate every incoming Initiative before deleting the current set, then replace links inside the existing transaction.

**Step 5: Repair client cache and picker composition.**

Derive picker values from aggregate references instead of passing an empty list. Merge aggregate references into closed-picker options so names render before the full roster loads. Replace the sequence of Initiative POST/DELETE calls with one Project PATCH. Optimistically replace `aggregate.references.initiatives`, roll back the exact prior aggregate, delete the legacy `ProjectDetailData` cache path, and invalidate Project, Initiative, list, and portfolio families after settlement.

**Step 6: Add the index-only migration.**

Add an index on `(organization_id, project_id, initiative_id)` to `initiative_project`. Generate the migration and prove it rewrites no data.

**Step 7: Add local browser proof.**

Use a disposable local account. Verify A appears on first paint, add B and reload, remove A and reload, then capture wide and 390px screenshots.

**Step 8: Verify and commit.**

```sh
pnpm --filter @docket/api test -- tests/routes/detail-aggregates.test.ts tests/routes/projects-detail.test.ts
pnpm --filter @docket/web test -- tests/lib/use-project-mutations.test.ts
pnpm --filter @docket/web test:e2e -- e2e/work/project-initiative-associations.spec.ts
```

Commit:

```text
fix(projects): Preserve Initiative associations on detail pages
```

## Task 4: Add adaptive detail section tabs

**Files:**

- Modify: `packages/ui/src/primitives/tabs.tsx`
- Modify: `packages/ui/src/primitives/index.ts`
- Modify: `apps/web/src/components/views/entity-detail-layout.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`
- Create: `packages/ui/tests/primitives/tabs.test.tsx`

**Step 1: Write the failing primitive test.**

Use the five Initiative labels at a constrained width. Assert that visible tabs do not wrap, hidden tabs appear in a named menu, the selected tab stays visible, and selecting a hidden section promotes it into the inline row. Add a compatibility assertion for normal `Tabs` consumers.

**Step 2: Run the test.**

```sh
pnpm --filter @docket/ui test -- tests/primitives/tabs.test.tsx
```

Expected: the current unbounded `inline-flex` track has no controlled overflow behavior.

**Step 3: Implement opt-in overflow mode.**

Add optional `priority` to `TabsItem` and an optional overflow configuration. Use `ResizeObserver` to measure available inline width. Keep the selected tab and highest-priority sections visible. Render the rest in a fixed `More <entity> sections` menu.

Hidden sections must be menu items, not hidden `role="tab"` controls. Selecting one must update controlled state and promote it into the visible track. Keep Arrow, Home, and End behavior correct for visible tabs. Do not alter default behavior for non-detail tabs.

**Step 4: Make the shared layout safe.**

Make the `detail-tabs` lane `min-w-0`. Do not hide overflow on the entire masthead because the overflow menu must remain usable.

**Step 5: Apply and verify.**

Set explicit priorities on each audited route. Keep Overview and the selected section visible.

```sh
pnpm --filter @docket/ui test -- tests/primitives/tabs.test.tsx
pnpm --filter @docket/ui typecheck
pnpm --filter @docket/web typecheck
```

Commit:

```text
fix(ui): Keep detail sections reachable on compact screens
```

## Task 5: Standardize tab URLs and Initiative hierarchy context

**Files:**

- Create: `apps/web/src/components/views/use-detail-tab.ts`
- Create: `apps/web/tests/components/views/use-detail-tab.test.tsx`
- Modify: `packages/types/src/detail-aggregate.ts`
- Modify: `apps/api/src/routes/initiative-aggregates.ts`
- Modify: `apps/api/tests/routes/detail-aggregates.test.ts`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`
- Modify: `apps/web/tests/components/initiative-visual-contract.test.ts`
- Create: `apps/web/tests/lib/detail-route-policy.test.ts`

**Step 1: Write URL and aggregate failures.**

Test valid and invalid `?tab=` values for every audited entity. Test unrelated parameters, omission for Overview, reload behavior, and no scroll jump.

Seed root and child Initiatives. Require the child aggregate to include only a visible direct parent and parent-link id. Require the root to carry no parent context. Require an inaccessible parent to remain absent.

**Step 2: Run the failures.**

```sh
pnpm --filter @docket/api test -- tests/routes/detail-aggregates.test.ts
pnpm --filter @docket/web test -- tests/components/views/use-detail-tab.test.tsx tests/lib/detail-route-policy.test.ts
```

**Step 3: Implement one URL-state hook.**

Build `useDetailTab` with `useAppPathname`, `useAppSearchParams`, `useAppRouter`, and `useImmediateUrlState`. It validates allowed values, preserves unrelated parameters, calls `router.replace(..., { scroll: false })`, and omits `tab` for Overview.

Use it in Initiative, Program, and Project. Keep deferred requests gated by selected panel.

**Step 4: Resolve the parent in the initial Initiative aggregate.**

Extend `InitiativeDetailAggregate.references` with a bounded direct-parent reference and parent-link id. Reuse relationship visibility checks. Do not fetch children, connected work, labels, resources, or a roster merely to draw the masthead.

Render an eyebrow only when a visible parent exists. Remove the unconditional `All initiatives` link. Use this aggregate fact in the object-action metadata too.

**Step 5: Verify and commit.**

```sh
pnpm --filter @docket/api test -- tests/routes/detail-aggregates.test.ts
pnpm --filter @docket/web test -- tests/components/views/use-detail-tab.test.tsx tests/lib/detail-route-policy.test.ts tests/components/initiative-visual-contract.test.ts
```

Commit:

```text
fix(ui): Align detail navigation with hierarchy context
```

## Task 6: Standardize print composition

**Files:**

- Create: `apps/web/src/components/views/detail-print-summary.tsx`
- Modify: `apps/web/src/components/views/entity-detail-layout.tsx`
- Modify: `packages/ui/src/styles/globals.css`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`
- Modify: `apps/web/tests/components/entity-detail-layout.test.tsx`

**Step 1: Write print contract tests.**

Under print media, require all three routes to show title, summary, static metadata, and Overview document content. Forbid Publish, overflow actions, editable icon picker controls, tablists, and operational panels. A URL such as `?tab=tasks` must still print Project Overview.

**Step 2: Run the failure.**

```sh
pnpm --filter @docket/web test -- tests/components/entity-detail-layout.test.tsx
```

Expected: only Initiative has a print summary and print CSS.

**Step 3: Extract one print slot.**

Add `printSummary` to `EntityDetailLayout` and create a small static `DetailPrintSummary` component. Move Initiative's route-local helper and global style into the shared component/style layer. Each route supplies model-specific static values only.

**Step 4: Verify and commit.**

```sh
pnpm --filter @docket/web test -- tests/components/entity-detail-layout.test.tsx
pnpm --filter @docket/web typecheck
```

Commit:

```text
fix(ui): Print consistent entity detail briefs
```

## Task 7: Add the universal identity picker to detail headers

**Files:**

- Create: `apps/web/src/components/entity-display/use-entity-display.ts`
- Modify: `apps/web/src/components/entity-display/entity-icon-picker.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx`
- Modify: `apps/web/src/components/project-detail/project-milestones.tsx`
- Create: `apps/web/tests/components/entity-display/use-entity-display.test.tsx`

**Step 1: Write parameterized header tests.**

Cover Initiative, Project, Team, Program, Task, Cycle, and Milestone. Test defaults, authorized picker opening, icon/palette/custom-hex mutation, reset, app-owned error recovery, and invalidation of individual and bulk display query keys.

**Step 2: Run the failure.**

```sh
pnpm --filter @docket/web test -- tests/components/entity-display/use-entity-display.test.tsx
```

Expected: Program, Task, Cycle, and Milestone lack the shared picker.

**Step 3: Extract the client display hook.**

Move duplicated Initiative, Project, and Team GET/optimistic PUT behavior into `useEntityDisplay`. Preserve lazy loading if it prevents unnecessary reads. Revalidate detail and type-wide keys after a write.

**Step 4: Wire every header without replacing semantics.**

Program replaces its fixed Layers icon. Task retains `TaskHeaderControls`. Cycle retains its lifecycle signal. Milestone retains deadline semantics. The custom glyph belongs beside the title and never replaces status or lifecycle glyphs.

**Step 5: Verify and commit.**

```sh
pnpm --filter @docket/web test -- tests/components/entity-display/use-entity-display.test.tsx
pnpm --filter @docket/web typecheck
```

Commit:

```text
feat(ui): Customize identity across native detail pages
```

## Task 8: Compose identity through lists, cards, pickers, and search

**Files:**

- Modify: `apps/api/src/lib/work-views/projection-sql.ts`
- Modify: `packages/types/src/work-view.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Modify: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/routes/cycles.ts`
- Modify: `apps/api/src/routes/milestones.ts`
- Modify: `apps/api/src/search/query.ts`
- Modify: `packages/types/src/search.ts`
- Modify: `apps/web/src/components/work-views/work-list.tsx`
- Modify: `apps/web/src/components/work-views/work-cards.tsx`
- Modify: `apps/web/src/components/work-views/program-work-card.tsx`
- Modify: `apps/web/src/components/programs/program-list-ui.tsx`
- Modify: `apps/web/src/components/cycles/cycle-row.tsx`
- Modify: `apps/web/src/components/teams/team-list-ui.tsx`
- Modify: `apps/web/src/components/views/task-table.tsx`
- Modify: `apps/web/src/components/pickers/options.tsx`
- Modify: `apps/web/src/components/pickers/use-composer-options.ts`
- Modify: `apps/web/src/components/command-palette/use-hub-search.ts`
- Modify: `apps/web/src/components/search/search-client.tsx`
- Add focused tests beside each projection and renderer.

**Step 1: Write projection and renderer failures.**

For each entity family, customize an icon/color and assert it appears in a detail header, dense list/card, reference picker, and search result. Assert a list of N entities uses one bulk display read rather than N detail reads.

**Step 2: Compose display after visibility filtering.**

Extend typed work-view and search projections for Program, Task, Cycle, and Milestone. Compose display after permission filtering. Do not serialize display choices into `search_document`, because presentation updates must appear immediately without reindexing.

**Step 3: Keep decorative identity beside semantic signals.**

Use `EntityIconGlyph` where an entity is named. Keep Label swatches and Work Status badges semantic. Keep `OBJECT_DESCRIPTORS` as the static fallback for generic references that lack composed display metadata.

**Step 4: Verify and commit.**

Run the new focused API and Web tests, then:

```sh
pnpm --filter @docket/api typecheck
pnpm --filter @docket/web typecheck
```

Commit:

```text
feat(web): Show custom identity across entity references
```

## Task 9: Restore confirmed overview composition

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/program-detail-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx`
- Review/compose: `apps/web/src/components/project-detail/agents-strip.tsx`
- Review/compose: `apps/web/src/components/project-detail/agent-activity-feed.tsx`
- Review/compose: `apps/web/src/components/project-detail/project-dependencies.tsx`
- Review/compose: `apps/web/src/components/programs/flow-snapshot.tsx`
- Review/compose: `apps/web/src/components/initiatives/initiative-relationship-panels.tsx`
- Add route/component tests for the confirmed Overview contract.

**Step 1: Confirm the specification before moving UI.**

Compare `docs/core/mvp-plan.md` with current product direction. The route code currently renders only the document in all three Overview panels, while the product plan describes Project progress/agents/activity/dependencies, Program flow, and Initiative connected-work rollups. Do not treat a stale document as permission to ship a different product.

**Step 2: Write tests for the confirmed composition.**

Keep the document central. Require Project Overview to include progress, agents, activity, and dependencies. Require Program Overview to include health and flow without false completion percentage. Require Initiative Overview to include connected-work rollups without becoming a Task container.

**Step 3: Reuse existing focused components and bounded aggregates.**

Compose existing components where their current contract matches. Extend aggregates only with bounded, permission-filtered data required on first paint. Do not add a second free-form header or duplicate a tab-level summary.

**Step 4: Verify and commit as a separate product slice.**

Run new route/component tests and narrow-width screenshots. Do not merge this slice until its product contract is confirmed.

## Task 10: Run visual, accessibility, and release gates

**Files:**

- Modify or replace: `apps/web/e2e/work/project-detail-header-evidence.spec.ts`
- Create: `apps/web/e2e/work/entity-detail-header-evidence.spec.ts`
- Modify: `apps/web/tests/components/initiative-visual-contract.test.ts`
- Modify: `apps/web/tests/components/projects/projects-experience-contract.test.ts`
- Create: `apps/web/tests/components/programs/program-detail-header-contract.test.ts`
- Update: `docs/WORKLOG.md`

**Step 1: Parameterize disposable local evidence.**

Use local PGlite accounts only. Cover Initiative, Program, and Project at 1440×900, 760×900, 480×844, 390×844, 360×800, and 320×720. Capture light and dark screenshots at 1440 and 390.

**Step 2: Assert the responsive contract.**

At every viewport, assert no document horizontal overflow, no second header action row, 40px non-wrapping visible tabs, a visible selected section, in-viewport overflow menus, and keyboard access to every section. For custom color, assert accessible names, readable contrast treatment, and unchanged Task/Label/Status semantic indicators. Test print media for all three pages.

**Step 3: Run focused checks.**

```sh
pnpm --filter @docket/types test -- tests/entity-display.test.ts tests/detail-aggregate.test.ts
pnpm --filter @docket/db test -- tests/migrations/entity-display-subjects-migration.test.ts
pnpm --filter @docket/api test -- tests/routes/entity-display.test.ts tests/routes/detail-aggregates.test.ts tests/routes/projects-detail.test.ts
pnpm --filter @docket/web test -- tests/components/entity-display/use-entity-display.test.tsx tests/components/views/use-detail-tab.test.tsx tests/components/entity-detail-layout.test.tsx tests/components/initiative-visual-contract.test.ts tests/components/projects/projects-experience-contract.test.ts tests/components/programs/program-detail-header-contract.test.ts tests/lib/use-project-mutations.test.ts
E2E_EVIDENCE=1 pnpm --filter @docket/web test:e2e -- e2e/work/entity-detail-header-evidence.spec.ts e2e/work/project-initiative-associations.spec.ts
```

**Step 4: Run bounded repository gates.**

```sh
pnpm exec turbo run typecheck --concurrency=2
pnpm exec turbo run lint --concurrency=2
pnpm exec turbo run test --concurrency=2 -- --maxWorkers=2
pnpm exec turbo run build --concurrency=2
git diff --check
```

Run `~/.claude/resource-limits/agentctl status` before broad test/build commands. Do not rerun an exit-137 job unchanged.

**Step 5: Complete the visual audit and release only with approval.**

Run the Docket Craft Rubric at 1440×900 and 390×844 in both themes. Record a scorecard and screenshot paths. Verify a linear history before integration. A production deploy requires explicit approval and a fresh authenticated browser round trip.

## Completion criteria

The work is complete only when every Docket-owned, user-addressable entity has an explicit presentation policy, every customizable entity can round-trip icon and custom color through the generic API, and no existing display customization changes unexpectedly.

The Program, Project, and Initiative headers must share identity, actions, metadata behavior, navigation behavior, and print composition while preserving their intentional domain-specific fields and sections. Initiative tabs must remain reachable at 320px without wrapping or clipping. Project–Initiative links must render and replace atomically. Child Initiative context must be correct on first paint.

The final evidence must distinguish disposable local proof from any later approved production verification.

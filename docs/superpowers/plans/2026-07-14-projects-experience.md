# Projects Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved dense Project overview and progressively disclosed Project detail using
the Initiative experience's production structure and the existing Project domain capabilities.

**Architecture:** Extend the typed Project rollup and joins instead of adding client waterfalls.
Compose one Project operating view from the existing typed query layer, dependency routes, display
metadata, and portfolio timeline primitives. Keep Project detail document-first and place secondary
properties behind the existing property system plus one compact disclosure.

**Tech Stack:** TypeScript, React 19, Next.js App Router, TanStack Query, Hono, Zod, Drizzle,
Tailwind, Vitest, Testing Library, Playwright.

## Global Constraints

- Reads and writes use `apiQueryOptions`, `useApiQuery`/`useApiListQuery`, and `useApiMutation`.
- Project participants are one visual set; do not label lead and contributors separately.
- Project descriptions clamp to two lines in rosters and remain freeform Markdown on detail.
- Use rounded Material icons and 40px icon-only targets.
- Preserve unrelated local changes, including `apps/web/e2e/helpers/calendar-ui.ts`.
- Keep history linear and Conventional Commit messages atomic.

---

### Task 1: Project aggregate contracts

**Files:**

- Modify: `packages/types/src/project.ts`
- Modify: `packages/types/src/attachment.ts`
- Modify: `packages/db/src/schema/joins.ts`
- Modify: `packages/db/src/schema/crosscutting.ts`
- Create: generated migration under `packages/db/drizzle/`
- Modify: `apps/api/src/routes/project-rollup.ts`
- Create: `apps/api/src/routes/project-resources.ts`
- Modify: `apps/api/src/routes/projects.ts`
- Test: `apps/api/tests/routes/project-rollup.test.ts`
- Test: `apps/api/tests/routes/projects-detail.test.ts`
- Test: `packages/db/tests/initiative-experience-schema.test.ts`

**Interfaces:**

- Produces `ProjectRollupOut.initiativeIds`, `ProjectRollupOut.resources`,
  `ProjectRollupOut.labels`, and `ProjectRollupOut.display`.
- Produces typed URL resource list/create/delete routes under `/projects/:id/resources`.
- Produces `project_label` and accepts `labelIds` in Project update.

- [ ] Write failing contract, schema, and route tests for multiple Initiative ids, Project Labels,
      URL resources, and default display metadata.
- [ ] Run the focused suites and confirm failures identify the missing fields/tables/routes.
- [ ] Implement the Zod contracts, joins, aggregate queries, resource router, and generated migration.
- [ ] Run focused type, database, and API suites until green.
- [ ] Commit as `feat(projects): add aggregate project metadata`.

### Task 2: Project mutation and query model

**Files:**

- Modify: `apps/web/src/lib/fetch-project-detail.ts`
- Modify: `apps/web/src/lib/use-project-detail-page.ts`
- Modify: `apps/web/src/lib/use-project-mutations.ts`
- Modify: `apps/web/src/components/project-detail/properties-panel.tsx`
- Test: `apps/web/tests/components/project-detail/project-properties-panel.test.tsx`
- Create: `apps/web/tests/lib/project-detail-data.test.ts`

**Interfaces:**

- Produces `initiativeIds: readonly string[]`, resource/label/display data, unified participant
  options, and add/remove mutations that preserve unrelated Initiative links.

- [ ] Write failing tests for multiple Initiative associations, Project health, labels, resources,
      and participant deduplication.
- [ ] Run focused tests and confirm the singular `currentInitiativeId` behavior fails them.
- [ ] Update the detail fetcher/hook and optimistic mutation layer.
- [ ] Replace the singular Initiative property control with a multi-association control and add
      health/label editing through the existing property patterns.
- [ ] Run focused tests until green.
- [ ] Commit as `feat(projects): support rich project properties`.

### Task 3: Project operating overview

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx`
- Modify: `apps/web/src/components/projects/project-catalog.ts`
- Create: `apps/web/src/components/projects/project-display-icon.tsx`
- Create: `apps/web/src/components/projects/project-dependency-view.tsx`
- Create: `apps/web/src/components/projects/project-timeline-view.tsx`
- Create: `apps/web/src/components/projects/project-view-switcher.tsx`
- Test: focused component and visual-contract tests under `apps/web/tests/components/projects/`

**Interfaces:**

- Consumes the existing Project, task, member, display, and dependency typed reads.
- Produces shared List/Dependencies/Timeline lenses driven by one URL-backed view state.

- [ ] Write failing tests for the plain page header, actionable attention item, lens switching,
      stable two-line rows, 40px controls, local medium-width scrolling, and shared view settings.
- [ ] Run the focused suites and observe the existing single-table surface fail.
- [ ] Implement the Initiative-aligned page shell, list rows/icons, view switcher, graph lens, and
      timeline lens without generic card clusters or decorative totals.
- [ ] Verify keyboard behavior and responsive layout in tests.
- [ ] Commit as `feat(projects): add operating overview lenses`.

### Task 4: Progressive Project detail

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx`
- Extract/modify: `apps/web/src/components/initiatives/initiative-document.tsx`
- Create: `apps/web/src/components/project-detail/project-header.tsx`
- Create: `apps/web/src/components/project-detail/project-info-popover.tsx`
- Create: `apps/web/src/components/project-detail/resources-tab.tsx`
- Modify: `apps/web/src/components/project-detail/tabs.tsx`
- Test: focused Project detail component and visual-contract tests.

**Interfaces:**

- Consumes the rich detail hook from Task 2.
- Produces Overview/Tasks/Updates/Resources tabs with a shared Markdown document component.

- [ ] Write failing tests for no Print/back controls, unified people, health/target-only primary
      metadata, anchored Project info disclosure, Resources tab isolation, and compact tab overflow.
- [ ] Run focused tests and confirm the current oversized header/right-rail layout fails.
- [ ] Implement the Initiative-aligned detail shell and progressive disclosure.
- [ ] Keep existing progress, milestone tasks, agents, activity, dependencies, updates, and task
      composer behavior functional inside the new tab structure.
- [ ] Run focused tests until green.
- [ ] Commit as `feat(projects): rebuild project detail experience`.

### Task 5: Validation and closeout

**Files:**

- Modify: `docs/core/mvp-plan.md`
- Modify: `docs/engineering/specs/data-layer.md`
- Modify: `docs/WORKLOG.md`
- Create: Project design review and screenshots under the repository's established audit location.

- [ ] Run the Docket design review at desktop/mobile in light/dark and fix P0/P1 findings.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Confirm `git rev-list --merges --count origin/main..HEAD` prints `0`.
- [ ] Update the spec, product docs, worklog completion, and retrospective with measured results.
- [ ] Commit documentation as `docs(projects): document the projects experience`.

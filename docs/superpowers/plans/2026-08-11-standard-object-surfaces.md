# Standard Object Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Initiative hierarchy editable without drag while standardizing object interaction,
relationship tabs, compact detail identity, and Athena-free entity page chrome.

**Architecture:** A zero-wrapper `ObjectSurface` composes the existing `ObjectRef`, DOM identity,
and drag hook so containers cannot implement only part of object behavior. An Initiative action
domain and one hierarchy picker route both menus and explicit hierarchy editing through the same
mutation functions used by drag. `EntityDetailLayout` and a standard object row own shared visual
geometry.

**Tech Stack:** Next.js App Router, React 19, TypeScript, TanStack Query, Hono client, Vitest,
Testing Library, Tailwind CSS.

## Global Constraints

- No visible drag handles.
- Tabs do not display decorative collection counts.
- Core identity targets are 40px in expanded and compact layouts.
- UI errors use application-owned copy rather than provider or exception text.
- All API reads and writes use the typed TanStack Query layer and typed API client.
- Preserve unrelated worktree changes.

---

### Task 1: Shared object surface and row

**Files:**

- Create: `apps/web/src/components/objects/object-surface.tsx`
- Create: `apps/web/src/components/objects/object-list-row.tsx`
- Test: `apps/web/tests/components/object-surface.test.tsx`
- Test: `apps/web/tests/components/object-list-row.test.tsx`

**Interfaces:**

- Consumes: `ObjectRef`, `objectTargetProps`, `useDraggable`.
- Produces: `ObjectSurface({ object, dragDisabled, surfaceId, children })` and
  `ObjectListRow({ object, href, icon, title, description, trailing })`.

- [ ] Write a component test that renders a real child button inside `ObjectSurface`, verifies the
      root carries the object identity and drag payload, and verifies the nested button still runs.
- [ ] Run the focused test and observe failure because `ObjectSurface` does not exist.
- [ ] Implement the zero-wrapper Slot composition and merge drag classes without rendering a
      handle.
- [ ] Write and fail a row test that requires a 40px identity target, navigation, object identity,
      and right-click eligibility.
- [ ] Implement `ObjectListRow` using `ObjectSurface` and semantic link composition.
- [ ] Run both focused tests to green.

### Task 2: Initiative hierarchy action domain

**Files:**

- Create: `apps/web/src/components/initiatives/initiative-actions.ts`
- Create: `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx`
- Create: `apps/web/src/components/initiatives/initiative-hierarchy-mutations.ts`
- Modify: `apps/web/src/components/pickers/picker-overlay.tsx`
- Modify: `apps/web/src/components/actions/action-domains-provider.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
- Test: `apps/web/tests/initiatives/initiative-hierarchy-mutations.test.ts`
- Test: `apps/web/tests/actions/initiative-actions.test.tsx`

**Interfaces:**

- Produces: `moveInitiative({ orgId, initiative, parent })`,
  `detachInitiative({ orgId, initiative })`, and picker requests with `mode: 'parent' | 'child'`.
- The roster drag-end path consumes the same mutation functions as the action domain.

- [ ] Write literal-fixture tests for create, move, detach, self, and no-op hierarchy plans.
- [ ] Run the tests and observe failure because the shared mutations do not exist.
- [ ] Extract the typed hierarchy operations from the roster drag handler.
- [ ] Write and fail an action-domain test for Open, Change parent, Add sub-initiative, and Move to
      top level visibility.
- [ ] Register the Initiative domain and extend the global picker overlay with a searchable
      hierarchy request.
- [ ] Wrap Initiative roster rows in `ObjectSurface` and route drops through the shared operation.
- [ ] Run focused hierarchy and action tests to green.

### Task 3: Initiative relationship tabs and shared detail geometry

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`
- Modify: `apps/web/src/components/views/entity-detail-layout.tsx`
- Modify: `packages/ui/src/styles/globals.css`
- Test: `apps/web/tests/components/entity-detail-collapse-contract.test.ts`
- Test: `apps/web/tests/initiatives/initiative-detail-tabs.test.tsx`

**Interfaces:**

- Consumes: `ObjectListRow` and Initiative picker requests from Tasks 1 and 2.
- Produces: count-free `subinitiatives` and `work` panels and compact shared header geometry.

- [ ] Write a route/component test that selects Sub-initiatives and Connected work and observes
      navigable, object-stamped rows instead of Overview sections or tab counts.
- [ ] Run it and observe the existing bespoke Overview containers fail the contract.
- [ ] Move both collections into dedicated tabs and render standard object rows.
- [ ] Extend the collapse geometry test to require a 40px compact identity and no residual
      collapsed-secondary grid gap.
- [ ] Run it and observe the current 0.6 glyph scale and header gaps fail.
- [ ] Group identity and secondary context into one masthead track, retain the full-size compact
      icon, reserve a 48px title inset, and give tabs one small intentional gap.
- [ ] Run focused detail tests to green.

### Task 4: Remove redundant entity Athena actions and validate

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx`
- Modify: `docs/WORKLOG.md`
- Test: affected detail component tests.

**Interfaces:**

- Leaves global Athena entry points and `AthenaContextMenuItem` available.
- Removes only visible detail-page `AthenaContextAction` instances.

- [ ] Remove the three entity detail action imports and render sites.
- [ ] Run focused component tests for Initiative, Project, Task, shared object surface, and detail
      collapse.
- [ ] Run `pnpm --filter @docket/web typecheck` and affected lint checks.
- [ ] Capture expanded and compact Initiative detail at desktop and narrow widths in a real browser.
- [ ] Move the WORKLOG task to completed with exact validation evidence and learning.
- [ ] Commit the complete feature slice with a substantive `fix(web)` Conventional Commit body.

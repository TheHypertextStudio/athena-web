# Collapsed Navigation Recents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the three most recently visited document icons in the collapsed navigation rail.

**Architecture:** Extend the route-aware open-documents provider with an independent per-user MRU
list. Pass the resulting `OpenTab` descriptors through the shell adapter to an icon-only rail
section.

**Tech Stack:** React, TypeScript, sessionStorage, Vitest, Testing Library, Playwright, Tailwind.

**Spec:** `docs/plans/2026-08-28-collapsed-navigation-recents-design.md`

## Global Constraints

- The complete collapsed shell region remains no wider than 80px.
- Daily rail destinations remain 64 by 60 with a 56 by 32 state layer.
- Recent document shortcuts use 40 by 40 targets and expose their title to assistive technology.
- The recent list holds at most three documents and is scoped to the signed-in account session.

---

### Task 1: Track recent document navigation

**Files:**

- Modify: `apps/web/src/components/tabs/open-documents.tsx`
- Test: `apps/web/tests/components/tabs/recent-documents.test.tsx`

**Interfaces:**

- Produces: `OpenDocumentsValue.recentDocuments: readonly OpenTab[]`.

- [ ] Write tests that navigate through four detail routes and assert newest-first order, a
      three-entry cap, deduplication, persistence, title updates, and retention after tab close.
- [ ] Run the focused test and confirm that `recentDocuments` is missing.
- [ ] Add the per-user MRU state, parser, persistence guard, and synchronized title updates.
- [ ] Run the focused tab tests and confirm that they pass with two workers.

### Task 2: Render recent icons in the collapsed rail

**Files:**

- Modify: `apps/web/src/components/app-shell-frame.tsx`
- Modify: `packages/ui/src/components/shell/Sidebar.tsx`
- Modify: `packages/ui/src/components/shell/NavigationRail.tsx`
- Test: `packages/ui/tests/components/shell/navigation-rail.test.tsx`

**Interfaces:**

- Consumes: `recentDocuments: readonly OpenTab[]`.
- Produces: An accessible `Recent` navigation region with type icons and 40 by 40 targets.

- [ ] Write a failing rail test with two recent descriptors and assert their names, links, icons,
      active state, and target classes.
- [ ] Run the focused UI test and confirm that the Recent region is absent.
- [ ] Pass recent descriptors through the shell and render the bounded icon section.
- [ ] Run the focused shell suites and confirm that they pass with two workers.

### Task 3: Verify the visual contract

**Files:**

- Modify: `apps/web/e2e/shell/navigation-rail-evidence.spec.ts`
- Create: `docs/design/audits/2026-08-28-shell-navigation-states.md`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Consumes: The running HTTP local stack and the collapsed rail.
- Produces: Browser assertions and light and dark desktop and mobile screenshots.

- [ ] Navigate to enough real documents to populate Recent, then assert its 40 by 40 targets.
- [ ] Assert that destination hover and focus paint the 56 by 32 state layer only.
- [ ] Capture 1440 by 900 and 390 by 844 screenshots in light and dark themes.
- [ ] Run UI and Web type checks, focused lint, formatting, the production build, and the commit
      hook before committing the feature.

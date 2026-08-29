# Compact Navigation Rail Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the collapsed rail's six labeled primary destinations from 404px to 356px without changing the rail width, indicator geometry, labels, or interaction states.

**Architecture:** Keep the existing `NavigationRail` component and destination state-layer structure. Change only the primary destination target height and list gap, then enforce those two values in the component and authenticated browser tests. Reuse the existing screenshot suite and design audit instead of creating a parallel density surface.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Testing Library, Playwright, Next.js

---

### Task 1: Lock the compact geometry in tests

**Files:**

- Modify: `packages/ui/tests/components/shell/navigation-rail.test.tsx:57-72`
- Modify: `apps/web/e2e/shell/navigation-rail-evidence.spec.ts:116-139`

- [x] **Step 1: Change the component geometry assertion before production code**

```tsx
expect(destinations).toHaveClass('gap-1');
expect(today).toHaveClass('min-h-14');
```

- [x] **Step 2: Change the browser geometry assertion before production code**

```tsx
expect(boxes.slice(2)).toEqual([
  expect.objectContaining({ width: 64, height: 56 }),
  expect.objectContaining({ width: 56, height: 32 }),
  expect.objectContaining({ width: 40, height: 40 }),
  expect.objectContaining({ width: 40, height: 40 }),
  expect.objectContaining({ width: 32, height: 32 }),
  expect.objectContaining({ width: 40, height: 40 }),
]);
expect(secondDestination.y - (firstDestination.y + firstDestination.height)).toBe(4);
```

- [x] **Step 3: Run the focused component test and verify the expected failure**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-rail.test.tsx --maxWorkers=2
```

Expected: FAIL because the component still contains `min-h-16` and the destination list still contains `gap-1`.

### Task 2: Implement the compact primary destination stack

**Files:**

- Modify: `packages/ui/src/components/shell/NavigationRail.tsx:80-84`
- Modify: `packages/ui/src/components/shell/NavigationRail.tsx:204-207`

- [x] **Step 1: Reduce the primary destination target to 56px**

```tsx
const className = cn(
  'group text-label-medium flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-none px-1 text-center hover:bg-transparent focus-visible:ring-0 focus-visible:outline-none',
);
```

- [x] **Step 2: Keep a grid-aligned gap between primary destinations**

```tsx
<div className="flex flex-col gap-1">
```

- [x] **Step 3: Run the component and shell tests**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-rail.test.tsx tests/components/shell/shell-full.test.tsx --maxWorkers=2
```

Expected: PASS with 56px target and 4px-gap assertions while all state-layer tests remain green.

### Task 3: Verify the rendered rail and refresh evidence

**Files:**

- Modify: `docs/design/audits/screenshots/2026-08-28-shell-navigation-states/*.png`
- Modify: `docs/design/audits/2026-08-28-shell-navigation-states.md`

- [x] **Step 1: Start the API and Web development servers on dedicated worktree ports**

Run the API on `127.0.0.1:4400` and Web on `127.0.0.1:4300` with the worktree's `.env.local` values and matching public URLs.

Expected: `/today` renders through `http://ed87.docket.localhost:4300` without a portless service-name collision.

- [x] **Step 2: Run the authenticated browser evidence test**

Run:

```bash
E2E_BASE_URL=http://ed87.docket.localhost:4300 \
E2E_API_URL=http://ed87.api.docket.localhost:4400 \
pnpm --filter @docket/web exec playwright test \
  e2e/shell/navigation-rail-evidence.spec.ts \
  --project=chromium --workers=1
```

Expected: PASS. The test measures a 64×56 full target, 56×32 indicator, 66px destination
scrollport, 4px inter-item gap, unchanged 80px shell region, unchanged state opacities, and a 3px
focus outline with a 2px offset.

- [x] **Step 3: Inspect the regenerated screenshots**

Inspect the 1440×900 and 1024×900 light and dark rail captures. Confirm that labels remain visible, the primary block is denser, recent shortcuts remain separate, and no horizontal overflow appears.

- [x] **Step 4: Update the audit with measured geometry**

Replace the prior 64×64 evidence with 64×56 evidence. Explain that Docket keeps the M3 indicator,
4px separation, and states while using a denser desktop target.

### Task 4: Run final checks and close the worklog

**Files:**

- Modify: `docs/WORKLOG.md`

- [x] **Step 1: Run focused validation**

Run:

```bash
pnpm exec prettier --check \
  packages/ui/src/components/shell/NavigationRail.tsx \
  packages/ui/tests/components/shell/navigation-rail.test.tsx \
  apps/web/e2e/shell/navigation-rail-evidence.spec.ts \
  docs/design/audits/2026-08-28-shell-navigation-states.md \
  docs/WORKLOG.md
pnpm --filter @docket/ui exec eslint \
  src/components/shell/NavigationRail.tsx \
  tests/components/shell/navigation-rail.test.tsx
pnpm --filter @docket/ui typecheck
pnpm --filter @docket/test-utils exec vitest run \
  tests/design-policies/design-token-policy.test.ts --maxWorkers=2
```

Expected: Every command exits zero. The design policy reports 8 passing tests.

- [x] **Step 2: Complete the worklog entry**

Record the red-green test evidence, browser measurements, screenshot review, and any host-level validation constraint. Move `SHELL-NAV-DENSITY-001` to `COMPLETED` only after all required evidence exists.

- [x] **Step 3: Commit the implementation**

Stage only the component, tests, audit, screenshots, and worklog. Use the declared `ui` scope and a substantive commit body that explains why Docket uses a denser desktop target while retaining the M3 state model.

### Task 5: Restore grid-aligned separation between compact destinations

**Files:**

- Modify: `packages/ui/tests/components/shell/navigation-rail.test.tsx:57-72`
- Modify: `apps/web/e2e/shell/navigation-rail-evidence.spec.ts:116-139`
- Modify: `packages/ui/src/components/shell/NavigationRail.tsx:204-207`
- Modify: `docs/design/audits/2026-08-28-shell-navigation-states.md`
- Modify: `docs/WORKLOG.md`

- [x] **Step 1: Change the component and browser assertions before production code**

```tsx
expect(destinations).toHaveClass('gap-1');
expect(secondDestination.y - (firstDestination.y + firstDestination.height)).toBe(4);
```

- [x] **Step 2: Run the component test and verify the expected failure**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-rail.test.tsx --maxWorkers=2
```

Expected: FAIL because the destination list still contains `gap-0`.

- [x] **Step 3: Restore the 4px destination gap without changing item height**

```tsx
<div className="flex flex-col gap-1">
```

- [x] **Step 4: Run the shell and authenticated browser tests**

Run the two focused UI suites with two workers. Run the authenticated navigation-rail evidence spec with one Chromium worker against the dedicated Web and API ports.

Expected: PASS with 64×56 targets, a 66px destination scrollport, 4px gaps, unchanged 56×32
indicators, unchanged 80px shell width, and unchanged interaction states.

- [x] **Step 5: Refresh and inspect the screenshots**

Inspect the regenerated 1440×900 and 1024×900 rail captures in light and dark themes. Confirm that adjacent primary destinations read as separate controls while the six-item block remains denser than the original 404px layout.

- [x] **Step 6: Update documentation, run final checks, and commit**

Record the 356px primary block in the design audit and complete `SHELL-NAV-DENSITY-SPACING-001` in the worklog. Run formatting, focused lint, UI type checking, the 82 shell tests, the 8 design-policy tests, the authenticated browser evidence test, and the scoped Web production build before committing.

## Recent entity identities

1. Add a failing shell test that requires recent shortcuts to use a host-supplied identity.
2. Add the renderer boundary to `Sidebar` and `NavigationRail` while preserving the generic
   fallback for hosts that do not supply it.
3. Resolve saved Project and Initiative display metadata in the Web shell through
   `useApiQuery`, then render the canonical 32 px `EntityIconGlyph`.
4. Wrap fixed document-type icons in the shared tonal identity circle.
5. Run focused tests, type checking, lint, the production build, and authenticated browser
   evidence. Amend the existing collapsed-rail commit after every check passes.

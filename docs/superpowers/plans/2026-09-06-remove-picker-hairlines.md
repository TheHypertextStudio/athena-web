# Remove picker hairlines implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every horizontal hairline from the entity glyph picker without weakening its
hierarchy, selected state, keyboard behavior, or mobile fit.

**Architecture:** Keep the existing picker structure and semantics. Replace separator borders and
the active-tab underline with spacing, surface tone, and a rounded selected-tab background. Give
the color footer its own tonal surface instead of drawing a rule above it.

**Tech Stack:** React 19, TypeScript, Tailwind design tokens, `@docket/ui`, Vitest, Testing Library,
Playwright.

---

### Task 1: Lock the no-hairline presentation

**Files:**

- Modify: `apps/web/tests/components/entity-icon-picker.test.tsx`
- Test: `apps/web/tests/components/entity-icon-picker.test.tsx`

- [x] **Step 1: Write the failing presentation test**

Add a test that opens the picker and asserts that its search header, tab list, tabs, and color
footer do not contain `border-b`, `border-t`, or pseudo-element underline classes. Give those four
elements stable test identifiers so the assertion does not depend on DOM position.

```tsx
expect(screen.getByTestId('entity-glyph-search-header')).not.toHaveClass('border-b');
expect(screen.getByRole('tablist', { name: 'Glyph catalog' })).not.toHaveClass('border-b');
expect(screen.getByRole('tab', { name: 'Icons' }).className).not.toContain('after:h-0.5');
expect(screen.getByTestId('entity-glyph-color-footer')).not.toHaveClass('border-t');
```

- [x] **Step 2: Prove the test fails against the committed picker**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/entity-icon-picker.test.tsx --maxWorkers=1
```

Expected: The new presentation test fails on the three separator borders and active-tab underline.

### Task 2: Replace lines with hierarchy

**Files:**

- Modify: `apps/web/src/components/entity-display/entity-icon-picker-loaded.tsx`
- Test: `apps/web/tests/components/entity-icon-picker.test.tsx`

- [x] **Step 1: Remove the search and tab-list rules**

Remove `border-b` and `border-outline-variant` from the search header and tab list. Keep their
existing height and focus semantics. Add a small gap between the two controls and the catalog.

```tsx
<label data-testid="entity-glyph-search-header" className="flex h-11 ... px-4">
<div role="tablist" className="flex h-10 shrink-0 gap-1 px-2 pb-1">
```

- [x] **Step 2: Replace the tab underline with a tonal selected state**

Remove the `after:*` underline classes. Apply the existing surface token and rounded shape only to
the selected tab.

```tsx
activeTab === tab && 'bg-surface-container-high text-on-surface rounded-md';
```

- [x] **Step 3: Replace the footer rule with a tonal surface**

Remove `border-t` and `border-outline-variant` from the footer. Use a surface token to group the
footer while preserving the 48-pixel height and 40-pixel color trigger.

```tsx
<div
  data-testid="entity-glyph-color-footer"
  className="bg-surface-container-low flex h-12 ... px-3"
>
```

- [x] **Step 4: Run the focused component tests**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/entity-icon-picker.test.tsx \
  tests/components/entity-display/entity-glyph-picker-model.test.ts \
  --maxWorkers=1
```

Expected: Both files pass all tests.

### Task 3: Replace the review evidence

**Files:**

- Modify: `apps/web/e2e/work/entity-glyph-picker-evidence.spec.ts`
- Modify: `docs/design/audits/2026-09-06-entity-glyph-picker.md`
- Modify: `docs/WORKLOG.md`
- Modify: `docs/design/audits/screenshots/2026-09-06-entity-glyph-picker/*.png`

- [x] **Step 1: Add a browser assertion for the ban**

Assert that the open picker contains no element marked as a horizontal separator and no border or
underline class on the four picker regions. Keep the existing target-size and overflow assertions.

- [x] **Step 2: Build and recapture the five-frame matrix**

Run the bounded production compile and generate commands. Start the documented local API and web
stack. Then run:

```bash
E2E_EVIDENCE=1 \
APP_URL=http://glyph-picker.docket.localhost:1365 \
GLYPH_SESSION=playwright/.auth/glyph-picker-a11y.json \
pnpm --dir apps/web exec playwright test \
  e2e/work/entity-glyph-picker-evidence.spec.ts --workers=1
```

Expected: One browser test passes and replaces all five screenshots.

- [x] **Step 3: Review every screenshot**

Confirm that the search, tabs, content, and footer form one panel without horizontal rules. Confirm
that the selected tab remains obvious in both themes and that the 320-pixel color popover remains
inside the viewport.

- [x] **Step 4: Update the audit and work log**

Record the no-hairline rule, the replacement hierarchy, the browser result, and any limitation in
the September 6 audit and active work-log entry.

### Task 4: Validate and amend the feature commit

**Files:**

- Modify: the existing `feat(ui): Add Linear-parity icons and emoji` commit

- [x] **Step 1: Run focused validation**

Run targeted ESLint, Prettier, the design-token policy test, and `git diff --check`. Expected: every
command exits zero.

- [x] **Step 2: Amend the existing feature commit**

Stage only the picker, tests, documentation, plan, and replacement screenshots. Amend without
changing the approved feature-oriented commit message.

```bash
git commit --amend --no-edit
```

- [x] **Step 3: Verify the approval boundary**

Confirm that the worktree is clean and `git rev-list --merges --count origin/main..HEAD` prints
`0`. Do not push, merge, deploy, or modify `domains/registry.json` before the user approves the new
screenshots.

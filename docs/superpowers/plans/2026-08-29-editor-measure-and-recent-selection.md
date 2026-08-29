# Editor Measure and Recent Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make entity-document surfaces stop at their 75ch text measure and enlarge collapsed recent-item selection to 56x48px.

**Architecture:** Keep the shared 75ch prose limit in `FreeformTextEditor` and make `EntityDocument` use that same measure plus its 32px horizontal padding as the desktop grid track. Keep recent entity identity at 32px while the shared rail owns the larger selection target.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Testing Library.

---

### Task 1: Lock the geometry in failing tests

**Files:**

- Modify: `apps/web/tests/components/projects/projects-experience-contract.test.ts`
- Modify: `packages/ui/tests/components/shell/navigation-rail.test.tsx`

- [x] **Step 1: Write the failing document geometry contract**

Add these expectations to `uses full-width heading-free documents and canonical MD3 prose hierarchy`:

```ts
expect(document).toContain('@4xl:grid-cols-[minmax(0,calc(75ch+2rem))_11rem]');
expect(document).toContain('grid min-w-0 flex-1 gap-4');
expect(document).toContain('max-w-[calc(75ch+2rem)]');
expect(document).toContain('max-w-[75ch]');
expect(document).not.toContain('max-w-none');
```

- [x] **Step 2: Write the failing recent-target contract**

Replace the current 40px assertion in `shows recent documents as bounded primary-icon shortcuts`:

```ts
expect(project).toHaveClass('h-12', 'w-14');
```

- [x] **Step 3: Run the two tests and verify RED**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/components/projects/projects-experience-contract.test.ts --maxWorkers=1
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-rail.test.tsx --maxWorkers=1
```

Expected: The Web contract fails on the missing 75ch grid track and the UI contract fails because the recent link still has `h-10 w-10`.

### Task 2: Match the document surface to the prose measure

**Files:**

- Modify: `apps/web/src/components/editor/entity-document.tsx`
- Test: `apps/web/tests/components/projects/projects-experience-contract.test.ts`

- [x] **Step 1: Cap the desktop track and reduce the gutter**

Change the grid classes to:

```tsx
className={cn(
  'grid min-w-0 flex-1 gap-4',
  hasContents && '@4xl:grid-cols-[minmax(0,calc(75ch+2rem))_11rem]',
)}
```

- [x] **Step 2: Cap the padded surface and restore the editor measure**

Use these classes on the surface and editor:

```tsx
className =
  'entity-document bg-surface-container-low flex min-h-56 w-full max-w-[calc(75ch+2rem)] flex-1 flex-col rounded-xl p-4 sm:min-w-[32rem] print:bg-transparent print:p-0';
```

```tsx
className = 'flex min-h-0 max-w-[75ch] flex-1 flex-col';
```

- [x] **Step 3: Run the Web contract and verify GREEN**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/components/projects/projects-experience-contract.test.ts --maxWorkers=1
```

Expected: PASS.

### Task 3: Enlarge the recent selection target

**Files:**

- Modify: `packages/ui/src/components/shell/NavigationRail.tsx`
- Test: `packages/ui/tests/components/shell/navigation-rail.test.tsx`

- [x] **Step 1: Enlarge every recent shortcut without changing its identity**

Change the recent button classes to:

```tsx
className={cn(
  'h-12 w-14 shrink-0 rounded-xl',
  active
    ? 'bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80'
    : 'text-on-surface-variant hover:text-on-surface',
)}
```

- [x] **Step 2: Run the UI contract and verify GREEN**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-rail.test.tsx --maxWorkers=1
```

Expected: PASS.

### Task 4: Validate and release

**Files:**

- Modify: `docs/WORKLOG.md`

- [x] **Step 1: Run focused validation**

Run the two contracts, the complete Web editor suite, focused ESLint, formatting, and type checking with no more than two workers. Expected: every command passes without warnings.

- [x] **Step 2: Update the work log**

Move `EDITOR-MEASURE-001` to Completed. Record the exact test counts, browser measurements, deployment SHA, and any remaining blocker.

- [ ] **Step 3: Commit once**

Create one `fix(ui)` commit with a substantive body and the required Codex co-author trailer. Do not create a second implementation commit for the same change.

- [ ] **Step 4: Rebase and push main linearly**

Fetch `origin/main`, rebase the design and implementation commits if main advanced, verify zero merge commits, and push `HEAD:main`.

- [ ] **Step 5: Verify deployment and production**

Wait for exact-SHA E2E and CI deployment workflows. In the authenticated production app, measure the 80px shell, 56x48px recent target, 75ch editor surface, and 16px Contents gutter. Capture a desktop screenshot that shows the result.

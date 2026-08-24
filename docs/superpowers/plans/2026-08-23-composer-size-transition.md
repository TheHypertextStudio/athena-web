# Composer Size Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep create-composer width stable while providing useful default editor height and a graceful height-only expansion.

**Architecture:** `ComposerShell` owns geometry for every create composer, so it will define both bounded height states and one shared width. The existing controlled `expanded` state will switch height classes while the editor flexes into the available space.

**Tech Stack:** React, TypeScript, Tailwind CSS, Radix Dialog, Vitest, Testing Library

---

### Task 1: Correct the shared composer geometry

**Files:**

- Modify: `apps/web/src/components/composer/composer-shell.tsx`
- Test: `apps/web/tests/editor/editor-surface.test.tsx`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Write the failing geometry test**

  Update the existing expansion test to require one `max-w-2xl` width in both states. Require
  `h-[min(34rem,75dvh)]` by default, `h-[min(48rem,85dvh)]` when expanded,
  `transition-[height]`, the shared duration and easing classes, and
  `motion-reduce:transition-none`. Require the editor surface to keep `flex-1` in both states.

  ```tsx
  expect(dialog).toHaveClass(
    'h-[min(34rem,75dvh)]',
    'max-w-2xl',
    'transition-[height]',
    'duration-(--dur-slow)',
    'ease-(--ease-in-out)',
    'motion-reduce:transition-none',
  );
  expect(scrollSurface).toHaveClass('flex', 'flex-1', 'flex-col');

  await user.click(screen.getByRole('button', { name: 'Expand editor' }));

  expect(dialog).toHaveClass('h-[min(48rem,85dvh)]', 'max-w-2xl');
  expect(dialog).not.toHaveClass('max-w-5xl');
  ```

- [ ] **Step 2: Run the test and verify the old presets fail**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run tests/editor/editor-surface.test.tsx --maxWorkers=1
  ```

  Expected: The expansion test fails because the default dialog has no height, the expanded dialog
  uses `max-w-5xl`, and the default editor uses `h-28` instead of flexing.

- [ ] **Step 3: Implement the bounded height states**

  Keep `max-w-2xl` outside the conditional class. Add the default and expanded height classes plus
  `transition-[height] duration-(--dur-slow) ease-(--ease-in-out)
motion-reduce:transition-none`. Give the editor `flex flex-1 flex-col` and preserve its minimum
  usable height without changing width.

  ```tsx
  className={cn(
    'h-[min(34rem,75dvh)] max-w-2xl gap-0 overflow-hidden p-0 transition-[height] duration-(--dur-slow) ease-(--ease-in-out) motion-reduce:transition-none',
    expanded && 'h-[min(48rem,85dvh)]',
  )}
  ```

- [ ] **Step 4: Run focused validation**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run tests/editor/editor-surface.test.tsx tests/composers/create-initiative.test.tsx tests/composers/create-project.test.tsx tests/composers/create-program.test.tsx tests/composers/create-task.test.tsx --maxWorkers=1
  pnpm --filter @docket/web typecheck
  pnpm exec eslint apps/web/src/components/composer/composer-shell.tsx apps/web/tests/editor/editor-surface.test.tsx
  pnpm exec prettier --check apps/web/src/components/composer/composer-shell.tsx apps/web/tests/editor/editor-surface.test.tsx docs/WORKLOG.md
  git diff --check
  ```

  Expected: Every command exits zero. The editor node and expand button retain state and focus.

- [ ] **Step 5: Record completion and commit**

  Mark `[COMPOSER-SIZE-001]` completed in `docs/WORKLOG.md`, record the exact validation, and commit
  the implementation as `fix(design): Stabilize composer expansion` with a substantive body.

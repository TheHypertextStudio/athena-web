# App Overscroll Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser overscroll backdrop and authenticated app shell resolve through the same `surface-container` Tailwind token.

**Architecture:** The root layout owns the browser document canvas, while `AppShell` owns the authenticated shell canvas and its `main` owns the floating page surface. Add the existing semantic `bg-surface-container` utility to the root body, leaving `bg-surface` on `main`; protect the invariant with a rendered root-layout test and the existing shell contract.

**Tech Stack:** Next.js App Router, React, Tailwind CSS v4 semantic utilities, Vitest, Testing Library, Docket MD3 design tokens.

---

### Task 1: Pin the root document to the shell canvas token

**Files:**

- Create: `apps/web/tests/app/root-layout.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`

- [x] **Step 1: Write the failing rendered-layout test**

```tsx
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material-nextjs/v16-appRouter', () => ({
  AppRouterCacheProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('next/font/google', () => ({
  IBM_Plex_Mono: () => ({ variable: 'font-mono' }),
  IBM_Plex_Sans: () => ({ variable: 'font-sans' }),
}));
vi.mock('@/components/providers', () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}));

import RootLayout from '../../src/app/layout';

describe('RootLayout', () => {
  it('uses the shell canvas token for the browser overscroll backdrop', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>Page</main>
      </RootLayout>,
    );

    expect(html).toContain('<body class="bg-surface-container">');
  });
});
```

- [x] **Step 2: Run the test and verify the missing class fails**

Run: `pnpm --filter @docket/web exec vitest run tests/app/root-layout.test.tsx`

Expected: FAIL because the rendered body is `<body>` instead of `<body class="bg-surface-container">`.

- [x] **Step 3: Apply the shared semantic Tailwind token**

```tsx
<body className="bg-surface-container">
```

Also extend the root-layout TSDoc to state that the body and `AppShell` deliberately share
`surface-container`, while each shell `main` remains `surface`.

- [x] **Step 4: Run the test and existing shell contract**

Run: `pnpm --filter @docket/web exec vitest run tests/app/root-layout.test.tsx`

Expected: PASS with 1 test.

Run: `pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx`

Expected: PASS, including the contract that the shell root uses `bg-surface-container` and `main`
uses `bg-surface`.

### Task 2: Verify current Tailwind token hygiene

**Files:**

- Inspect: `packages/test-utils/tests/design-policies/design-token-debt.json`
- Inspect: `apps/web/src/components/marketing/*.tsx`

- [x] **Step 1: Run the design-token ratchet on current main**

Run: `pnpm --filter @docket/test-utils exec vitest run tests/design-policies/design-token-policy.test.ts`

Expected: PASS. Current main includes `fix(design): Restore the marketing token ratchet`, which
migrated the marketing raw typography utilities and synchronized their ledger entries.

- [x] **Step 2: Confirm this change introduces no raw Tailwind debt**

Run: `git diff --check && git diff -- apps/web/src/app/layout.tsx apps/web/tests/app/root-layout.test.tsx`

Expected: The production diff adds only `bg-surface-container`; the test pins that semantic role.
No hardcoded colour, arbitrary value, raw typography utility, or new debt-ledger entry is added.

### Task 3: Close documentation and verify the repository

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/superpowers/plans/2026-08-10-app-overscroll-background.md`

- [x] **Step 1: Record completion evidence**

Move `WEB-BACKDROP-001` to completed status, check each subtask, and record the targeted root-layout,
shell, and design-token policy evidence. Mark every completed checkbox in this plan.

- [x] **Step 2: Run the full repository gates**

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS.

Run: `pnpm test`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

- [x] **Step 3: Commit the implementation**

Stage only the root layout, its regression test, the plan, and the work log. Commit with a
Conventional Commit message explaining that the browser canvas now follows the same semantic token
as the app shell.

### Task 4: Land linearly on main

**Files:**

- No source files.

- [x] **Step 1: Refresh and rebase onto remote main**

Run: `git fetch origin main && git rebase origin/main`

Expected: the feature branch is based directly on current `origin/main` with no merge commit.

- [x] **Step 2: Re-run the targeted and full verification on the rebased result**

Run the Task 1 targeted tests, Task 2 token-policy test, and all four Task 3 repository gates.

Expected: every command exits 0.

- [x] **Step 3: Fast-forward local main and push it**

From the clean worktree that owns `main`, run `git merge --ff-only codex/app-overscroll-background`
and then `git push origin main`.

Expected: local `main`, `origin/main`, and `codex/app-overscroll-background` resolve to the same
single-parent tip.

- [x] **Step 4: Audit the landed state**

Run: `git rev-list --merges --count origin/main..codex/app-overscroll-background`

Expected: `0`.

Run: `git rev-list --left-right --count origin/main...codex/app-overscroll-background`

Expected: `0  0`.

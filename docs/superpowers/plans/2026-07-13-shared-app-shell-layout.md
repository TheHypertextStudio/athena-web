# Shared App Shell Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one `AppShell` instance mounted across session and organization loading for every route in the `(app)` group.

**Architecture:** The shared route-group layout renders `AppShellFrame` directly. `AppShellFrame` owns one stable provider and `AppShell` tree; authentication and organization state update only its sidebar, content, account, agenda, and banner slots. The signed-out return path is read inside the browser effect so the shell has no query-string suspension dependency.

**Tech Stack:** Next.js App Router, React 19, TanStack Query, Vitest, Testing Library, `@docket/ui`

## Global Constraints

- Never replace the `(app)` viewport with a full-screen loading or Suspense fallback.
- Mount exactly one `AppShell` instance and preserve it across session and organization settlement.
- Do not mount protected route content or enable authenticated actions before context is ready.
- Preserve the existing signed-out authentication interlock and complete return path.
- Keep loading feedback accessible and scoped to the shell regions it describes.

---

### Task 1: Prove the shared shell survives context resolution

**Files:**

- Modify: `apps/web/tests/components/app-shell-frame.test.tsx`

**Interfaces:**

- Consumes: `AppShellFrame({ children }: { children: ReactNode }): JSX.Element`
- Produces: a regression that compares the same `<main>` node before and after session plus organization resolution

- [ ] **Step 1: Make the organization request controllable**

Replace the permanently pending API mock with a hoisted `getOrganizations` mock. In the identity
test, return a deferred promise whose successful response resolves to one personal workspace.

- [ ] **Step 2: Write the failing shell-identity test**

Render the pending session, record `screen.getByRole('main')`, resolve the session and organization
request, rerender, and assert both that private content appears and that the current main element is
the exact recorded node:

```typescript
const loadingMain = screen.getByRole('main');
sessionState.data = session;
sessionState.isPending = false;
rerenderFrame();
resolveOrganizations(successfulOrganizationsResponse);

await screen.findByText('Private route content');
expect(screen.getByRole('main')).toBe(loadingMain);
```

- [ ] **Step 3: Run the test and verify the current duplicate shell fails**

Run: `pnpm --filter @docket/web exec vitest run tests/components/app-shell-frame.test.tsx`

Expected: FAIL because `AppShellLoadingFrame` unmounts and `AuthenticatedAppShellFrame` mounts a
different `AppShell` after organization resolution.

### Task 2: Make the route-group layout own one shell tree

**Files:**

- Modify: `apps/web/src/app/(app)/layout.tsx`
- Modify: `apps/web/src/components/app-shell-frame.tsx`
- Test: `apps/web/tests/components/app-shell-frame.test.tsx`

**Interfaces:**

- Consumes: `Sidebar.loading`, nullable `OpenDocumentsProvider.userId`, query `enabled` options
- Produces: one persistent `AppShellFrame` tree with provisional slots controlled by `loading`

- [ ] **Step 1: Remove the full-layout Suspense boundary**

Render `<AppShellFrame>{children}</AppShellFrame>` directly from `AppGroupLayout` and remove the
`Suspense` and `AppShellLoadingFrame` imports and documentation.

- [ ] **Step 2: Remove the query-string suspension dependency**

Delete `useSearchParams()`. In the resolved signed-out effect, append `window.location.search` to
`pathname` and call `requireAuthentication()` with that browser-derived return path.

- [ ] **Step 3: Consolidate session and organization state in the frame**

Always call the organization query with `enabled: Boolean(session)`. Compute
`shellLoading = !session || orgsQ.isPending`, and keep `ContextProvider`, `ActiveOrgContext`,
`CommandPaletteProvider`, and `OpenDocumentsProvider` mounted with nullable or empty provisional
values.

- [ ] **Step 4: Render one AppShell with stateful slots**

Add a `loading` prop to `AppShellInner`. Keep its `VocabularyProvider`, `AthenaPanelProvider`, and
`AppShell` mounted for every state. While loading, pass the loading sidebar, account, mobile action,
agenda, and content skeleton nodes; otherwise pass the existing authenticated nodes. Gate the
notification query with `enabled: !loading` and do not render route children until loading ends.

- [ ] **Step 5: Remove the duplicate loading frame**

Delete `AppShellLoadingFrame`, its exported props, and the conditional frame returns. Keep the
private skeleton helpers because the persistent shell uses them as slot content.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @docket/web exec vitest run tests/components/app-shell-frame.test.tsx tests/components/auth/sign-in-page.test.tsx`

Expected: PASS, including shell identity, protected-content gating, disabled provisional actions,
and the complete signed-out return path.

### Task 3: Validate, document, and land the correction

**Files:**

- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Consumes: completed implementation and validation evidence
- Produces: completed worklog entry and a linear local-main landing

- [ ] **Step 1: Run changed-package validation**

Run `pnpm --filter @docket/web typecheck`, `pnpm --filter @docket/web lint`, and
`pnpm --filter @docket/ui test`.

Expected: all pass.

- [ ] **Step 2: Run repository validation**

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Record only independently
reproduced baseline failures; do not change unrelated product work.

- [ ] **Step 3: Verify the live loading transition**

Delay session and organization requests in the browser at desktop and mobile widths. Confirm one
shell stays visible, protected content appears inside it, and the console has no new errors.

- [ ] **Step 4: Complete the worklog and review**

Mark `APP-SHELL-LAYOUT-001` complete with implementation, validation, and retrospective evidence.
Run `git diff --check`, search for the removed full-layout boundary, and request a read-only code
review.

- [ ] **Step 5: Commit and land linearly**

Commit the correction with an allowed Conventional Commit scope and substantive body. In an
isolated clean `main` worktree, run `git merge --ff-only feature/app-shell-loading`, reverify the
focused tests and build result as appropriate, and confirm `git rev-list --merges --count
origin/main..HEAD` prints `0`.

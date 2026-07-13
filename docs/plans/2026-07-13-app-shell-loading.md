# Persistent App Shell Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the authenticated Docket shell visible while session and workspace context resolve, especially immediately after sign-in.

**Architecture:** Split the authenticated frame into a stable shell presentation and an authenticated content branch. The pending and signed-out states render the same responsive shell chrome with static Home navigation and a local main-panel placeholder; authenticated-only providers, queries, actions, and route children mount only after a session exists.

**Tech Stack:** Next.js App Router, React, TanStack Query, Vitest, Testing Library, `@docket/ui`

---

### Task 1: Lock the session-loading behavior in component tests

**Files:**

- Create: `apps/web/tests/components/app-shell-frame.test.tsx`

**Step 1: Write the failing pending-session test**

Render `AppShellFrame` with `authClient.useSession()` returning `{ data: null, isPending: true }`.
Assert that the shell and Home navigation render, route children do not render, and authenticated
queries/actions are not enabled.

**Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @docket/web test -- tests/components/app-shell-frame.test.tsx`
Expected: FAIL because the current frame returns the full-screen `Loading your workspace…` view.

**Step 3: Write the signed-out interlock test**

Render the resolved signed-out state. Assert that the shell remains present and
`requireAuthentication()` receives the protected return path.

**Step 4: Run the focused test and confirm the new assertion fails for the missing shell**

Run: `pnpm --filter @docket/web test -- tests/components/app-shell-frame.test.tsx`
Expected: FAIL because the current signed-out state also returns the full-screen loading view.

### Task 2: Implement the provisional shell

**Files:**

- Modify: `apps/web/src/components/app-shell-frame.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Modify: `packages/ui/src/components/shell/Sidebar.tsx`
- Modify: `packages/ui/src/components/shell/SidebarNavItem.tsx`
- Modify: `packages/ui/src/components/shell/WorkspaceSwitcher.tsx`

**Step 1: Add a scoped shell content placeholder**

Create a documented presentational placeholder composed from the existing Skeleton primitive. Keep
it inside the shell's main panel and reserve the page-header and primary-content rhythm without
simulating data that is not known yet.

**Step 2: Render shell chrome before authentication resolves**

Refactor the frame so its shell presentation accepts an optional session user. During pending and
resolved-signed-out states, supply empty workspace data, omit the agenda/account/recovery/authenticated
queries, keep Home navigation available, and render the placeholder instead of route children.

**Step 3: Replace the route-group Suspense fallback**

Use the same provisional shell presentation as the `(app)` layout fallback so `useSearchParams()`
suspension cannot blank the viewport.

**Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @docket/web test -- tests/components/app-shell-frame.test.tsx`
Expected: PASS with no warnings.

### Task 3: Verify and close out the feature slice

**Files:**

- Modify: `docs/WORKLOG.md`

**Step 1: Run focused regression tests**

Run: `pnpm --filter @docket/web test -- tests/components/app-shell-frame.test.tsx tests/components/auth/sign-in-page.test.tsx`
Expected: PASS.

**Step 2: Run repository validation**

Run: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
Expected: All feature-related checks pass; record any independently reproduced baseline failures.

**Step 3: Review the production diff and loading-state search**

Confirm no authenticated route-group fallback or session gate still returns a full-screen loading
view, and confirm authenticated route children cannot mount before the session resolves.

**Step 4: Complete the worklog retrospective**

Move `APP-SHELL-LOADING-001` to completed with implementation, validation, and learnings.

**Step 5: Commit atomically**

Commit the tests, implementation, plan, and worklog as one `fix(shell)` feature slice with a
substantive body.

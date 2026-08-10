# Open-document follow-ups implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close every follow-up left by the open-document switcher work: restore the root test gate and eliminate the Account menu hydration mismatch observed during live review.

**Architecture:** Treat the two failures independently. Migrate the seven new marketing components onto the existing `Text` primitive and shrink the design-debt ledger to current truth; then make the shell's already-resolved identity the single source rendered by `AccountMenu`, so server output and the first client render cannot disagree based on a second session hook.

**Tech stack:** React 19, Next.js 16, TypeScript, Vitest, Testing Library, Tailwind design tokens, Better Auth.

---

### Task 1: Restore the design-token ratchet

**Files:**

- Modify: `apps/web/src/components/marketing/agents-strip.tsx`
- Modify: `apps/web/src/components/marketing/closing-section.tsx`
- Modify: `apps/web/src/components/marketing/feature-band.tsx`
- Modify: `apps/web/src/components/marketing/feature-split.tsx`
- Modify: `apps/web/src/components/marketing/organizations-pair.tsx`
- Modify: `apps/web/src/components/marketing/placeholder-surface.tsx`
- Modify: `apps/web/src/components/marketing/secondary-list.tsx`
- Modify: `packages/test-utils/tests/design-policies/design-token-debt.json`
- Test: `packages/test-utils/tests/design-policies/design-token-policy.test.ts`

**Step 1: Verify the narrow policy test is red**

Run `pnpm --filter @docket/test-utils exec vitest run tests/design-policies/design-token-policy.test.ts --maxWorkers=1`.

Expected: seven new `raw-type-utility` regressions and ten stale ledger entries.

**Step 2: Replace raw marketing typography with named roles**

Import `Text` from `@docket/ui/primitives`, preserve semantic elements with `as`, preserve marketing-only display face and colour classes, and remove only font size, weight, line-height, and tracking utilities now supplied by the role.

**Step 3: Remove only the ten proven-stale ledger counters**

Edit `design-token-debt.json` without regenerating or increasing any allowance.

**Step 4: Verify the policy is green**

Run the same narrow Vitest command; expected: 8/8 tests pass.

**Step 5: Verify web typecheck, lint, and marketing rendering tests**

Run `pnpm --filter @docket/web typecheck`, `pnpm --filter @docket/web lint`, and the relevant marketing component suites.

### Task 2: Reproduce and remove the Account menu hydration mismatch

**Files:**

- Modify: `apps/web/tests/components/account-menu.test.tsx`
- Modify: `apps/web/tests/components/app-shell-frame.test.tsx`
- Modify: `apps/web/src/components/account-menu.tsx`
- Modify: `apps/web/src/components/app-shell-frame.tsx`

**Step 1: Add a failing hydration-boundary test**

Model a server-confirmed identity while the client `useSession` result changes across hydration. Assert that the account row's initial markup is sourced from the shell identity and remains stable.

**Step 2: Run the targeted test and confirm the expected failure**

Run the narrow Account menu and shell-frame suites. Expected: the current menu cannot render a supplied shell identity and depends on its own session hook.

**Step 3: Pass one resolved display identity through the shell**

Derive the display identity in `AppShellFrame` from live session, server session, or the permitted offline snapshot; pass it through `AppShellInner` into `AccountMenu`. Remove the duplicate session read from `AccountMenu` while keeping the identity-unknown skeleton boundary unchanged.

**Step 4: Run the targeted suites and confirm green**

Expected: Account menu actions still work, the stable-identity regression passes, and shell state tests remain green.

**Step 5: Re-run the live hydration scenario**

Start the authenticated local stack, reload the shell repeatedly, and confirm there is no Account menu hydration warning in the browser console.

### Task 3: Close out the branch

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/design/audits/2026-08-09-open-document-switcher.md`

**Step 1: Record resolved findings and evidence**

Move the follow-up worklog task to completed and replace the audit's external observation with the verified resolution.

**Step 2: Run repository gates**

Run root typecheck, lint, test, and build with the repository's Node memory setting.

**Step 3: Review and commit atomically**

Verify `git diff --check`, review the owned diff, commit with a Conventional Commit body, and confirm zero merge commits relative to `origin/main`.

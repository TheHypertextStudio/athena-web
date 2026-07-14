# Initiative Mobile Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore readable recovery-banner alignment and add grouped vertical rhythm to the mobile Initiative overview.

**Architecture:** Adjust the existing shell reminder and Initiative overview in place, preserving
their behavior and public interfaces. Source-level visual-contract tests lock the responsive layout,
spacing, typography, and interactive-target classes before the production styles change.

**Tech Stack:** Next.js, React, Tailwind CSS v4, Vitest.

---

### Task 1: Lock the banner and page rhythm contracts

**Files:**

- Create: `apps/web/tests/components/recovery-nudge-visual-contract.test.ts`
- Modify: `apps/web/tests/components/initiative-visual-contract.test.ts`

- [ ] Add a recovery-banner source contract requiring a three-column grid, a nested message/action
      block, standard `text-body`, a zero-left-padding text action, and 40-pixel icon targets.
- [ ] Add Initiative assertions requiring a 24-pixel header-to-attention gap and a 32-pixel
      attention-to-roster gap.
- [ ] Run
      `pnpm --filter @docket/web exec vitest run tests/components/recovery-nudge-visual-contract.test.ts tests/components/initiative-visual-contract.test.ts`
      and confirm the new assertions fail against the current flex banner and uniform page gap.

### Task 2: Implement the aligned reminder and grouped page spacing

**Files:**

- Modify: `apps/web/src/components/recovery-nudge-banner.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`

- [ ] Convert the reminder surface to `grid-cols-[2.5rem_minmax(0,1fr)_2.5rem]`, place message and
      action in one `min-w-0` column, and align the action label with the message by using a
      transparent 40-pixel text target with no left padding.
- [ ] Replace the overview's uniform `gap-5` stack with explicit grouping: `mb-6` after the header,
      `mb-8` after attention, and no decorative separators.
- [ ] Re-run the two focused tests and confirm they pass.

### Task 3: Validate and release

**Files:**

- Modify: `docs/WORKLOG.md`

- [ ] Run the focused web suite, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Verify the Initiative overview at mobile and desktop widths in light and dark themes.
- [ ] Record the implementation, validation, and retrospective in `docs/WORKLOG.md`.
- [ ] Commit with a Conventional Commit, fast-forward `main`, verify zero new merge commits, push,
      and monitor the production release through completion.

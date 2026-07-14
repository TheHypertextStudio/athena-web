# Initiative Overview Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the full Initiative table on medium containers with local horizontal scrolling and give attention items a stable vertical structure.

**Architecture:** Keep the existing overview component and data flow. Change only its responsive presentation contract: the table becomes a minimum-width child of an overflow region at `@2xl`, while the compact row remains below that breakpoint; the attention surface remains a column with a dedicated footer at every width.

**Tech Stack:** React, Tailwind CSS v4 container variants, Vitest static presentation contracts.

---

### Task 1: Lock the corrected responsive contract

**Files:**

- Modify: `apps/web/tests/components/initiative-visual-contract.test.ts`

- [ ] Replace the wide-only assertions with assertions for `overflow-x-auto`, a minimum table width,
      and `@2xl` table display classes.
- [ ] Assert that the attention surface has a dedicated footer and no wide `flex-row` switch.
- [ ] Run `pnpm --filter @docket/web exec vitest run tests/components/initiative-visual-contract.test.ts --reporter=dot` and confirm the updated assertions fail against the current component.

### Task 2: Implement the minimal layout correction

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`

- [ ] Keep `AttentionSurface` as a column and render its controls in a full-width footer using
      `justify-between`.
- [ ] Wrap the roster in `overflow-x-auto` and give the table a medium-only minimum width.
- [ ] Restore table/header/cell display at `@2xl` and compact metadata visibility below `@2xl`.
- [ ] Render a reserved two-line description block for every Initiative so rows stay equal in height
      whether the description is absent, short, or long.
- [ ] Run the focused visual-contract test and confirm all assertions pass.

### Task 3: Verify and close

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/design/audits/2026-07-13-initiatives.md`
- Create: revised medium-width screenshot under `docs/design/audits/screenshots/`

- [ ] Run Prettier, typecheck, lint, focused tests, and build.
- [ ] Capture the medium layout and verify the roster scrolls locally without page overflow.
- [ ] Record validation and retrospective notes in the worklog and audit.
- [ ] Commit with `fix(ui): Restore Initiative table scrolling`.

# Plain Labels and Initiative Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace overline typography and make Initiative attention, titles, and roster metadata read cleanly at every supported width.

**Architecture:** Extend the shared app type scale with one document-title token, then apply the
approved structure directly to the existing Initiative overview and detail components. A focused
source-policy test protects the responsive and typography contracts, while existing component and
browser checks protect behavior.

**Tech Stack:** Next.js, React, Tailwind CSS v4, container queries, Vitest.

---

### Task 1: Lock the visual contract

**Files:**

- Create: `apps/web/tests/components/initiative-visual-contract.test.ts`

- [ ] Write assertions that require `text-document-title`, a status-before-title header, a tonal
      borderless attention surface, a unified trailing control group, an `@5xl` full-table breakpoint,
      and compact owner/target metadata.
- [ ] Scan visible application labels and fail on semantic `uppercase` overline classes while
      allowing the team-key input whose capitalization is user data.
- [ ] Run `pnpm --filter @docket/web exec vitest run tests/components/initiative-visual-contract.test.ts`
      and confirm the assertions fail against the current implementation.

### Task 2: Implement typography and layout

**Files:**

- Modify: `packages/ui/src/styles/globals.css`
- Modify: `packages/ui/src/lib/utils.ts`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx`
- Modify: visible-label callsites reported by the visual-contract test

- [ ] Add `text-document-title` as `clamp(2rem, 1.35rem + 2.4vw, 3.5rem)` with calm document
      line-height, weight, and tracking, and register it with `cn`'s Tailwind merge configuration.
- [ ] Place the lifecycle badge before the Initiative title and replace the raw display clamp with
      the named token.
- [ ] Replace semantic uppercase/tracked labels with sentence-case ordinary type while preserving
      acronyms and user-authored codes.
- [ ] Make attention a rounded tonal region with no separator rules and place the action plus pager
      in one responsive controls wrapper.
- [ ] Switch full table semantics from `@2xl` to `@5xl`; below that breakpoint render status,
      health, owner, target, and update together in the existing wrapping metadata line.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Verify and close out

**Files:**

- Modify: `docs/WORKLOG.md`

- [ ] Run Initiative and typography component tests, `pnpm typecheck`, `pnpm lint`, and
      `pnpm build`.
- [ ] Capture desktop and intermediate-width Initiative overview/detail screenshots and verify no
      squashed columns, floating controls, overline labels, or title overflow.
- [ ] Record validation and retrospective notes in `docs/WORKLOG.md`.
- [ ] Commit the implementation with a Conventional Commit and verify linear history.

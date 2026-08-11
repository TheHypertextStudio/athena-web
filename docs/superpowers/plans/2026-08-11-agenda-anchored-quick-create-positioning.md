# Agenda Anchored Quick-Create Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the draggable Agenda new-event dialog open beside its selected draft with Google Calendar-like portal anchoring, collision fallback, and manual drag handoff.

**Architecture:** Keep the modal portaled into the shell-owned primary-content overlay so it remains a true sibling of the Agenda. Pass the selected draft's virtual-anchor ref into a pure geometry controller, resolve viewport coordinates into host-local coordinates after the portal commits, and stop automatic anchoring after the first pointer or keyboard move.

**Tech Stack:** TypeScript, React 19, Radix Dialog through `@docket/ui`, Vitest, Testing Library, Playwright.

## Global Constraints

- The desktop dialog remains `role="dialog"` and portaled into the shell overlay host.
- The Agenda rectangle is a hard exclusion boundary before and after dragging.
- Preferred anchor gap is `12px`; host safety inset is `16px`; title alignment offset is `72px`.
- Left-of-anchor placement is preferred, the opposite side is the first fallback, and the least-correction candidate is the final fallback.
- Pointer and keyboard movement both transfer position ownership to the user.
- Mobile and tablet keep the existing full-height Agenda-owned sibling dialog and do not become draggable.
- The selected draft remains local until Save and remains visible while desktop quick create is open.
- Preserve unrelated work and use the repository's atomic clean-index commit chain.

---

## File Map

- `apps/web/src/components/calendar/use-clamped-dialog-position.ts` — pure anchor geometry plus automatic/manual position state.
- `apps/web/src/components/calendar/create-block-form.tsx` — passes the virtual anchor ref and selection identity into the position controller.
- `apps/web/src/components/scheduling/scheduling-types.ts` — adds the clicked all-day anchor to the create callback.
- `apps/web/src/components/scheduling/scheduling-all-day-lane.tsx` — supplies the clicked all-day button as a virtual anchor.
- `apps/web/src/components/agenda/agenda-canvas.tsx` — retains timed and all-day anchor refs for quick create.
- `apps/web/tests/calendar/use-clamped-dialog-position.test.ts` — proves coordinate conversion, side choice, alignment, and clamping.
- `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx` — proves timed and all-day drafts forward anchors.
- `apps/web/e2e/calendar/agenda-quick-create-evidence.spec.ts` — proves live anchor proximity, exclusion, and drag handoff.
- `docs/design/audits/2026-08-10-agenda-quick-create.md` and screenshots — records rendered evidence.
- `docs/WORKLOG.md` — completes task state and retrospective.

---

### Task 1: Define anchored portal geometry

**Files:**

- Modify: `apps/web/tests/calendar/use-clamped-dialog-position.test.ts`
- Modify: `apps/web/src/components/calendar/use-clamped-dialog-position.ts`

**Interfaces:**

- Produces: `DialogRect { left; top; width; height }` for viewport geometry.
- Produces: `anchoredDialogPoint(host, dialog, anchor, { gap?, inset?, titleOffset? }): Point`.
- Preserves: `clampDialogPoint(point, host, dialog, inset): Point`.

- [x] **Step 1: Write failing geometry tests**

```ts
expect(
  anchoredDialogPoint(
    { left: 256, top: 8, width: 840, height: 884 },
    { width: 544, height: 366 },
    { left: 1142, top: 173, width: 230, height: 24 },
  ),
).toEqual({ x: 280, y: 93 });

expect(
  anchoredDialogPoint(
    { left: 400, top: 0, width: 900, height: 700 },
    { width: 420, height: 360 },
    { left: 420, top: 30, width: 80, height: 40 },
  ),
).toEqual({ x: 112, y: 16 });
```

Also assert bottom-edge clamping and the least-horizontal-correction fallback when neither side fits.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @docket/web test -- tests/calendar/use-clamped-dialog-position.test.ts`

Expected: FAIL because `anchoredDialogPoint` is not exported.

- [x] **Step 3: Implement minimal pure geometry**

Compute host-local candidates from `anchor.left - host.left - dialog.width - gap` and
`anchor.left + anchor.width - host.left + gap`. Select the preferred fitting candidate, then the
opposite fitting candidate, then the candidate with the smaller distance to its clamped value.
Compute `y` as `anchor.top - host.top - titleOffset`, then pass the selected point through
`clampDialogPoint`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @docket/web test -- tests/calendar/use-clamped-dialog-position.test.ts`

Expected: PASS.

---

### Task 2: Resolve the anchor after portal commit and hand off to dragging

**Files:**

- Modify: `apps/web/src/components/calendar/use-clamped-dialog-position.ts`
- Modify: `apps/web/src/components/calendar/create-block-form.tsx`
- Modify: `apps/web/tests/calendar/create-block-form.test.tsx`

**Interfaces:**

- `useClampedDialogPosition({ open, host, anchorRef, anchorKey })` consumes
  `PopoverVirtualAnchorRef | undefined` and a stable selection identity.
- The hook dereferences `anchorRef.current` only inside the animation-frame placement callback,
  after the selected preview and portaled dialog have committed.

- [x] **Step 1: Add a failing desktop component test**

Render a positioned shell host and a virtual selection anchor, open Agenda quick create, flush the
animation frame, and assert the dialog style resolves to the anchor-relative point rather than the
generic shell edge. Press `ArrowLeft` on `Move create-event dialog`, resize the host, and assert the
controller clamps the moved point without restoring automatic anchoring.

- [x] **Step 2: Run the component test and verify RED**

Run: `pnpm --filter @docket/web test -- tests/calendar/create-block-form.test.tsx`

Expected: FAIL because the hook currently receives only `preferredTop` computed before the anchor
ref is committed and keyboard movement does not mark the point manual.

- [x] **Step 3: Implement anchor-ref placement and handoff**

Pass `selectionAnchorRef` and the existing `calendarSelectionKey(selection)` result into the hook. In the hook,
automatic placement uses `anchoredDialogPoint` when the ref is available and the existing safe
edge fallback otherwise. Resize observation re-runs anchored placement only before manual movement;
pointer-down and arrow-key movement both set the manual flag. Closing resets the flag.

- [x] **Step 4: Run component and geometry tests**

Run: `pnpm --filter @docket/web test -- tests/calendar/use-clamped-dialog-position.test.ts tests/calendar/create-block-form.test.tsx`

Expected: PASS.

---

### Task 3: Anchor timed and all-day Agenda drafts

**Files:**

- Modify: `apps/web/src/components/scheduling/scheduling-types.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-all-day-lane.tsx`
- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx`
- Modify: `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx`

**Interfaces:**

- `onSelectAllDayRegion(lane, anchor)` receives a `PopoverVirtualAnchor` implemented by the clicked button.
- Timed drafts continue using `selectedRegionAnchorRef`; all-day drafts retain the clicked button in a separate ref.
- `CreateBlockForm.selectionAnchorRef` always points at the visible desktop draft origin when one exists.

- [x] **Step 1: Write a failing all-day anchor-forwarding test**

Invoke `onSelectAllDayRegion` with a structural anchor whose `getBoundingClientRect()` returns a
known rectangle, then assert `quickCreate.props.selectionAnchorRef?.current` is that anchor.
Retain the existing timed-draft assertion and add an assertion that its selected-region ref is
forwarded.

- [x] **Step 2: Run the Agenda interaction test and verify RED**

Run: `pnpm --filter @docket/web test -- tests/agenda/agenda-canvas-interactions.test.tsx`

Expected: FAIL because the all-day callback currently receives only the lane and quick create omits
an anchor for all-day drafts.

- [x] **Step 3: Implement all-day anchor propagation**

Pass `event.currentTarget` from the all-day create button, retain it in `AgendaCanvas`, clear it for
timed drafts and consumed selections, and choose the timed preview ref or all-day button ref when
rendering `CreateBlockForm`.

- [x] **Step 4: Run Agenda and scheduling tests**

Run: `pnpm --filter @docket/web test -- tests/agenda/agenda-canvas-interactions.test.tsx tests/scheduling/scheduling-canvas.test.tsx`

Expected: PASS.

---

### Task 4: Prove browser geometry and refresh evidence

**Files:**

- Modify: `apps/web/e2e/calendar/agenda-quick-create-evidence.spec.ts`
- Modify: `docs/design/audits/2026-08-10-agenda-quick-create.md`
- Replace: `docs/design/audits/screenshots/2026-08-10-agenda-quick-create/desktop-{light,dark}-overview.png`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Browser proof compares the initial dialog box to the selected draft box before dragging.
- Browser proof compares the post-resize position after dragging to prove manual ownership persists.

- [x] **Step 1: Add failing Playwright geometry assertions**

Assert the selected draft is visible, the dialog ends at the Agenda boundary with the selected
draft no more than the time gutter away, the title input center is within `24px` of the selected
draft center, and the dialog's right edge remains left of the Agenda boundary. After dragging left
and resizing, assert the dialog does not snap back to the anchor.

- [x] **Step 2: Run the focused E2E test and verify behavior**

Run: `pnpm --filter @docket/web exec playwright test e2e/calendar/agenda-quick-create-evidence.spec.ts --project=chromium`

Expected: PASS after Tasks 1–3; if it fails, use the measured rectangles to correct the geometry
contract rather than weakening the assertions.

- [x] **Step 3: Capture light, dark, mobile, tablet, and timezone evidence**

Run the same Playwright evidence file with its screenshot capture enabled and inspect every emitted
PNG for anchor proximity, non-overlap, readable fields, and theme parity.

- [x] **Step 4: Run repository gates**

Run: `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected: every command exits `0`.

- [x] **Step 5: Complete the worklog and commit atomically**

Move `[AGENDA-ANCHOR-001]` from Active Tasks to Completed Tasks with the exact test and browser
evidence, then commit the implementation, tests, screenshots, audit, plan, and worklog using the
repository's required clean-index staging chain.

---

### Task 5: Deploy and verify the exact SHA

**Files:** None.

**Interfaces:** Production `main`, GitHub CI/E2E, Vercel, and the public web/API health endpoints.

- [x] **Step 1: Rebase or fast-forward against current `origin/main`**

Fetch `origin/main`, verify no upstream drift or merge commits, and fast-forward the canonical main
worktree to the feature commit.

- [x] **Step 2: Push `main` and monitor exact-SHA checks**

Require successful CI, all four E2E shards, the production API/admin jobs, scheduler reconciliation,
and Vercel deployment for the pushed SHA.

- [x] **Step 3: Verify production runtime**

Require HTTP `200` from `https://docket.hypertext.studio/`, `{"status":"ok"}` from
`https://docket-api.hypertext.studio/v1/health`, and an authenticated browser measurement proving
the live dialog is anchored beside its selected draft while remaining draggable and outside Agenda.

# Agenda Rail Structural Redesign Implementation Plan

> **Status**: Approved for execution
> **Date**: 2026-08-10
> **Design**: `docs/superpowers/specs/2026-08-10-agenda-rail-structural-redesign-design.md`

## Objective

Implement the approved Agenda rail as a purpose-built single-day companion: one navigable date,
semantic day context, a compact all-day strip, an edge-to-edge timed viewport, readable and paced
events, discrete scale choices, and local click-or-drag drafts that open the shared responsive
quick-create experience.

The work keeps the scheduling engine and persistence path shared with Calendar. Agenda owns only
the single-day presentation and draft host needed by a narrow rail.

## Task 1: Preserve provider event semantics and separate day context

**Files:**

- Modify: `packages/types/src/calendar.ts`
- Test: `packages/types/tests/dto/calendar.test.ts`
- Create: `apps/api/src/calendar/calendar-provider-event-type.ts`
- Modify: `apps/api/src/calendar/calendar-serializers.ts`
- Test: `apps/api/tests/calendar-serializers.test.ts`
- Create: `apps/web/src/components/agenda/agenda-day-context.ts`
- Test: `apps/web/tests/agenda/agenda-day-context.test.ts`
- Modify: `apps/web/src/components/agenda/agenda-context.tsx`

### Steps

1. Add failing type tests for the normalized provider event type and failing serializer tests for
   Google `workingLocation`, `focusTime`, `outOfOffice`, and unknown values.
2. Run only those tests and confirm the failures describe the missing DTO and serializer behavior.
3. Add the optional normalized provider event type to `CalendarItemOut`; implement a pure mapping
   from `providerRaw.eventType`; include it in every serialized calendar item.
4. Add failing Agenda classifier tests proving a semantic working-location record becomes context,
   while an ordinary event titled `Home` stays scheduled.
5. Implement the pure partition and expose `dayContext` separately from scheduled entries in the
   Agenda context.
6. Re-run the focused type, API, and web tests until green.

## Task 2: Make Agenda navigation and scale intentional

**Files:**

- Modify: `apps/web/src/components/agenda/agenda-context.tsx`
- Modify: `apps/web/src/components/agenda/agenda-header.tsx`
- Create: `apps/web/src/components/agenda/agenda-display-menu.tsx`
- Remove: `apps/web/src/components/agenda/agenda-scale-stepper.tsx`
- Test: `apps/web/tests/agenda/agenda-context-navigation.test.tsx`
- Create: `apps/web/tests/agenda/agenda-header.test.tsx`

### Steps

1. Add failing tests for direct date selection, previous/next/Today actions, keyboard date movement,
   and scale normalization to exactly 48, 96, or 144 pixels per hour.
2. Verify the tests fail against continuous scale and the non-interactive date label.
3. Replace continuous Agenda zoom state with a discrete scale contract and expose `goToDate`.
4. Replace the duplicated header controls with a single DatePicker-backed date trigger and compact
   previous/next buttons.
5. Move timeline/list choice and scale into the Agenda display menu; remove the in-gutter stepper.
6. Re-run the focused navigation and header tests.

## Task 3: Build the single-day rail structure

**Files:**

- Modify: `apps/web/src/components/agenda/agenda.tsx`
- Create: `apps/web/src/components/agenda/agenda-day-context-strip.tsx`
- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-types.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas-header.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-all-day-lane.tsx`
- Create: `apps/web/tests/agenda/agenda-canvas-presentation.test.tsx`
- Create: `apps/web/tests/scheduling/scheduling-canvas-agenda-presentation.test.tsx`

### Steps

1. Add failing component tests for one visible date, no Agenda lane heading, no outer viewport
   padding or nested calendar radius, semantic day context, and the compact all-day strip.
2. Verify the tests fail against the inherited multi-lane calendar presentation.
3. Add one cohesive `agenda` presentation to the shared scheduling surface so Agenda can omit the
   multi-lane heading and scale gutter without a matrix of independent flags.
4. Make the Agenda shell own horizontal header inset and outer clipping while the timed viewport
   runs edge-to-edge.
5. Render day context and all-day content as separate optional rows.
6. Re-run the focused shell and scheduling-presentation tests.

## Task 4: Improve event pacing, accents, and information density

**Files:**

- Modify: `apps/web/src/components/scheduling/scheduling-overlap-layout.ts`
- Test: `apps/web/tests/scheduling/scheduling-overlap-layout.test.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-item-card.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-all-day-item.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-dense-overflow-ui.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-item-icons.tsx`
- Test: `apps/web/tests/scheduling/scheduling-item-presentation.test.tsx`

### Steps

1. Add failing geometry tests for a one-pixel vertical visual gap, a two-pixel concurrent-column
   gap, and removal of the four-pixel lone-event inset.
2. Add failing presentation tests proving the accent is a flat inset element, resting lock glyphs
   are absent, accessible read-only context remains, and overflow reads `+N more`.
3. Verify each new assertion fails for the expected current behavior.
4. Update horizontal geometry and card visual height without changing exact schedule bounds.
5. Replace border-wrapped accents with an inset two-pixel bar, remove visible lock chrome, retain
   accessible permission text, and tighten dense-overflow disclosure.
6. Re-run the focused geometry and presentation tests.

## Task 5: Make quick create draft-aware and responsive

**Files:**

- Modify: `apps/web/src/components/calendar/create-block-form.tsx`
- Create: `apps/web/src/components/calendar/create-block-draft.ts`
- Test: `apps/web/tests/calendar/create-block-draft.test.ts`
- Modify: `apps/web/tests/calendar/create-block-form.test.tsx`

### Steps

1. Add failing pure tests for exact draft projection, dirty tracking, all-day drafts, and invalid
   wall-clock edits.
2. Add failing component tests for a hidden Agenda trigger, draft-time callbacks, cancel/failure
   retention, responsive bottom placement, and Event/Time block switching.
3. Verify the tests fail before modifying the form.
4. Extract a pure draft controller that keeps one unsaved selection and resolves exact instants
   without persistence.
5. Refactor `CreateBlockForm` so Calendar retains its anchored Popover while Agenda can use an
   inward-opening desktop dialog and a bottom-anchored mobile dialog with the same form fields.
6. Keep failed submissions in the form, expose draft and dirty-state callbacks, and preserve the
   existing typed mutation path.
7. Re-run the focused draft and form tests.

## Task 6: Connect timed and all-day creation in Agenda

**Files:**

- Modify: `apps/web/src/components/agenda/agenda.tsx`
- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx`
- Create: `apps/web/src/components/agenda/agenda-draft-controller.ts`
- Test: `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx`
- Create: `apps/web/tests/agenda/agenda-draft-controller.test.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-types.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas-header.tsx`

### Steps

1. Add failing tests for click-to-create thirty-minute drafts, drag-selected duration, all-day
   creation, Escape/cancel, existing-event isolation, and exact selection projection.
2. Add failing tests for untouched-draft auto-discard and edited-draft confirmation on date change.
3. Verify the focused tests fail against the current non-interactive Agenda surface.
4. Connect Agenda to shared timed-region selection, add an accessible empty all-day creation target,
   and keep the local draft projected while the form is open.
5. Add focused grid keyboard creation and Agenda date shortcuts without intercepting editable
   controls.
6. Route date changes through the draft guard; clear the local projection on cancel or successful
   persistence and keep it on failure.
7. Re-run all focused Agenda interaction tests.

## Task 7: Validate the product surface and document the result

**Files:**

- Modify: `docs/WORKLOG.md`
- Create: `docs/design/audits/2026-08-10-agenda-rail-structural-redesign.md`
- Modify: relevant Calendar or Agenda documentation only if the implemented behavior changes a
  documented contract

### Steps

1. Run the complete focused Calendar/Agenda test slice across types, API, and web.
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`; fix product regressions and
   record unrelated pre-existing blockers precisely if a repository-wide gate cannot complete.
3. Start the app and exercise the rail at desktop and mobile widths, in light and dark themes.
4. Capture the design-review evidence required by the Docket Craft Rubric and write the audit to
   `docs/design/audits/`.
5. Measure the acceptance contract: one date, zero resting locks, only whole-number scale labels,
   required event gaps, flat accents, no document overflow, no server create before Save, and one
   persisted item after Save.
6. Update the work log with files, validation, decisions, and retrospective; mark the task complete
   only when the implemented behavior and live evidence satisfy the approved design.
7. Self-review the final diff, confirm `git diff --check`, confirm no merge commits, and commit the
   completed product slice atomically.

## Risks and Controls

- **Shared scheduling regressions**: keep Agenda differences behind one presentation value and run
  existing Calendar scheduling tests after every shared-primitive change.
- **Duplicate optimistic records**: render exactly one owner of draft/saving projection and assert
  the transition in component tests.
- **Provider metadata drift**: normalize only recognized semantic event types and omit unknown
  values rather than guessing from titles.
- **DST ambiguity**: reuse exact wall-clock resolution and keep invalid selections visible with
  application-owned recovery copy.
- **Narrow responsive behavior**: verify actual desktop rail and mobile Agenda Sheet instead of
  inferring from component classes.
- **Dirty worktree interference**: stage only files owned by this task using the repository's
  required atomic staging-and-commit chain.

## Validation Commands

Run the smallest focused test after each red/green cycle. Before completion, run:

```bash
pnpm --filter @docket/types test -- calendar.test.ts
pnpm --filter @docket/api test -- calendar-serializers.test.ts calendar-items.test.ts
pnpm --filter @docket/web test -- agenda-context-navigation.test.tsx agenda-header.test.tsx agenda-day-context.test.ts agenda-canvas.test.tsx agenda-canvas-interactions.test.tsx agenda-draft-controller.test.ts create-block-draft.test.ts create-block-form.test.tsx scheduling-canvas-agenda-presentation.test.tsx scheduling-overlap-layout.test.ts scheduling-item-presentation.test.tsx
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
git rev-list --merges --count origin/main..HEAD
```

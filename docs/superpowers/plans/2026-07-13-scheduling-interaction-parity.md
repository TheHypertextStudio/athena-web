# Scheduling Interaction Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared Agenda/Calendar canvas accurate, collision-safe, directly editable, and
visually predictable at the interaction bar of Google Calendar and Sunsama.

**Architecture:** Keep `SchedulingCanvas` as a callback-driven host and extract four focused seams:
a Temporal-backed wall-clock model, adaptive axis renderer, deterministic collision layout, and
cancellable gesture controller/event card. Calendar and Agenda remain responsible for permissions
and typed optimistic persistence, but both consume the same timezone and editability rules.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind, Vitest, Testing Library,
`@js-temporal/polyfill`, TanStack Query.

## Global Constraints

- No named day/week modes or fixed visible date counts may enter the shared canvas.
- Zoom remains one continuous 24–240 pixels-per-hour scalar; Overview (24), Standard (72), and
  Detail (144) are shortcuts over that scalar, not modes.
- Time labels, event geometry, selection, previews, and persisted mutations must share one wall-time
  conversion path in the viewer's selected IANA timezone.
- People comparison geometry uses the viewer's timezone; a person's timezone is display metadata.
- Loading, empty, stale, and failure states never replace or unmount the grid.
- No event may be fully hidden by a concurrent event; layout is deterministic independent of API
  order.
- Move and resize affordances appear only when item, source lane, target lane, and provider policy
  permit the operation.
- Every production behavior starts with a failing test and includes safe fixed user copy.
- `scheduling-canvas.tsx` remains an orchestrator; extracted production files stay below 300 lines.

---

### Task 1: Temporal-backed wall-clock model

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/scheduling/scheduling-time-axis.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-date-lanes.ts`
- Modify: `apps/web/src/components/scheduling/index.ts`
- Test: `apps/web/tests/scheduling/scheduling-time-axis.test.ts`
- Test: `apps/web/tests/scheduling/scheduling-geometry.test.ts`

**Interfaces:**

- Produces `resolveScheduleTimezone(preferred?: string): string`.
- Produces `scheduleInstantAt(date, wallMinutes, timezone, disambiguation?): string | null` where
  disambiguation is `compatible | earlier | later | reject`.
- Produces `scheduleDateRange(startDate, laneCount, timezone): { startISO; endISO }`.
- Produces `deriveScheduleTicks({ date, timezone, pixelsPerHour, locale? }): ScheduleTick[]` with
  `wallMinutes`, `label`, `kind: major | minor`, and `transition: normal | skipped | repeated`.
- Extends `itemBoundsInLane(item, lane, displayTimezone)` so geometry always uses the canvas zone and
  repeated-hour events never return a zero-height interval.

- [ ] **Step 1: Install the production timezone primitive**

Run:

```bash
pnpm --filter @docket/web add @js-temporal/polyfill
```

Expected: the web package and lockfile record one direct dependency without changing other catalog
versions.

- [ ] **Step 2: Write failing wall-clock and tick tests**

Cover these exact contracts:

```typescript
expect(scheduleDateRange('2026-03-08', 1, 'America/Los_Angeles')).toEqual({
  startISO: '2026-03-08T08:00:00Z',
  endISO: '2026-03-09T07:00:00Z',
});
expect(scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'earlier')).not.toBe(
  scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'later'),
);
expect(scheduleInstantAt('2026-03-08', 150, 'America/Los_Angeles', 'reject')).toBeNull();
expect(majorTickInterval(24)).toBe(120);
expect(majorTickInterval(72)).toBe(60);
expect(majorTickInterval(144)).toBe(30);
expect(majorTickInterval(240)).toBe(15);
```

Also assert locale formatting, a skipped spring tick, a repeated fall tick, invalid timezone
fallback, exact 24/240 zoom endpoints, and a one-hour repeated-time event producing non-zero bounds.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/scheduling/scheduling-time-axis.test.ts tests/scheduling/scheduling-geometry.test.ts
```

Expected: failure because the new wall-clock exports and explicit display-timezone behavior do not
exist.

- [ ] **Step 4: Implement the minimum Temporal-backed model**

Import `Temporal` directly from `@js-temporal/polyfill`; do not patch `globalThis`. Parse bare dates
with `Temporal.PlainDate`, use `toZonedDateTime()`/`startOfDay()` for boundaries, and use
`Temporal.ZonedDateTime.from(..., { disambiguation })` for wall positions. Format labels with native
`Intl.DateTimeFormat` so browser locale preferences remain authoritative.

`majorTickInterval()` chooses the first of `[15, 30, 60, 120]` whose physical separation is at
least 44 pixels. `deriveScheduleTicks()` emits every active snap interval, promotes aligned ticks to
major, and detects skipped/repeated wall times by comparing reject/earlier/later conversions.

- [ ] **Step 5: Verify GREEN and existing geometry behavior**

Run the command from Step 3. Expected: both files pass with no warnings.

- [ ] **Step 6: Commit Task 1 atomically**

Use an allowed substantive commit message and the repository's required chain:

```bash
git restore --staged . && git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/scheduling apps/web/tests/scheduling && git commit -F /tmp/cal-ux-task-1.txt
```

---

### Task 2: Adaptive axis, shared timezone, and zoom shortcuts

**Files:**

- Create: `apps/web/src/components/scheduling/scheduling-time-grid.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-types.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas.tsx`
- Modify: `apps/web/src/app/(app)/calendar/calendar-client.tsx`
- Modify: `apps/web/src/app/(app)/calendar/calendar-toolbar.tsx`
- Modify: `apps/web/src/app/(app)/calendar/calendar-schedule-model.ts`
- Modify: `apps/web/src/app/(app)/calendar/use-calendar-date-axis.ts`
- Modify: `apps/web/src/app/(app)/calendar/use-calendar-people-axis.ts`
- Modify: `apps/web/src/components/agenda/agenda-context.tsx`
- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx`
- Test: `apps/web/tests/scheduling/scheduling-canvas.test.tsx`
- Test: `apps/web/tests/calendar/calendar-schedule-model.test.ts`
- Create: `apps/web/tests/calendar/calendar-toolbar.test.tsx`

**Interfaces:**

- `SchedulingCanvasProps` gains `displayTimezone: string` and optional deterministic `now?: string`.
- `ScheduleLane.timezone` becomes secondary resource-timezone metadata; it never controls geometry.
- Calendar range/model hooks require `displayTimezone` and use `scheduleDateRange`.
- Agenda context exposes its resolved Hub timezone to the timeline.
- `CalendarToolbar` exposes three preset buttons calling the same `onZoomChange(number)` callback.

- [ ] **Step 1: Write failing axis and consumer tests**

Assert that 24 pixels/hour renders two-hour major labels plus 30-minute minor lines, 144 renders
30-minute major labels plus five-minute minor lines, and all label positions equal
`wallMinutes / 60 * pixelsPerHour`. Assert a fixed `now` renders a current-time line only on the
matching date lane. Assert people lanes display their timezone metadata while two equal instants
share one vertical position. Assert date ranges use the supplied Hub timezone.

Toolbar tests click Overview, Standard, and Detail and expect 24, 72, and 144 through
`onZoomChange`; the range slider must still accept intermediate values.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/scheduling/scheduling-canvas.test.tsx tests/calendar/calendar-schedule-model.test.ts tests/calendar/calendar-toolbar.test.tsx
```

Expected: missing adaptive-grid, display-timezone, current-line, and preset behavior.

- [ ] **Step 3: Extract the time-grid renderer and wire one timezone**

Move gutter labels, major/minor lines, transition annotation, and current-time line into
`scheduling-time-grid.tsx`. Keep the lane/header orchestration in `scheduling-canvas.tsx`. Resolve
Hub timezone once in Calendar and Agenda, pass it through range reads and mutation conversions, and
show resource timezone as compact header metadata in people mode.

- [ ] **Step 4: Add zoom shortcuts without adding view modes**

Render Overview, Standard, and Detail in one compact menu or segmented control beside the slider.
The selected preset is highlighted only on an exact scalar match. Slider changes between presets
remain first-class and persist through the existing Hub preference mutation.

- [ ] **Step 5: Verify GREEN**

Run the command from Step 2. Expected: all files pass with no warnings.

- [ ] **Step 6: Commit Task 2 atomically**

```bash
git restore --staged . && git add apps/web/src/components/scheduling apps/web/src/app/'(app)'/calendar apps/web/src/components/agenda apps/web/tests && git commit -F /tmp/cal-ux-task-2.txt
```

---

### Task 3: Deterministic visual collision layout

**Files:**

- Create: `apps/web/src/components/scheduling/scheduling-overlap-layout.ts`
- Create: `apps/web/src/components/scheduling/scheduling-item-card.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas.tsx`
- Modify: `apps/web/src/components/scheduling/index.ts`
- Delete: `apps/web/src/components/calendar/lane-layout.ts`
- Delete: `apps/web/src/components/calendar/calendar-timeline.tsx`
- Move/replace test: `apps/web/tests/calendar/lane-layout.test.ts` to
  `apps/web/tests/scheduling/scheduling-overlap-layout.test.ts`
- Modify test: `apps/web/tests/scheduling/scheduling-canvas.test.tsx`

**Interfaces:**

- Produces `layoutScheduleOverlaps(inputs, pixelsPerHour, minimumInteractivePixels)` returning
  `{ id, columnIndex, columnCount }`.
- `SchedulingItemCard` receives item geometry and placement; it does not own persistence.
- `SchedulingCanvas` computes one placement map per lane and renders cards in chronological order.

- [ ] **Step 1: Write failing production-path collision tests**

Cover identical pairs, partial pairs, nested triples, transitive chains, independent clusters,
input-order reversal, and adjacent short items whose minimum rendered height collides. Component
tests must assert distinct `left`/`width` styles for colliding cards, full width for disjoint cards,
and keyboard/pointer access to every identical-time item.

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @docket/web exec vitest run tests/scheduling/scheduling-overlap-layout.test.ts tests/scheduling/scheduling-canvas.test.tsx
```

Expected: the live canvas still gives every timed item `left: 4; right: 4`.

- [ ] **Step 3: Implement stable overlap columns**

Port the useful interval-graph sweep from the orphaned helper into the scheduling domain. Sort by
start ascending, effective duration descending, then id. Use effective end equal to the greater of
true end and `start + minimumInteractivePixels / pixelsPerHour * 60`. Assign the lowest available
column and the cluster's peak concurrency. Convert placement to percentage `left`/`width` with a
four-pixel internal gutter.

- [ ] **Step 4: Extract and polish the event card**

Move item markup out of the canvas. Use layer color for border plus a subtle `color-mix()` tint,
show title and locale-formatted time when height permits, use marker/compact/full density, and add
hover/focus elevation without changing collision placement. Preserve explicit drop-target styling
and accessible names.

- [ ] **Step 5: Remove orphaned layout/rendering code and verify GREEN**

Run the command from Step 2 and `rg "calendar-timeline|calendar/lane-layout" apps/web/src
apps/web/tests`. Expected: tests pass and no production/test import remains.

- [ ] **Step 6: Commit Task 3 atomically**

```bash
git restore --staged . && git add apps/web/src/components/scheduling apps/web/src/components/calendar apps/web/tests && git commit -F /tmp/cal-ux-task-3.txt
```

---

### Task 4: Live cancellable move and edge-resize gestures

**Files:**

- Create: `apps/web/src/components/scheduling/scheduling-gesture.ts`
- Create: `apps/web/src/components/scheduling/use-scheduling-gesture.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-item-card.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-types.ts`
- Test: `apps/web/tests/scheduling/scheduling-gesture.test.ts`
- Test: `apps/web/tests/scheduling/scheduling-canvas.test.tsx`

**Interfaces:**

- Pure `deriveGesturePreview()` receives mode, original bounds, pointer delta, lane geometry, zoom,
  snap, and lane policies; it returns a valid preview or `null` for a forbidden target.
- `useSchedulingGesture()` owns pointer capture, four-pixel activation, live preview, auto-scroll,
  Escape/pointer-cancel rollback, and one commit callback.
- Event body pointer movement moves; start/end grips resize; click without activation opens.

- [ ] **Step 1: Write failing pure gesture tests**

Cover same-lane move, cross-lane move, target `editable: false`, day-boundary clamp, start resize,
end resize, exact snap thresholds, and a five-minute event at 24 pixels/hour with zero delta
remaining five minutes.

- [ ] **Step 2: Write failing component interaction tests**

Assert live preview time text changes on pointer move before commit, pointer up emits the exact
previewed bounds, Escape and pointer cancel emit nothing, body click still opens, body drag moves,
both resize grips work, and forbidden lanes show no valid drop preview. Assert keyboard arrows on
grips adjust by active snap.

- [ ] **Step 3: Run the tests and verify RED**

```bash
pnpm --filter @docket/web exec vitest run tests/scheduling/scheduling-gesture.test.ts tests/scheduling/scheduling-canvas.test.tsx
```

Expected: current pointer-up-only handlers have no live/cancel/keyboard behavior and fail the new
contracts.

- [ ] **Step 4: Implement the pure controller and React hook**

Keep geometry in the pure module. The hook binds pointer/keyboard events, requests pointer capture,
updates an `aria-live="polite"` preview label, scrolls the viewport when within 32 pixels of an edge,
and commits only a changed valid preview. Do not create timers or polling loops; auto-scroll is
driven by pointer movement and stops immediately on end/cancel.

- [ ] **Step 5: Separate relationship drag from time movement**

Remove `draggable` from the item article. Put the typed native drag payload on a dedicated,
accessible relationship-drag affordance rendered only when `dragObject` exists. Keep task-to-item
drops on the whole event/timebox target.

- [ ] **Step 6: Verify GREEN**

Run the command from Step 3. Expected: all gesture and canvas tests pass with no leaked listeners or
React warnings.

- [ ] **Step 7: Commit Task 4 atomically**

```bash
git restore --staged . && git add apps/web/src/components/scheduling apps/web/tests/scheduling && git commit -F /tmp/cal-ux-task-4.txt
```

---

### Task 5: Consumer permission, persistence, and multi-day safety

**Files:**

- Modify: `apps/web/src/app/(app)/calendar/calendar-schedule-model.ts`
- Modify: `apps/web/src/app/(app)/calendar/calendar-scheduling-surface.tsx`
- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx`
- Modify: `apps/web/src/components/agenda/agenda-context.tsx`
- Test: `apps/web/tests/calendar/calendar-schedule-model.test.ts`
- Create: `apps/web/tests/calendar/calendar-scheduling-surface.test.tsx`
- Create: `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx`

**Interfaces:**

- One exported `isInlineEditableScheduleItem()` rule gates Calendar and Agenda.
- Mutation conversion always uses `scheduleInstantAt(date, wallMinutes, displayTimezone)`.
- Multi-day and all-day items remain openable/drop-capable but do not expose timed move/resize.

- [ ] **Step 1: Write failing integration tests**

Assert an editable native item emits exact timezone-aware optimistic patch instants after move and
both resizes. Assert provider items with `canEditCore: false`, conflict items, people lanes,
all-day items, and multi-day items expose no inline controls. Assert an Agenda multi-day provider
event cannot be collapsed by a clipped-day mutation. Assert a failed mutation rolls back through
the existing query mutation context and renders only fixed safe copy.

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @docket/web exec vitest run tests/calendar/calendar-schedule-model.test.ts tests/calendar/calendar-scheduling-surface.test.tsx tests/agenda/agenda-canvas-interactions.test.tsx
```

Expected: Agenda and Calendar currently use different editability rules and local `Date` mutation
conversion.

- [ ] **Step 3: Unify policy and exact persistence**

Move the inline-editability decision into the scheduling/date-lane seam or a focused calendar
adapter, consume it in both surfaces, and remove Agenda's broader permission shortcut. Convert
wall-minute proposals through the shared Temporal helper and preserve existing optimistic
range/detail cache patching and rollback.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2, then all scheduling/calendar/agenda focused tests. Expected: both
surface-specific files and the combined focused slice pass.

- [ ] **Step 5: Commit Task 5 atomically**

```bash
git restore --staged . && git add apps/web/src/app/'(app)'/calendar apps/web/src/components/agenda apps/web/src/components/scheduling apps/web/tests && git commit -F /tmp/cal-ux-task-5.txt
```

---

### Task 6: Documentation, repository gates, and visual evidence

**Files:**

- Modify: `docs/engineering/specs/calendar-ui.md`
- Modify: `docs/core/specs/layered-calendar.md`
- Modify: `docs/WORKLOG.md`
- Add or modify: `apps/web/e2e/layered-calendar.spec.ts` only for deterministic interaction
  assertions that can run in the repository's authenticated E2E harness.

**Interfaces:**

- Specs describe the same adaptive ticks, collision layout, timezone policy, permissions, and
  gesture semantics implemented above.
- WORKLOG records exact automated and browser evidence separately.

- [ ] **Step 1: Extend the critical E2E journey test-first**

Cover region selection, moving an editable native event, resizing start and end, simultaneous-event
visibility, and a read-only provider item. Run the focused E2E file and observe failure before any
production correction required by the test.

- [ ] **Step 2: Run focused and repository validation**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/scheduling tests/calendar tests/agenda
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
git rev-list --merges --count origin/main..HEAD
```

Expected: zero focused/repository failures attributable to this branch, a production build with the
calendar route, clean whitespace, and zero merge commits.

- [ ] **Step 3: Perform the real visual interaction pass**

In a browser-capable session, exercise desktop and narrow widths in light and dark themes. Record
region creation, continuous slider movement and all three presets, same/cross-lane event movement,
both resize edges, task/event relationship drops, three simultaneous events, read-only items,
server-error overlay, and a DST-transition date. Capture the video path and representative
screenshots in the WORKLOG evidence.

If no browser binding exists, leave CAL-UX-003 in REVIEW with this single external proof gap; do not
claim visual completion and do not substitute static code reading for a browser.

- [ ] **Step 4: Update specs and retrospective**

Record implemented behavior, files changed, exact test counts, visual evidence or its explicit
absence, what went well, what was corrected from the first canvas, and remaining product gaps.

- [ ] **Step 5: Commit Task 6 atomically**

```bash
git restore --staged . && git add apps/web/e2e/layered-calendar.spec.ts docs && git commit -F /tmp/cal-ux-task-6.txt
```

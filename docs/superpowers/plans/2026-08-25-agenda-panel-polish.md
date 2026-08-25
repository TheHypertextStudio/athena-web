# Agenda Panel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped Agenda toolbar with a scan-first day switcher and make the narrow timeline readable without visible scrollbar chrome, clipped labels, oversized all-day space, or unusable collision columns.

**Architecture:** Agenda will own a narrow-surface date header made from a month trigger, a seven-day strip, and one labeled view menu. The shared scheduling canvas will keep its date, gesture, persistence, and collision contracts. Its Agenda presentation will add safe outer gutters, compact all-day content, hidden scrollbar chrome, and effective-width collision calculations after work-location composition.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Docket UI primitives, Vitest, Testing Library, and Playwright.

---

## Reference decisions

Google Calendar separates nearby-date navigation, arbitrary-date selection, and view choice. It also exposes `t` for Today and `g` for a direct date jump. Agenda will preserve those jobs without copying Google's desktop toolbar into a 351px panel. See [Google Calendar date navigation](https://support.google.com/calendar/answer/6110849?co=GENIE.Platform%3DDesktop&hl=en-GB) and [Google Calendar keyboard shortcuts](https://support.google.com/calendar/answer/37034?hl=en-ie).

Fantastical's DayTicker is the better narrow-panel model. It presents nearby days as a horizontal sequence, synchronizes the selected day with the schedule, and uses a month calendar for longer jumps. See [Fantastical calendar views](https://flexibits.com/fantastical-ios/help/calendar-views).

Outlook keeps view and time-scale choices separate from date navigation. Agenda will retain that separation through one labeled `Timeline` or `List` menu instead of an unlabeled sliders icon. See [Outlook calendar views](https://support.microsoft.com/en-us/outlook/calendar/change-how-you-view-your-outlook-calendar) and [Outlook time scale](https://support.microsoft.com/en-us/outlook/change-the-calendar-view-in-outlook-for-mac).

Google renders an all-day work location as a location bar below the date and places a partial-day location in the timed grid. Agenda will keep that semantic split. See [Google Calendar working locations](https://support.google.com/calendar/answer/7638168?co=GENIE.Platform%3DDesktop&hl=en-au).

The implementation must satisfy this visual contract:

- Remove the current Previous, boxed date, Next, and icon-only Display row.
- Render an unboxed month-and-year trigger and one labeled view trigger inside 12px gutters.
- Render seven 40px date targets below them. Use a 32px tonal circle for the selected day and a small dot for Today.
- Page the strip by one week through a horizontal swipe or dominant horizontal trackpad gesture. Select any visible day immediately.
- Keep the existing mini month calendar for arbitrary jumps. Close it immediately after a selection.
- Keep Left, Right, `t`, and `g` shortcuts. Every path must use the existing unsaved-draft guard.
- Keep Timeline, List, and three density choices. Name the densities Compact, Comfortable, and Expanded.
- Keep 12px between the Sheet edge and both the first time label and the rightmost event.
- Hide scrollbar chrome only. Preserve wheel, touch, trackpad, Page Up, Page Down, Home, End, and programmatic scrolling.
- Render no empty work-location context row. When context or events exist, overlay the all-day create target instead of reserving a separate 40px text row. When the lane is otherwise empty, keep one 40px create row.
- Keep the partial-day work-location interaction track at 40px. Render a 28px tinted band and semantic marker inside it.
- Keep narrow timed cards to one title line and one time line. Use a compact 40px `+N` disclosure when collision columns become unreadable.

## File map

- Create `apps/web/src/components/agenda/agenda-day-strip.tsx` for the day model and week paging.
- Modify `apps/web/src/components/agenda/agenda-header.tsx` to compose the month picker, date strip, shortcuts, and view menu.
- Rename `apps/web/src/components/agenda/agenda-scale-controls.tsx` to `apps/web/src/components/agenda/agenda-display-menu.tsx`.
- Modify `apps/web/src/components/agenda/agenda-canvas.tsx` to provide the Agenda-only 12px frame.
- Modify `apps/web/src/components/scheduling/scheduling-canvas.tsx` and `packages/ui/src/styles/globals.css` to hide Agenda scrollbar chrome.
- Modify the scheduling types, all-day, dense-overflow, and item-body components to use content-driven rows and effective width.
- Modify `apps/web/src/components/work-location/work-location-calendar-components.tsx` to clarify the timed interval.
- Add focused component and Playwright evidence coverage. Write a new craft scorecard after authenticated screenshots exist.

### Task 1: Replace the four-control toolbar

**Files:**

- Create: `apps/web/src/components/agenda/agenda-day-strip.tsx`
- Modify: `apps/web/src/components/agenda/agenda-header.tsx`
- Rename: `apps/web/src/components/agenda/agenda-scale-controls.tsx` to `apps/web/src/components/agenda/agenda-display-menu.tsx`
- Create: `apps/web/tests/agenda/agenda-day-strip.test.tsx`
- Modify: `apps/web/tests/agenda/agenda-context-navigation.test.tsx:296-427`

- [ ] **Step 1: Write failing date-strip tests**

Render August 20, 2026. Assert a Sunday-to-Saturday strip for August 16 through August 22, 40px targets, `aria-current="date"` on August 20, and no Previous or Next buttons.

```tsx
const strip = screen.getByRole('list', { name: 'Choose a day' });
expect(within(strip).getAllByRole('button')).toHaveLength(7);
expect(within(strip).getByRole('button', { name: 'Thursday, August 20' })).toHaveAttribute(
  'aria-current',
  'date',
);
expect(screen.queryByRole('button', { name: 'Previous day' })).not.toBeInTheDocument();
expect(screen.queryByRole('button', { name: 'Next day' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Add the pure visible-week model**

Use shared calendar-day arithmetic. Do not parse `YYYY-MM-DD` through local midnight.

```ts
export function agendaWeek(selected: string, today: string): readonly AgendaDayCell[] {
  const start = addDays(selected, -weekdayOf(selected));
  return Array.from({ length: 7 }, (_, index) => {
    const iso = addDays(start, index);
    return {
      iso,
      weekday: formatDay(iso, { weekday: 'narrow' }) ?? '',
      day: formatDay(iso, { day: 'numeric' }) ?? '',
      selected: iso === selected,
      today: iso === today,
    };
  });
}
```

- [ ] **Step 3: Render semantic date cells without button chrome**

```tsx
<div role="list" aria-label="Choose a day" className="grid grid-cols-7 gap-1">
  {days.map((day) => (
    <div key={day.iso} role="listitem">
      <button
        type="button"
        aria-label={longDayLabel(day.iso)}
        aria-current={day.selected ? 'date' : undefined}
        className="focus-visible:ring-ring relative flex min-h-10 min-w-10 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2"
        onClick={() => onSelect(day.iso)}
      >
        <span className="text-label-small">{day.weekday}</span>
        <span
          className={
            day.selected
              ? 'bg-primary-container text-on-primary-container flex size-8 items-center justify-center rounded-full'
              : 'flex size-8 items-center justify-center'
          }
        >
          {day.day}
        </span>
      </button>
    </div>
  ))}
</div>
```

- [ ] **Step 4: Add bounded week paging**

Use a 48px horizontal pointer threshold. Ignore vertical scroll. A completed page keeps the selected weekday and calls the existing guarded `goToDate` path.

```ts
goToDate(shiftISODate(date, direction === 'next' ? 7 : -7));
```

Do not add arrows, carousel dots, or a second horizontal scrollport.

- [ ] **Step 5: Restyle the DatePicker as an unboxed month trigger**

```tsx
<DatePicker
  value={date}
  onChange={(nextDate) => {
    if (nextDate) goToDate(nextDate);
  }}
  formatLabel={(value) =>
    value ? (formatDay(value, { month: 'long', year: 'numeric' }) ?? value) : undefined
  }
  placeholder="Choose date"
  ariaLabel="Agenda date"
  today={today}
  triggerVariant="ghost"
  triggerClassName="text-title-small min-h-10 min-w-0 justify-start px-0"
/>
```

- [ ] **Step 6: Replace the icon-only Display trigger**

Keep the current menu state. Label the trigger with the active view. Map the three scale steps to product terms.

```ts
const DENSITY_LABELS = ['Compact', 'Comfortable', 'Expanded'] as const;
```

```tsx
<Button aria-label={`${viewLabel} view options`} variant="ghost" className="min-h-10 px-2">
  {viewLabel}
  <ChevronDown aria-hidden="true" />
</Button>
```

- [ ] **Step 7: Preserve guarded shortcuts**

The header group handles Left, Right, `t`, and `g`. Wrap the DatePicker in `datePickerHostRef`; `g` clicks the button inside that host. The other keys call the existing navigation actions.

- [ ] **Step 8: Run the focused tests**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/agenda/agenda-day-strip.test.tsx \
  tests/agenda/agenda-context-navigation.test.tsx \
  --maxWorkers=1
```

Expected: both files pass.

- [ ] **Step 9: Commit the header slice**

```text
feat(web): Replace Agenda toolbar with direct day switching

The rail copied a desktop calendar toolbar into a narrow panel. Its arrow
buttons, boxed date field, and icon-only display control consumed width without
making nearby dates scannable.

Agenda now uses a seven-day strip synchronized with the selected date. The
month label opens the existing mini calendar for arbitrary jumps, while the
view menu remains separate and uses named density choices.

Co-authored-by: Codex <noreply@openai.com>
```

### Task 2: Add safe gutters and hide scrollbar chrome

**Files:**

- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx:275-337`
- Modify: `apps/web/src/components/scheduling/scheduling-canvas.tsx:239-266`
- Modify: `packages/ui/src/styles/globals.css:788-830`
- Modify: `apps/web/tests/scheduling/scheduling-canvas-agenda-presentation.test.tsx`
- Modify: `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx`

- [ ] **Step 1: Write failing presentation tests**

Assert that Agenda uses the hidden-scrollbar utility, Calendar does not, and the Agenda frame has 12px inline padding with no second `overflow-auto` owner.

```tsx
expect(screen.getByRole('region', { name: 'Schedule' })).toHaveClass('scrollbar-none');
expect(screen.getByTestId('agenda-canvas-frame')).toHaveClass('px-3', 'overflow-hidden');
```

- [ ] **Step 2: Add one reusable utility beside the global scrollbar rules**

```css
@utility scrollbar-none {
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}
```

- [ ] **Step 3: Apply it only to Agenda presentation**

```tsx
className={`bg-surface relative overflow-auto overscroll-contain ${
  presentation === 'agenda' ? 'scrollbar-none' : 'rounded-xl'
}`}
```

- [ ] **Step 4: Frame the unchanged scheduling coordinate system**

```tsx
<div data-testid="agenda-canvas-frame" className="h-full min-h-0 overflow-hidden px-3">
  <SchedulingCanvas presentation="agenda" viewportHeight="100%" {...canvasProps} />
</div>
```

Do not pad the lane itself. The time axis, current-time line, work-location track, and events must retain one coordinate system.

- [ ] **Step 5: Prove the scroll contract still exists**

Set `scrollTop` programmatically and assert that the element retains `overflow-auto`, `overscroll-contain`, and `scrollbar-none`. Exercise wheel, touch, and Page Down in the Playwright task, where the browser owns native scrolling.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/scheduling/scheduling-canvas-agenda-presentation.test.tsx \
  tests/agenda/agenda-canvas-interactions.test.tsx \
  --maxWorkers=1
```

Expected: both files pass.

- [ ] **Step 7: Commit the viewport slice**

```text
fix(web): Keep Agenda content clear of panel edges

Agenda used the Sheet edge as its time-label gutter and exposed a permanent
browser scrollbar beside full-width event cards. It now owns a 12px frame
around the unchanged scheduling geometry and hides scrollbar chrome without
disabling any scroll input.

Co-authored-by: Codex <noreply@openai.com>
```

### Task 3: Compact the all-day area

**Files:**

- Modify: `apps/web/src/components/scheduling/scheduling-canvas-header.tsx:107-210`
- Modify: `apps/web/src/components/scheduling/scheduling-all-day-lane.tsx:7-112`
- Modify: `apps/web/src/components/work-location/work-location-calendar-components.tsx`
- Modify: `apps/web/tests/scheduling/scheduling-canvas-agenda-presentation.test.tsx`
- Modify: `apps/web/tests/scheduling/scheduling-all-day-overflow.test.tsx`
- Modify: `apps/web/tests/work-location/work-location-calendar-components.test.tsx`

- [ ] **Step 1: Write four failing state tests**

Cover no all-day content, one all-day location, one all-day event, and both. Assert that an otherwise empty lane renders one 40px create row. Assert that context or events do not gain a second create row.

- [ ] **Step 2: Pass the existing presentation union into `SchedulingAllDayLane`**

```tsx
<SchedulingAllDayLane presentation={presentation} {...laneProps} />
```

Do not add a Boolean that can disagree with `presentation`.

- [ ] **Step 3: Make Agenda rows content-driven**

Remove the unconditional `min-h-5` and `mt-1` in Agenda. Render context and items in 4px-spaced rows. Keep Calendar unchanged.

- [ ] **Step 4: Overlay the all-day create target**

```tsx
<button
  type="button"
  className="focus-visible:ring-ring hover:bg-primary-container absolute top-0 right-0 flex size-10 items-center justify-center rounded-full opacity-0 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 [@media(pointer:coarse)]:opacity-100"
  aria-label={`Create all-day item for ${lane.label}`}
>
  <Add aria-hidden="true" className="size-5" />
</button>
```

Reserve its inline width inside the first row. Do not render the `+ All day` text row.

- [ ] **Step 5: Reduce work-location chip chrome**

Keep a 40px target. Render a 28px tonal chip inside it with the Home or MapPin icon and full place label.

- [ ] **Step 6: Keep overflow bounded**

Calendar retains three primary all-day items. Agenda shows two primary rows and then the existing accessible disclosure.

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/scheduling/scheduling-canvas-agenda-presentation.test.tsx \
  tests/scheduling/scheduling-all-day-overflow.test.tsx \
  tests/work-location/work-location-calendar-components.test.tsx \
  --maxWorkers=1
```

Expected: all three files pass.

- [ ] **Step 8: Commit the all-day slice**

```text
fix(web): Collapse unused Agenda all-day space

Agenda reserved separate touch rows for work location and all-day creation.
The header now renders only occupied rows, overlays its create target, and uses
smaller visual chips inside the same accessible touch targets.

Co-authored-by: Codex <noreply@openai.com>
```

### Task 4: Clarify partial-day work-location intervals

**Files:**

- Modify: `apps/web/src/components/work-location/work-location-calendar-components.tsx:430-760`
- Modify: `apps/web/tests/work-location/work-location-calendar-components.test.tsx`
- Modify: `apps/web/tests/scheduling/scheduling-composition-seams.test.tsx`

- [ ] **Step 1: Write failing band and marker tests**

Assert one 40px interaction track, one 28px visual band, rounded endpoints, and a 40px semantic marker. Keep the existing accessible names and edit announcements.

- [ ] **Step 2: Render one semantic tinted band**

```tsx
<span
  aria-hidden="true"
  className="bg-tertiary-container/35 absolute left-1.5 w-7 rounded-full"
  style={{ top, height }}
  data-work-location-band={region.id}
/>
<span
  aria-hidden="true"
  className="bg-tertiary absolute left-[19px] w-0.5 rounded-full"
  style={{ top, height }}
/>
```

- [ ] **Step 3: Preserve gesture geometry**

Keep the marker centered in the 40px track. Do not make the visual band another pointer target. Pointer move, both resize edges, keyboard edits, announcements, rejected edits, and exact persistence must keep the existing callback contract.

- [ ] **Step 4: Keep cluster-wide insets**

Retain `resolveWorkLocationTimedLeadingInset`. Every event and dense disclosure in an intersecting transitive cluster must use the same inset.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/work-location/work-location-calendar-components.test.tsx \
  tests/scheduling/scheduling-composition-seams.test.tsx \
  --maxWorkers=1
```

Expected: both files pass.

- [ ] **Step 6: Commit the location slice**

```text
fix(work-location): Clarify partial-day location intervals

The existing marker and line avoided event overlap, but they did not read as
one owned interval. Partial-day locations now use a quiet tinted band and
rounded endpoints inside the existing interaction track.

Co-authored-by: Codex <noreply@openai.com>
```

### Task 5: Make collision density use effective width

**Files:**

- Modify: `apps/web/src/components/scheduling/scheduling-canvas.tsx:199-237`
- Modify: `apps/web/src/components/scheduling/scheduling-types.ts:265-403`
- Modify: `apps/web/src/components/scheduling/scheduling-dense-overflow.ts`
- Modify: `apps/web/src/components/scheduling/scheduling-dense-overflow-ui.tsx`
- Modify: `apps/web/src/components/scheduling/scheduling-item-card.tsx:67-176`
- Modify: `apps/web/src/components/scheduling/scheduling-item-body.tsx:24-116`
- Modify: `apps/web/tests/scheduling/scheduling-composition-seams.test.tsx`
- Modify: `apps/web/tests/scheduling/scheduling-dense-overflow.test.ts`
- Modify: `apps/web/tests/scheduling/scheduling-item-presentation.test.tsx`

- [ ] **Step 1: Write the failing geometry regression**

Use a 300px lane, a 40px leading inset, and three overlapping events. Assert that the arrangement creates one direct column plus one disclosure column. Assert that the same lane without the inset keeps all three direct cards.

- [ ] **Step 2: Extend dense-arrangement options**

```ts
export interface DenseScheduleArrangementOptions {
  readonly promotedItemId?: string;
  readonly leadingInsetByCluster?: ReadonlyMap<string, number>;
  readonly minimumReadableItemWidth?: number;
}
```

Compute capacity per cluster from `laneWidth - clusterInset`. Agenda passes 96px. Calendar keeps the existing 72px default.

Expose the threshold through the neutral canvas contract:

```ts
readonly minimumReadableTimedItemWidth?: number | undefined;
```

Agenda passes `minimumReadableTimedItemWidth={96}`. Calendar omits the prop.

- [ ] **Step 3: Resolve insets before dense arrangement**

Build `leadingInsetByCluster` from positioned items first. Pass it to `arrangeDenseScheduleItems`. Render direct cards and disclosures from that same map.

- [ ] **Step 4: Make title clamp width-aware**

Pass `estimatedWidth` into `SchedulingItemBody`.

```ts
function titleLineClamp(height: number, width: number): 1 | 2 | 3 {
  if (width < 136 || height < 64) return 1;
  if (width < 180 || height < 96) return 2;
  return 3;
}
```

Keep the full title and exact range in the accessible name and native tooltip.

- [ ] **Step 5: Compact dense disclosure chrome**

Cap the visible disclosure at 40px. Show `+N` below 96px. Keep `Show N more events in <date>` as its accessible name and keep every hidden event in the popover.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/scheduling/scheduling-composition-seams.test.tsx \
  tests/scheduling/scheduling-dense-overflow.test.ts \
  tests/scheduling/scheduling-item-presentation.test.tsx \
  --maxWorkers=1
```

Expected: all three files pass.

- [ ] **Step 7: Commit the density slice**

```text
fix(web): Keep narrow Agenda collisions readable

Dense-overlap capacity used the full lane width before work-location
composition removed 40px. The collision pass now uses each cluster's effective
width, caps narrow titles, and renders compact overflow controls.

Co-authored-by: Codex <noreply@openai.com>
```

### Task 6: Run gates and capture authenticated proof

**Files:**

- Create: `apps/web/e2e/calendar/agenda-panel-polish-evidence.spec.ts`
- Create: `docs/design/audits/2026-08-25-agenda-panel-polish.md`
- Create: `docs/design/audits/screenshots/2026-08-25-agenda-panel-polish/*`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Check resource pressure**

```bash
~/.claude/resource-limits/agentctl status
```

If the command is missing, record that once and continue with two-worker limits. If the process forest is near its ceiling, report the blocker before broad checks.

- [ ] **Step 2: Run the complete focused slice with one worker**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/agenda/agenda-day-strip.test.tsx \
  tests/agenda/agenda-context-navigation.test.tsx \
  tests/agenda/agenda-canvas-interactions.test.tsx \
  tests/scheduling/scheduling-canvas-agenda-presentation.test.tsx \
  tests/scheduling/scheduling-all-day-overflow.test.tsx \
  tests/scheduling/scheduling-composition-seams.test.tsx \
  tests/scheduling/scheduling-dense-overflow.test.ts \
  tests/scheduling/scheduling-item-presentation.test.tsx \
  tests/work-location/work-location-calendar-components.test.tsx \
  --maxWorkers=1
```

Expected: every test passes with no skips.

- [ ] **Step 3: Run bounded repository gates**

```bash
pnpm test:tooling
pnpm exec turbo run typecheck --concurrency=2
pnpm lint
pnpm exec turbo run test --concurrency=2 -- --maxWorkers=2
pnpm exec turbo run build --concurrency=2
```

Expected: every command exits 0. Treat exit 137 with no output as a resource kill. Do not rerun unchanged.

- [ ] **Step 4: Reuse the existing authenticated Chrome session**

Do not launch another browser instance. Capture the populated August 20 state at 1440x900 and 390x844 in light and dark. Capture 320x844 dark. Include one all-day location, two partial-day locations, one boundary-crossing event, one two-column overlap, and one dense disclosure.

- [ ] **Step 5: Verify the narrow contract**

Assert the following in the browser:

```text
document.documentElement.scrollWidth === document.documentElement.clientWidth
schedule.scrollHeight > schedule.clientHeight
schedule.clientWidth === schedule.offsetWidth
every date cell and work-location control is at least 40px in both axes
the first time label begins at least 12px inside the Sheet edge
the rightmost event ends at least 12px before the Sheet edge
no Previous, Next, or icon-only Display control exists
```

Tab through the month trigger, view trigger, seven dates, all-day create target, work-location markers, event cards, and dense disclosure. Verify every focus ring. Verify Page Down moves the hidden-scrollbar schedule.

- [ ] **Step 6: Write the replacement scorecard**

Score all eight Docket Craft Rubric dimensions with screenshot or DOM evidence. Mark `SHIP` only when every score is at least 3 and every hard gate passes. State that the new review supersedes the August 24 scorecard, which missed the edge pressure, all-day height, and dense-card failures visible in the August 25 capture.

- [ ] **Step 7: Complete the worklog and commit evidence**

Move `AGENDA-POLISH-004` to Completed only after authenticated captures and all gates pass.

```text
chore(design): Record the corrected Agenda panel

The August 24 scorecard passed a state that still pressed labels and controls
against panel edges, exposed scrollbar chrome, and allowed dense events to
become unreadable. This scorecard records the corrected surface at desktop,
mobile, and 320px in both themes.

Co-authored-by: Codex <noreply@openai.com>
```

- [ ] **Step 8: Verify linear history and a clean task state**

```bash
git rev-list --merges --count origin/main..HEAD
git status --short
```

Expected: merge count `0`. No uncommitted file owned by this task remains.

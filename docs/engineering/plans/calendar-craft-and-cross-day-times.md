# Calendar craft and cross-day time implementation plan

> **For Calendar maintainers:** Keep the measured date axis, exact cross-day labels, compact
> overlap disclosure, and phone editor when changing this view. The dated craft review records
> the visual acceptance evidence.

**Goal:** Keep Docket's traditional editable calendar while fixing the September 23 layout audit
and making every timed event that crosses a local calendar day display correct times.

**Architecture:** The shared scheduling canvas owns day geometry, overlap, card rendering, and
gesture labels. Calendar owns sources, presentation copy, and the item workspace. Connected
calendars remain compatibility sources; the visible activity kind sets the base treatment, while
source identity remains available in the item details and layer control.

**Tech Stack:** Next.js, React, Tailwind/MD3 tokens, TanStack Query, Temporal, Vitest, Playwright.

---

## Decision and current evidence

This is a tactical Calendar pass. Keep the 24-hour time grid, all-day events, simultaneous event
access, rolling date viewport, continuous zoom, direct creation, and permission-aware editing.
Do not add a planning dashboard, create a day/week mode in `SchedulingCanvas`, or classify
provider events by words such as “Sleep” or “Travel” in their titles. The existing `/plan` and Today
surfaces retain their own jobs. A later stream model may carry richer activity types, but this pass
must work with the item kinds Docket already has.

The implementation review changed two presentation rules. The user rejected source-color stripes,
including stripes that wrap rounded card corners, so source color now contributes only a slight
event-fill tint. A measured Calendar canvas below 600 px shows one whole day. Foldable and tablet
widths add days progressively; the desktop canvas still reaches seven. Narrow collision clusters
now keep one readable card and put every other item in a `+N` disclosure near its start time.
Phone taps open a full-height event workspace directly because the anchored peek and centered
dialog consumed space without helping a phone reader. The initial render shows the known date
and starting hours while width measurement determines the later lane count. The [dated scorecard](../../design/audits/2026-09-23-calendar.md)
records the final visual evidence.

The user-supplied September 23 screenshot shows a roughly 200 px all-day/header area, a partly
hidden midnight tick, large saturated blue timed events, truncated identifying titles, weak
today emphasis, a month-only range heading, equally weighted toolbar controls, and many unreadable
open-document tabs. The screenshot is evidence for that captured state, not proof that every
current theme and viewport has the same defect. The dated craft review records the resulting layout at five widths and both themes.

The current code projects timed event instants into local day lanes in
`scheduling-lane-projection.ts` and formats each card from clipped instants in
`scheduling-time-label.ts`. The initial test proved that a full middle-day card read
`12:00 AM – 12:00 AM` without saying that the second midnight was on the next date. The item peek
also showed only the starting date, so its end time lacked a date on an overnight event. Both defects are fixed on this branch and have rendered and browser tests.

## Cross-day label result

- A rendered-card regression test failed on `12:00 AM – 12:00 AM`; the middle-day label now says
  `12:00 AM – 12:00 AM next day` in visible text, its accessible name, and its title.
- The shared event-day label now includes both local dates, with years, for a timed item that
  crosses a day. The Calendar peek and detail use the same helper. Rendered tests cover the peek,
  and the browser spec covers the detail surface.
- Seven scheduling label cases now cover UTC overnight, viewer-local overnight, midnight end,
  three-day middle, spring and fall clock changes, and a year boundary. The source instants and
  lane geometry remain unchanged. Browser and screenshot acceptance pass.

## File ownership

| Responsibility                      | Owned files                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact day segments and labels       | `apps/web/src/components/scheduling/scheduling-lane-projection.ts`, `apps/web/src/components/scheduling/scheduling-time-label.ts`, `apps/web/src/components/scheduling/scheduling-date-lanes.ts`                   |
| Calendar and Agenda card geometry   | `apps/web/src/components/scheduling/scheduling-item-card.tsx`, `apps/web/src/components/scheduling/scheduling-item-body.tsx`, `apps/web/src/components/scheduling/scheduling-time-grid.tsx`                        |
| All-day and work-location structure | `apps/web/src/components/scheduling/scheduling-canvas-header.tsx`, `apps/web/src/components/scheduling/scheduling-all-day-lane.tsx`, `apps/web/src/components/work-location/work-location-calendar-components.tsx` |
| Card tone and title                 | `apps/web/src/components/scheduling/scheduling-item-surface.ts`, `apps/web/src/components/scheduling/scheduling-all-day-item.tsx`, `apps/web/src/app/(app)/calendar/calendar-schedule-item-content.tsx`            |
| Calendar navigation                 | `apps/web/src/app/(app)/calendar/calendar-range-label.ts`, `apps/web/src/app/(app)/calendar/calendar-toolbar.tsx`, `apps/web/src/app/(app)/calendar/calendar-client.tsx`                                           |
| Whole-event dates and times         | `apps/web/src/components/calendar/item-presentation/event-identity.ts`, `apps/web/src/components/calendar/item-peek/calendar-item-peek.tsx`, `apps/web/src/components/calendar/item-drawer/event-masthead.tsx`     |
| Open-document strip                 | `packages/ui/src/components/shell/TabBar.tsx` and its existing TabItem/overflow companions                                                                                                                         |
| Product contract and evidence       | `docs/engineering/specs/calendar-ui.md`, `docs/design/audits/`, `docs/WORKLOG.md`                                                                                                                                  |

## Cross-day time contract

Use the selected viewer IANA timezone for both lane boundaries and labels. A timed item is the
half-open exact range `[startsAt, endsAt)`. Its visible segment on date `D` is the intersection
with `[D at local midnight, D+1 at local midnight)`. Render no zero-length segment on an end date
when the item ends exactly at midnight. Keep the exact `startsAt` and `endsAt` for the item
workspace and mutations; a clipped segment never becomes a new event.

Each timed card describes its **visible portion**. A card on the starting day ends at local
midnight; a continuation card begins at local midnight; a full middle-day card must say that its
ending midnight is **the next day**. Keep the locale's time format. Add short timezone names when
the offset changes or a repeated wall time needs disambiguation. The item peek/workspace describes
the **whole item** with both local dates and times. Gesture announcements describe the proposed
exact instants and must agree with the eventual saved range.

The implementation must prove these cases with deterministic fixtures:

| Case              | Exact input and viewer zone                                      | Required visible result                                                                                       |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Overnight         | `2026-09-23T23:30Z` → `2026-09-24T01:15Z`, UTC                   | Sep 23 is 11:30 PM–midnight; Sep 24 is midnight–1:15 AM. The workspace names both dates.                      |
| Midnight end      | `2026-09-23T23:30Z` → `2026-09-24T00:00Z`, UTC                   | Only the Sep 23 segment renders.                                                                              |
| Full middle day   | `2026-09-23T22:00Z` → `2026-09-25T02:00Z`, UTC                   | Sep 24 labels its midnight-to-midnight segment as ending **next day**, not as a zero-hour event.              |
| Viewer timezone   | `2026-09-24T06:30Z` → `2026-09-24T08:15Z`, `America/Los_Angeles` | Sep 23 shows 11:30 PM–midnight; Sep 24 shows midnight–1:15 AM. UTC dates never determine the displayed lanes. |
| Spring transition | `2026-03-08T07:30Z` → `2026-03-08T11:30Z`, `America/Los_Angeles` | Mar 7 and Mar 8 segments reflect PST→PDT, and no nonexistent 2 AM endpoint is invented.                       |
| Fall transition   | `2026-11-01T06:30Z` → `2026-11-01T10:30Z`, `America/Los_Angeles` | Oct 31 and Nov 1 segments preserve both exact instants and disambiguate repeated wall time where needed.      |
| Year boundary     | `2026-12-31T23:30Z` → `2027-01-01T01:15Z`, UTC                   | Both date lanes, range heading, peek, and workspace name the correct year.                                    |

All-day items keep their exclusive end-date model and do not acquire fake 12 AM timed labels.
Apply the same shared-card behavior in Calendar and Agenda without changing Agenda's single-day
navigation.

## Implementation tasks

### 1. Record visual evidence and the failing cross-day label case

- [x] Capture `/calendar` at 1440×900 and 390×844 in light and dark with a deterministic fixture
      containing a long title, an overnight event, a three-day timed event, three concurrent items,
      dense all-day items, and work location. Save sanitized screenshots under a new dated
      `docs/design/audits/screenshots/` directory; do not commit the user's private screenshot.
- [x] Measure sticky-header height, first hour-label bounds, card/lane gutters, and page overflow
      at 320 px. Record the values and the current eight-dimension Docket Craft Rubric score in a
      dated `docs/design/audits/` scorecard.
- [x] Add a failing rendered-card test in
      `apps/web/tests/scheduling/scheduling-crossday-time-labels.test.tsx` for the full middle-day
      fixture in the table. The accessible name and title must distinguish its ending midnight from
      its starting midnight. Run it alone with `--maxWorkers=2` and record the expected failure.

### 2. Make cross-day times exact and unambiguous

- [x] Extend `presentScheduleItemTimeRange` in `scheduling-time-label.ts` to mark the second
      midnight as `next day` on a full middle-day segment. The clipped exact instants,
      `formatScheduleInstantRange` DST-zone behavior, and preview validation remain intact.
- [x] Check `scheduling-lane-projection.ts` against the case matrix. Keep
      the half-open intersection, skip a zero-duration midnight-end segment, and do not infer a
      24-hour duration from identical wall-clock labels across a DST transition. No geometry change
      was needed in the focused tests.
- [x] Cover all seven cases in rendered scheduling tests and verify the existing geometry tests.
      Add Calendar peek tests for both local dates and whole-event times. The item workspace reads
      the same helper, and the browser spec below must prove its rendered copy.
- [x] Add `apps/web/e2e/calendar/calendar-crossday-times.spec.ts` with one overnight and one
      three-day browser-visible item. Assert the labels in each visible lane, open the item, and
      assert the same exact item owns both segments. Edit a multi-day endpoint through the item
      form, since the canvas deliberately offers no timed move/resize handles for multi-day items.
      Verify the exact endpoint persists once.
- [x] Run the focused Web tests and e2e spec with two workers. A label that reads `12:00 AM –
12:00 AM` without `next day` fails this task even if its geometry tests pass.

### 3. Reclaim vertical space and fix the midnight tick

- [x] Separate work-location day context from all-day events inside the shared header. Keep Home
      and named places visible on one compact row. Do not label work location as an all-day event.
      Keep the existing work-location edit and accessible control paths.
- [x] Show at most two all-day event rows per date in Calendar, followed by a specific count and
      an accessible expansion control. Keep every hidden event reachable. The create action must not
      reserve another full empty row. Preserve Agenda's independently chosen density.
- [x] Align the first and last tick labels inside `scheduling-time-grid.tsx` so the midnight label
      is wholly visible below the sticky header. Preserve tick geometry and the keyboard/pointer
      minute mapping.
- [x] Update `scheduling-all-day-overflow.test.tsx`, work-location component tests, and the
      Calendar viewport-floor e2e test. At 1440×900 with two visible all-day rows, the sticky header
      should be no more than 128 px high. Verify the dense overflow case separately.

### 4. Restore readable card and grid hierarchy

- [x] Replace the large saturated event fill in `scheduling-item-surface.ts` with a quiet semantic
      surface and readable foreground. Keep source color as a slight fill tint, including for all-day
      items. Use theme tokens and test contrast in both themes. Timeboxes and availability retain
      distinct treatments. Do not classify imported events by title.
- [x] Remove the forced single-line `truncate` in Calendar's title renderer so the shared card's
      measured one-, two-, or three-line clamp works. Keep short and overlapping cards compact, and
      ensure focus/click exposes the full title and exact time.
- [x] Tune lane insets, overlap gaps, title/time type hierarchy, and today-lane tint on the 4 px
      rhythm. Keep one directly readable event in a narrow overlap cluster and every other event
      reachable from a nearby `+N` disclosure. The current-time line remains visible below text.
- [x] Extend `scheduling-item-presentation.test.tsx`, the color/contrast tests, and Calendar
      browser fixtures. Verify a long title in a tall card, two narrow overlapping cards, a short
      event, an all-day event, and light/dark palettes at desktop and phone widths.

### 5. Tighten calendar navigation and shell chrome

- [x] Change Calendar's heading from a month-only label to the actual visible range. Show the
      full local year in the accessible name; shorten only the visual text when the toolbar narrows.
      Update `calendar-range-label.test.ts` for same-month, cross-month, and cross-year ranges.
- [x] Make Calendars/Display visually secondary to the create control without changing their
      functions. The create control must reveal whether it will create an event or timebox before
      persistence. Keep the one-row, 320 px-safe toolbar contract.
- [x] Reduce the open-document row's visual weight when many tabs are open. Preserve active-tab
      identity, close targets, keyboard navigation, and the overflow menu; do not invent a Calendar or
      Athena document tab. Test a 32-tab state and the no-tabs state. Keep this shell change in its
      own reviewable commit because every app route uses `TabBar`.
- [x] Remove only padding and nested framing that fresh screenshots show to be wasteful. The grid
      must gain usable space without cutting off resize grips, popovers, the scrollbar, or focus rings.

### 5a. Stabilize first paint and phone event details

- [x] Show the selected date and starting hour labels on first paint, before the viewport
      reports a nonzero width. Reattach the resize observer after the initial frame gives way to
      the real scrollport. Confirm
      one date at 320, 390, and 430 px, two at 768 px, and seven at 1440 px after resizing.
- [x] Give the loading state a recognizable calendar grid rather than misaligned dates or a blank
      page. Keep item loading and failure status on top of the real grid after it appears.
- [x] Let a phone event tap open a full-height workspace directly. Stack start and end fields,
      preserve safe-area insets, and keep the close control at the top. Check an event with a long
      title at 390 px and 320 px. Desktop retains the anchored peek.

### 6. Prove the complete slice and update the product contract

- [x] Run focused tests for scheduling, Calendar, Agenda, work location, and tabs with
      `--maxWorkers=2`. Run Web typecheck and lint through Turbo with bounded concurrency, then the Web
      build with the repo's process-local heap setting.
- [x] Run the calendar browser specs with `--workers=2`. Capture fresh 1440×900 and 390×844
      screenshots in both themes, a 320 px overflow check, an open-documents overflow state, and
      a cross-day event state. Check keyboard focus, contrast, all-day expansion, and direct editing.
- [x] Update `docs/engineering/specs/calendar-ui.md` with the chosen range-heading, card tone,
      compact header, and cross-day label rules. Finish the dated craft scorecard and the
      `CALENDAR-CRAFT-002` WORKLOG entry with files, measurements, tests, and remaining limits.
- [x] Self-review the diff, keep commits scoped to owned changes, and verify
      `git rev-list --merges --count origin/main..HEAD` returns `0` before presenting the finished
      implementation.

## Commands and ship bar

Use the project package manager and bounded runners. The relevant commands are:

```bash
pnpm --filter @docket/web exec vitest run tests/scheduling/scheduling-geometry.test.ts tests/scheduling/scheduling-crossday-time-labels.test.tsx --maxWorkers=2
pnpm --filter @docket/web exec vitest run tests/calendar tests/scheduling tests/agenda tests/work-location --maxWorkers=2
pnpm exec turbo run typecheck lint --filter=@docket/web... --concurrency=1
env API_URL=https://api.docket.localhost NEXT_PUBLIC_API_URL=https://api.docket.localhost NEXT_PUBLIC_APP_URL=https://docket.localhost NEXT_PUBLIC_PASSKEY_RP_ID=docket.localhost pnpm exec turbo run build --filter=@docket/web --concurrency=1
pnpm --filter @docket/web exec playwright test e2e/calendar --workers=2
pnpm exec prettier --check docs/engineering/plans/calendar-craft-and-cross-day-times.md docs/engineering/specs/calendar-ui.md docs/WORKLOG.md
```

Do not claim the UI is done from source inspection or unit tests alone. The screenshot scorecard
must show all eight rubric dimensions at 3 or better, and its accessibility, responsive, theme,
no-placeholder, and screenshot gates must pass. The seven cross-day cases above must pass in the
correct viewer timezone. Calendar and Agenda must keep their existing edit and read contracts.

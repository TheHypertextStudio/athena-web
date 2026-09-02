---
surfaces: ['calendar']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 2
  color: 3
  motion: 3
  states: 3
  detail: 2
gates:
  a11y: true
  responsive: false
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /calendar (rebuild, round 2) — 2026-08-02

**Verdict: BELOW BAR.** Hierarchy (4) and Detail craft (8) are at 2, and the **Responsive** gate is
red. Everything else clears the bar.

This reviews the uncommitted working tree described in the integration report, against
`docs/design/craft-rubric.md` plus the production-launch goal doc's "Core Functionality > Calendar"
and "UI Polish > Craft" sections. It supersedes nothing: `2026-08-02-calendar-round-1.md` remains the
record of the previous pass, and this document reports what moved and what did not.

Every claim below is backed by a PNG that was read as an image, or by a number printed from a probe
whose script is listed. Two things are explicitly **not** screenshot-verified this round and are
labelled as such rather than passed: the duplicate-calendar UI and the loading skeletons.

---

## Screenshots and machine evidence

Root: `apps/web/.data/design-review/calendar/after-round-2/`

| Set                | Files                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Standard shot set  | `calendar-{1440x900,390x844}-{light,dark}.png`                                                           |
| Width sweep (15)   | `sweep/sweep-{320,390,500,640,768,900,1023,1024,1180,1280,1366,1439,1440,1600,1920}.png` + `report.json` |
| Panel / gate       | `gate/w{390,768,1024,1280,1440,1600,1920}-open-{Tasks,Athena,Calendars,Display,New}.png` + `report.json` |
| Craft detail       | `detail/{w320-toolbar,w320-notice,menu-display,menu-new,after-pinch-zoom}.png` + `report.json`           |
| Populated fixtures | `populated/grid-{1440x900,1100x900,390x844}-{light,dark}.png` + `report.json`                            |
| Card legibility    | `cards/{1100,1440}-{light,dark}.png` + `report.json`                                                     |
| Lane geometry      | `final/lanes-{1024,1280,1440}.png`, `final/dedupe-{1440,390}-{light,dark}.png` + `report.json`           |
| Contrast / a11y    | `a11y/report.json`                                                                                       |
| Drag evidence      | `apps/web/test-results/calendar-calendar-drag-evi-*/drag-{1-before,2-after,3-block}.png`                 |

Probe scripts: `apps/web/.data/design-review/probe-r2-{sweep,gate,detail,final,dedupe,cards,a11y,focus}.ts`

---

## Rubric scores

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                                                            |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | Calm Plex/MD3 register throughout. Copy is application-owned and specific — "Nothing scheduled. Drag on the grid or choose New to plan time.", "Tasks due today land here — drag one onto the calendar to timebox it.", "Add a title to create this event." No provider text leaks. |
| 2. Typographic craft        | 3     | Zero ad-hoc sizes: `grep -rE 'text-\[[0-9]+px\]\|text-xs\|text-sm\|text-base\|text-lg'` over `app/(app)/calendar` + `components/scheduling` returns nothing. Only 12/14/16px render. Weight carries meaning (title 500, metadata 400, `h1` 600). Docked: 12px is 70% of text nodes. |
| 3. Spatial rhythm & density | 3     | Toolbar: six controls, all 32px at `@2xl` and 40px below, one row at all 15 widths. New form: all seven fields exactly 36px (`detail/report.json` → `newForm`). Hour rhythm even. Docked: mixed radii in the New popover (4px tabs vs 8px fields).                                  |
| 4. Hierarchy & info design  | **2** | Event fill separates from the canvas by **1.04:1** in light and **1.16:1** in dark (measured, `cards/report.json`). On a 154px card the never-truncating kind label takes 32px while the title truncates at 98px. Default 1440 state: 656px of chrome vs 717px of calendar.         |
| 5. Colour discipline        | 3     | The magenta `tertiary-container` selection is gone — the checked Display row is now `lab(88.18 −0.74 −16.70)` (a `secondary-container` blue) on an otherwise neutral surface. Both themes designed, not inverted. All text ≥ 5.81:1 in both themes (`a11y/report.json`).            |
| 6. Motion & feedback        | 3     | Focus rings present and consistent on every control walked. `ctrl`+wheel drove the canvas 100% → 333% live and persisted it; **Reset to default** restored 72px/hr. Disabled primary explains itself ("Add a title to create this event.").                                         |
| 7. States completeness      | 3     | Empty grid, empty rail, empty Calendars popover, populated grid, overlap columns, disabled-primary, and truncation states all designed and captured. Nothing dead. **Loading skeletons were not captured this round** — see Limitations.                                            |
| 8. Detail craft             | **2** | At 320 the New button's right edge is at **324px in a 320px viewport** (`detail/report.json`). At 1024/1100 today's date badge renders as a blue half-disc and today's event cards are sliced mid-word behind the sticky hour gutter. `scroll-snap-type: none`.                     |

**Ship bar is every dimension ≥ 3.** Dimensions 4 and 8 fail.

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Worst text contrast in the whole surface is **5.81:1** (the white `2` on the today badge); every other string is ≥ 6.7:1, in both themes at both widths. No touch target under 40px at 390. Landmarks labelled. Event cards expose named `Move …` / `Resize … from start` buttons. Tab order Today → ‹ → › → Calendars → Display → Athena → New → Schedule → rail, every one carrying the same 2px `lab(41.70 22.51 −73.93)` ring. |
| Responsive          | ❌     | **1439 → 1440 makes the calendar smaller**: schedule 1060px / 64.8% → 717px / 44.7%, four visible day lanes → two. Partial day lanes are clipped mid-glyph at 1024, 1100 and 1439. The New button overflows the viewport by 4px at 320.                                                                                                                                                                                            |
| Theme parity        | ✅     | Light + dark captured at 1440 and 390, empty and populated. Dark is designed rather than inverted — event fills go _darker_ than the canvas (`lab(7.73)` on `lab(14.68)`) instead of flipping the light treatment.                                                                                                                                                                                                                 |
| No placeholder      | ✅     | No lorem, no dead rows, no no-op buttons in any probed state. The disabled `Create event` carries an adjacent reason. The empty Calendars popover states the real situation and the two ways out.                                                                                                                                                                                                                                  |
| Screenshot-verified | ✅     | Every assertion above cites a captured PNG or a printed measurement. The two things I could not capture are named in Limitations rather than passed.                                                                                                                                                                                                                                                                               |

---

## Goal-doc bullets, scored individually

| #   | Requirement (verbatim, abbreviated)                         | Result          | Evidence                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Looks haphazard / stuffed / no craft                        | ❌ **FAIL**     | `populated/grid-1100x900-light.png`: today's badge is a blue half-disc, and today's two events read `cti… Calendar…` and `t / M – 3:00 PM` because the lane is scrolled under the sticky hour gutter. `sweep/sweep-1024.png` shows the same.                                   |
| 2   | Useless buttons/controls like zoom and density              | ✅ PASS         | Slider, `<select>`, button-group and density readout are all absent from the surface at every one of 15 widths. `detail/menu-display.png`                                                                                                                                      |
| 3   | Deduplicate holiday / personal calendars on work accounts   | ⚠️ NOT VERIFIED | The capability exists and is unit-tested (`Hide duplicates`, `Also on …`, `N duplicate calendars across accounts`), and the round-1 truncation was fixed by widening the popover to `w-[22rem]` and giving the note its own line. **I could not render it** — see Limitations. |
| 4   | Extremely clear hierarchy centred on events and time blocks | ❌ **FAIL**     | Round-1's untitled in-progress event is **fixed** (titles now clamp). But the card fill is 1.04:1 against empty grid in light and 1.16:1 in dark, and the kind label outranks the title for width. `cards/report.json`, `populated/grid-1440x900-{light,dark}.png`             |
| 5   | Never below 10% of viewport in any panel-open state         | ✅ PASS         | Worst reachable **layout** state is **44.7%** (1440, rail docked by default), measured across 7 widths × 6 panel states. Best 78.5%. `gate/report.json`                                                                                                                        |
| 6   | Properly responsive at all widths                           | ❌ **FAIL**     | The 1439→1440 cliff; lanes clipped mid-glyph at 1024/1100/1439; the New button 4px outside a 320px viewport. `sweep/report.json`, `final/report.json`, `detail/w320-toolbar.png`                                                                                               |
| 7   | No duplicate date labels                                    | ✅ PASS         | Zero ISO dates in page text at all 15 widths. The toolbar carries the range only; the rail heading is now **"Today's plan"**, not a restatement of the date (round-1 finding 7 fixed).                                                                                         |
| 8   | Larger minimum text size                                    | ⚠️ MARGINAL     | Floor is 12px with nothing below it and every string ≥ 6.7:1 contrast — but 12px is still **70% of all text** (32 of 46 nodes at 1440) and did not move between round 1 and round 2. `sweep/report.json` → `sizes`                                                             |
| 9   | Too many borders — visual noise                             | ✅ PASS         | `<main>` now computes `border-width: 0px`, `box-shadow: none` (round-1's bordered **and** shadowed panel is gone), and **zero** shadowed elements exist anywhere inside it at any width. The remaining 32–41 bordered nodes are hour hairlines and lane dividers.              |
| 10  | Consolidate the three overlapping view controls into ONE    | ✅ PASS         | One `Display` menu: View / Density / Zoom stepper / Reset. Nothing else on the surface writes `pixelsPerHour`. `detail/menu-display.png`                                                                                                                                       |
| 11  | The "New" button must never wrap                            | ✅ PASS         | One line — or a bare `+` glyph below `@2xl` — at 320/390/500/640/768/900/1023/1024/1180/1280/1366/1439/1440/1600/1920. (It does _overflow_ at 320; that is bullet 6, not this one.)                                                                                            |
| 12  | Date not in the toolbar AND at the top of the view          | ✅ PASS         | The Schedule region contains no month heading at any width; the toolbar carries `August 2026` / `Aug 2026` / `Jul – Aug 2026` and nothing else does.                                                                                                                           |
| 13  | One sane default density + subtle control + trackpad zoom   | ✅ PASS         | Default 72px/hr; the stepper lives inside the menu; `ctrl`+wheel drove 72 → 240px/hr live and persisted, and `Reset to default` put it back. `detail/menu-display.png`, `detail/after-pinch-zoom.png`                                                                          |
| 14  | Focus on events and time blocks, not chrome                 | ❌ **FAIL**     | Default 1440: 256px sidebar + 48px activity bar + 352px rail = **656px of chrome** against 717px of calendar, and the rail's entire content is "Nothing planned for today." Two of six day lanes are visible. `calendar-1440x900-light.png`                                    |
| 15  | Must be possible to drag events into time blocks            | ✅ PASS         | Executed, not inferred: the drag spec dropped a task from the rail onto the grid and the resulting block reads `Draft launch brief · 12:00 PM – 12:30 PM`. `test-results/…/drag-2-after.png`. Docked: only reachable at ≥1440 (see finding 6).                                 |
| 16  | Impossible to have two calendars on screen at once          | ✅ PASS         | `scheduleCount === 1` in **every** probed state — base, Tasks, Athena, Calendars, Display, New — across 7 widths. No mini-calendar element exists anywhere in the DOM. `gate/report.json`                                                                                      |

### Craft mandate

| Requirement                                 | Result | Evidence                                                                                                                                                                                       |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything routes through the design system | ✅     | Zero hardcoded sizes in the calendar sources; the Display menu uses the shared `menu-styles`; controls share one `CALENDAR_CONTROL_CLASS` recipe.                                              |
| Minimize borders / minimize shadows         | ✅     | Zero shadowed elements inside `<main>` at every width; `<main>` itself is a borderless 14px-radius surface. The only remaining shadow on the surface is the Display menu's MD3 menu elevation. |
| No ad-hoc typography                        | ✅     | `grep` over both directories returns nothing.                                                                                                                                                  |
| Avoid pills with no icons                   | ✅     | Every Display row carries an inline glyph (calendar/people, −/○/+); every toolbar control carries a leading glyph.                                                                             |
| Icons inline for selection options          | ✅     | `detail/menu-display.png`                                                                                                                                                                      |
| Balanced layout, secondary controls at end  | ✅     | Navigation at the start of the row, Calendars/Display/Athena/New at the end, at every width.                                                                                                   |
| Never wrap or reflow lazily                 | ❌     | The 1439→1440 cliff and the mid-glyph lane clipping.                                                                                                                                           |
| Never scale to indicate interactivity       | ✅     | No `scale-` utilities in the rebuilt files.                                                                                                                                                    |
| Standardize input fields                    | ⚠️     | Round-1's mixed elevation is gone — only the _focused_ field carries a shadow now, and all seven fields share border, colour and 36px height. Residual: 4px vs 8px radii inside one popover.   |
| Inline elements share the same height       | ✅     | Toolbar six at 32px (40px below `@2xl`); New form seven at 36px. `detail/report.json`                                                                                                          |
| Adequate padding, text never touches edges  | ❌     | The New button sits 4px outside a 320px viewport; the New popover's right edge is flush against the viewport at 390. `detail/w320-toolbar.png`, `gate/w390-open-New.png`                       |

---

## Findings, by severity

1. **The responsive cliff moved from 1024 to 1440; it was not removed.**
   `AppShell.tsx:77` now docks the rail at `(min-width: 90rem)` instead of `64rem`. That fixed the
   1023→1024 collapse: 1024 is now 58% rather than 26.8%. But it reproduced the same defect one
   breakpoint up. Measured: **1439 → schedule 1060px, 64.8% of viewport, four day lanes visible.
   1440 → 717px, 44.7%, two lanes.** Widening the window by one pixel costs the calendar 343px and
   half its days, and the 352px that takes it is a rail whose entire content is "Nothing planned for
   today." 1440 is the standard review viewport and a very common laptop width, so the default state
   on the most-used screen size is the worst state the surface has.
   The capability to fix it already exists and already looks right: `open:Tasks` at 1440 (which hits
   `Collapse Tasks`) yields 64.4%. **The default is wrong, not the layout.**
   _Fix:_ default the rail to collapsed, or dock it only when `<main>` can still seat the same lane
   count it had one pixel earlier. `packages/ui/src/components/shell/AppShell.tsx:77,181-182`.

2. **Day lanes are clipped mid-glyph, and today's badge becomes a blue crescent.**
   `final/lanes-1024.png` shows the lane header row as: `All day`, a **blue half-disc with no
   numeral** (the right half of the `Sun 2` today badge), `Mon 3`, then `Tue 4` cut by the canvas
   edge. `populated/grid-1100x900-light.png` shows the matching damage to content — the 10:00
   meeting renders `cti… Calendar…` and the 14:00 appointment renders `t` over `M – 3:00 PM`,
   because today's lane is scrolled underneath the sticky hour gutter.
   Measured: `scroll-snap-type: none`; fully-visible lanes are 2 of 6 at 1024, 3 of 9 at 1280, 2 of
   6 at 1440, with at least one partial lane at every desktop width.
   _Fix:_ snap the horizontal viewport to lane boundaries (`scroll-snap-type: x mandatory` plus
   `scroll-snap-align: start` on each lane), and make the initial scroll land today's lane flush
   against the gutter rather than at an arbitrary offset. `scheduling-canvas.tsx:258-266`,
   `scheduling-initial-scroll.ts`, `scheduling-visible-lanes.ts`.

3. **Events do not read as the foreground.**
   Measured card fill vs. canvas: light `lab(97.65)` on `lab(99.40)` = **1.04:1**; dark `lab(7.73)`
   on `lab(14.68)` = **1.16:1**. An event is distinguishable from empty time almost entirely by its
   3px coloured left bar and its text, not by its body. On the one surface the goal doc asks to be
   "centred on events and time blocks", the events are the least-contrasted objects on screen.
   _Fix:_ give the card fill a real step off the canvas (a `surface-container` tone, or a layer-tinted
   fill at low alpha) so the squint test resolves blocks before chrome.

4. **The kind label outranks the title for width.**
   On a 154px card at 1440: the title gets **98px and truncates**; `Block` / `Calendar event` gets
   **32px and never truncates** (`cards/report.json`). At 1100 with two overlapping events the
   titles are down to `Producti…` and `Deep work —…`. A per-card type label is chrome; it is winning
   space from the content the user came for.
   _Fix:_ drop the kind label to a glyph, or hide it below a card-width threshold so the title takes
   the whole line. `calendar-schedule-item-content.tsx`, `scheduling-item-body.tsx`.

5. **The primary action falls off the screen at 320px.**
   The `New` button's rect is `[284, 60, 40, 40]` — right edge **324px in a 320px viewport**
   (`detail/report.json` → `w320.newBtn`), and the toolbar's `scrollWidth` (312) exceeds its
   `clientWidth` (285) with `overflow-x: visible`. `detail/w320-toolbar.png` shows the button's right
   border missing. The document does not report horizontal overflow, so a smoke test passes while
   the one control that creates anything is visibly cut.
   _Fix:_ the toolbar row needs the same right inset as its left; the `min-w-9` floor should be
   reduced (or the row allowed to drop the `Today` label) before the last control is pushed out.

6. **The Tasks rail is a modal overlay below 1440 and a docked panel at 1440.**
   `gate/w1280-open-Tasks.png`: at 1280 the rail opens as a right sheet over a full-viewport scrim —
   the calendar stays visible behind it but is not interactive (sampled hit-test 0%). At 1440 the
   same panel is a flex sibling. So the drag-a-task-onto-the-grid gesture that finding 15 verifies is
   **only reachable at ≥1440**; on a 1280 laptop you cannot see your tasks and your calendar at once.
   I am not counting this against the 10% gate: the calendar is not _bunched_, it is temporarily
   covered by a dismissible overlay. But two interaction models for one panel, switched by a
   breakpoint, is the same defect as finding 1 wearing a different hat.

7. **Two Athena entry points are on screen simultaneously.**
   `Open Athena for Calendar` sits in the toolbar and the `Athena` FAB sits bottom-right, at every
   width from 390 to 1920 (`gate/report.json` → `buttons`). One of them is redundant chrome on a
   surface that is already fighting for width.

8. **12px is still 70% of the surface's text.**
   `sizes` at 1440 is `{12px: 32, 14px: 12, 16px: 2}`. Contrast is not the problem (7.66:1 for hour
   labels), density is: every hour label, the `All day` gutter, every card's kind label and time
   range, and the empty-state notice are all at the floor. The goal doc asked for a larger minimum
   twice; the minimum has not moved since round 1.

9. **The Schedule region uses the UA focus outline, not the shared ring.**
   Walking the toolbar with Tab gives every control the same `lab(41.70 22.51 −73.93) 0 0 0 2px`
   ring; the eighth stop — the `<section aria-label="Schedule">` itself — has `box-shadow: none` and
   `outline: auto 1px rgb(0, 95, 204)`, the browser default. Visible, so not an a11y gate failure —
   but it is the one focus treatment on the page that is not the design system's, and it is drawn
   around an 808px-tall region.

10. **Day lanes still expose no `role="columnheader"`.**
    Zero at every width and both themes (`a11y/report.json`). Off-screen lanes remain in the
    accessibility tree with no visible peer, and the canvas advertises no "more days" affordance
    (`overflow-x: auto` with overlay scrollbars). Carried over from round 1, unaddressed.

11. **Mixed corner radii inside the New popover.**
    Segmented `Event` / `Timebox` tabs at 4px against 8px on all five fields and the submit button
    (`detail/report.json` → `newForm`). Small, but it is the kind of thing the craft mandate names.

---

## Corrections to the integration report

- **"At 1024–1150px the toolbar heading still clips to `A…`" — not reproducible.** `h1.scrollWidth >
h1.clientWidth` is `false` at all 15 sweep widths, and the heading renders whole (`Aug 2026` at
  320/390/500/640, `August 2026` from 768, `Jul – Aug 2026` where the range spans two months). The
  `'short'` style plus the fluid `min-w-9` control floor did land. The report's own follow-up
  request against `AppShell` is not needed for the heading; it _is_ needed for finding 1.
- **"12/12 calendar Playwright specs pass" — substantially confirmed, but the suite is
  load-flaky.** Three runs of `e2e/calendar e2e/scheduling` on this tree: **12 failed / 8 passed**
  (parallel, with my probes also driving the shared dev server), **4 failed / 16 passed**
  (`--workers=1`), and **every one of those four specs passes when re-run in a small batch**
  (`calendar-viewport-floor` 1/1, and `layered-calendar` + `fluid-scheduling-all-day` +
  `calendar-drag-evidence` 5/5). No failure reproduces in isolation, so none is a product defect —
  but a suite that turns 20 green specs into 8 under load is not a signal anyone can rely on, and
  the calendar's own 10%-floor spec is one of the ones that flakes. Worth a separate look; it does
  not change any score here.
- The report's "25.3%–77.7% of viewport" reproduces as **44.7%–78.5%** on my sweep (7 widths × 6
  panel states). Its "one schedule region, one toolbar row, zero ISO dates, no horizontal overflow"
  claims all reproduce exactly.
- Round-1 findings **2** (untitled in-progress event), **5** (magenta selection rows), **7** (third
  rendering of the same date), **8** (mixed input elevation), **9** (unexplained disabled primary)
  and the bordered-plus-shadowed panel are all genuinely fixed, verified by screenshot.

## Limitations — what I could not verify

- **Duplicate-calendar UI (goal-doc bullet 3).** `page.tsx` now prefetches
  `me.calendar.layers` **server-side** into the query cache, and the client never issues the request
  (`layerRequests: []` across four contexts, and a forced `visibilitychange`/`focus` refetch produced
  zero hits). Playwright route fixtures therefore cannot inject duplicate layers, and the popover
  renders the account's real state: "No calendar layers yet." The feature is present in
  `calendar-layer-panel.tsx:233-282` and covered by
  `tests/calendar/calendar-layer-panel.test.tsx:276-326`, and the round-1 truncation complaint was
  addressed (`w-[22rem]`, `Also on …` on its own line). **It is not screenshot-verified this round.**
  Getting it back under visual review needs either a seeded provider connection in the dev database
  or an SSR-prefetch escape hatch for review builds.
- **Loading skeletons.** Not captured; the surface resolves too fast against the local stack to catch
  without request throttling, which I did not set up. Scored on the states I did capture.
- **Athena expanded.** No `Expand` control was reachable programmatically at any width
  (`athenaExpanded: "(no Expand control)"` × 7), so that state is unverified — same gap round 1
  reported.

---

## What must change before this ships

Findings **1**, **2** and **3** are the blockers, in that order. Finding 1 is a one-line default in
the shell and it takes findings 6 and 14 with it. Finding 2 is a scroll-snap rule and an initial-scroll
alignment. Finding 3 is a single fill token. None of the three is a rewrite, and together they are
the difference between "materially better than round 1" — which this genuinely is — and a calendar
the user would stop being angry about.

---
surfaces: ['calendar']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 1
  color: 2
  motion: 3
  states: 3
  detail: 2
gates:
  a11y: false
  responsive: false
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /calendar (rebuild, round 1) — 2026-08-02

**Verdict: BELOW BAR.** Responsive, Hierarchy, and Color-discipline block ship.

Reviewed against `docs/design/craft-rubric.md` plus the production-launch goal doc's
"Core Functionality > Calendar" and "UI Polish > Craft" sections. Every claim below is backed by a
screenshot listed in the evidence index; nothing is asserted from source reading alone.

## Screenshots

Root: `apps/web/.data/design-review/calendar/after-round-1/`

| Set                  | Files                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Standard shot set    | `calendar-{1440x900,390x844}-{light,dark}.png`                                                           |
| Width sweep          | `probe/sweep-{320,768,1023,1024,1100,1920}.png`                                                          |
| Menus                | `probe/menu-display-1440.png`, `probe/menu-calendars-1440.png`, `misc/new-popover-1440.png`              |
| Populated (fixtures) | `populated/grid-{1440x900,1100x900,390x844}-{light,dark}.png`, `populated/dedupe-popover-1440-light.png` |
| Panel / gate states  | `gate/w{390,768,1024,1280,1440,1920}-athena.png`, `gate/w{1024,1280,1440}-rail-collapsed.png`            |
| Machine reports      | `probe/report.json`, `gate/report.json`, `panels/report.json`, `misc/report.json`                        |

Probe scripts: `apps/web/.data/design-review/probe{,-populated,-lanes,-panels,-gate,-misc,-color,-final}.ts`

---

## Rubric scores

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                |
| --------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | Correct calm Plex/MD3 register. Copy is application-owned and specific — "Nothing scheduled. Drag on the grid or choose New to plan time." No provider text leaks. (`calendar-1440x900-light.png`)                                      |
| 2. Typographic craft        | 3     | Rebuilt files resolve to MD3 tokens only; `grep` for `text-[Npx]`/`text-xs`/`text-sm` across `app/(app)/calendar` + `components/scheduling` returns zero. Floor is 12px, never below. Marginal: 12px is the _dominant_ size (31 nodes). |
| 3. Spatial rhythm & density | 3     | Toolbar children all 32px tall on one baseline (`top=25` for all six; `h1` at 29 = optical centring of a 24px box in a 32px row) — measured, `misc/report.json`. Lane/hour rhythm is even.                                              |
| 4. Hierarchy & info design  | **1** | The event happening **right now** renders as an untitled coloured rectangle at default scroll (`populated/grid-1440x900-light.png`, `populated/grid-390x844-light.png`). Chrome outweighs the calendar 608px:383px at 1100.             |
| 5. Colour discipline        | **2** | Display menu's selected rows are magenta `bg-tertiary-container` — computed `lab(89.89 17.63 -11.12)` light / `lab(26.76 26.28 -16.34)` dark (`probe/menu-display-1440.png`). Unearned colour on an otherwise neutral surface.          |
| 6. Motion & feedback        | 3     | Focus rings present and consistent on all 12 tab stops walked (`misc/report.json` → `focusWalk`). Trackpad zoom responds live (72 → 240 px/hr under ctrl+wheel). Layer toggles wrapped in `startViewTransition`.                        |
| 7. States completeness      | 3     | Empty, populated, dedupe, and read-only states all designed and reachable. Docked: the empty-state notice collides with the now-indicator (finding 4); the disabled "Create event" never says why.                                      |
| 8. Detail craft             | **2** | Heading clips to `A…` at 1024–1150 and to `A` at 320 (`probe/sweep-1024.png`, `probe/sweep-320.png`). Now-line breaks into two red stubs behind the empty-state notice at 320/390/1024/1100.                                            |

**Ship bar is every dimension ≥ 3.** Dimensions 4, 5, and 8 fail.

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                                                      |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ⚠️     | Focus visible on all 12 tab stops; touch targets 40px on mobile. But day lanes expose no `role="columnheader"` (`laneHeaders: []`), and off-screen lanes are announced without a visual peer. |
| Responsive          | ❌     | 1023px → schedule 964px wide / 79.6% of viewport. **1024px → 307px / 26.8%.** One pixel wider makes the calendar 3× smaller. (`probe/sweep-1023.png` vs `probe/sweep-1024.png`)               |
| Theme parity        | ✅     | Light + dark captured at both widths, empty and populated. Dark is designed, not inverted — event fills darken, surfaces stay tinted. (`populated/grid-1440x900-dark.png`)                    |
| No placeholder      | ✅     | No dead rows, no lorem, no no-op buttons found in any probed state. (An earlier `undefined` I reported was **my** invalid fixture `kind` — see "Corrections".)                                |
| Screenshot-verified | ✅     | Every claim above cites a captured PNG that was read as an image.                                                                                                                             |

---

## Goal-doc bullets, scored individually

| #   | Requirement (verbatim, abbreviated)                                       | Result             | Evidence                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Looks haphazard / stuffed / no craft                                      | ❌ **FAIL**        | Materially better, still fails at 1024–1280: one clipped day lane beside a 352px 90%-empty rail. `probe/sweep-1024.png`, `sweep-1100.png`                                                                    |
| 2   | Useless buttons/controls like zoom and density                            | ✅ PASS            | Slider, `<select>`, button-group and density readout are all gone from the surface. `probe/menu-display-1440.png`                                                                                            |
| 3   | Must be able to deduplicate holiday / personal calendars on work accounts | ✅ PASS            | "1 duplicate calendar across accounts" + **Hide duplicates**, grouped `ada@acme.com` / `ada@personal.com`, row annotated `Also on ada@acme.com`. `populated/dedupe-popover-1440-light.png`                   |
| 4   | Extremely clear hierarchy centred on events and time blocks               | ❌ **FAIL**        | The in-progress 10:00–11:30 meeting is a blank blue box — title and time scrolled above the fold with no clamping. `populated/grid-1440x900-light.png`                                                       |
| 5   | Never below 10% of viewport in any panel-open state                       | ✅ PASS            | Worst reachable layout state = **26.8%** (1024px, rail docked). Rail collapse → 56–70%. 6 widths × 4 panel states measured. `gate/report.json`                                                               |
| 6   | Properly responsive at all widths                                         | ❌ **FAIL**        | The 1023→1024 cliff above. Also heading → `A…` (1024) and `A` (320).                                                                                                                                         |
| 7   | No duplicate date labels                                                  | ❌ **FAIL**        | Zero ISO dates anywhere (the literal example is fixed), but `Sun 2` (lane header) and `Sunday, August 2` (rail) render the same date in two formats 400px apart. `calendar-1440x900-light.png`               |
| 8   | Larger minimum text size                                                  | ⚠️ MARGINAL        | Floor raised to 12px with nothing below it, but 12px is the dominant size — all 24 hour labels and every metadata chip. `probe/report.json` → `fontSizes`                                                    |
| 9   | Too many borders — visual noise                                           | ⚠️ MARGINAL        | 35 bordered nodes inside `<main>`. The main panel carries **both** `lg:border` and `lg:shadow-sm`; the rail is a second bordered+shadowed card beside it. `AppShell.tsx:327`                                 |
| 10  | Consolidate the three overlapping view controls into ONE                  | ✅ PASS            | One `Display` menu: View / Density / Zoom stepper / Reset. `probe/menu-display-1440.png`                                                                                                                     |
| 11  | The "New" button must never wrap                                          | ✅ PASS            | Verified at 320, 390, 768, 1024, 1100, 1440, 1920 — `+ New` on one line, or a bare `+` glyph below `@2xl`. Never two lines.                                                                                  |
| 12  | Date not in the toolbar AND at the top of the view                        | ✅ PASS            | Toolbar carries month/year only; the Schedule region has no month heading. Zero ISO dates in page text at every width.                                                                                       |
| 13  | One sane default density + subtle control + trackpad zoom                 | ✅ PASS            | Default 72px/hr; stepper lives inside the menu; ctrl+wheel drove 72 → 240px/hr live. `misc/report.json` → `pinchZoom`                                                                                        |
| 14  | Focus on events and time blocks, not chrome                               | ❌ **FAIL**        | Same as #4. At 1100px: sidebar 256 + rail 352 = 608px of chrome vs 383px of calendar.                                                                                                                        |
| 15  | Must be possible to drag events into time blocks                          | ⚠️ AFFORDANCE ONLY | 4 `[draggable="true"]` nodes present with 4 timed items; `SCHEDULE_DRAG_MIME` / `onDropObjectOnItem` wired; `e2e/scheduling/fluid-scheduling-grid-drop.spec.ts` exists. **I did not execute a drag myself.** |
| 16  | Impossible to have two calendars on screen at once                        | ✅ PASS            | `scheduleCount === 1` in every probed state (base, Calendars, Display, People axis, People popover, New, Athena, rail-collapsed) × 6 widths. No mini-calendar element exists.                                |

### Craft mandate

| Requirement                                 | Result | Evidence                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything routes through the design system | ⚠️     | Rebuilt files are token-pure (zero hardcoded hex/oklch). But the layer panel uses a raw `<input type="checkbox" className="accent-primary">`, and the item drawer reachable from the calendar still uses `text-xs`/`text-sm`/`text-base`. |
| Minimize borders / minimize shadows         | ⚠️     | Two bordered **and** shadowed cards side by side (main panel + rail). `AppShell.tsx:327`                                                                                                                                                  |
| No ad-hoc typography                        | ✅     | Zero arbitrary sizes in `app/(app)/calendar` and `components/scheduling`.                                                                                                                                                                 |
| Avoid pills with no icons                   | ⚠️     | Density presets (−/○/+) and View rows (calendar/people) carry inline icons — good. "Hide duplicates" is a bare text button.                                                                                                               |
| Icons inline for selection options          | ✅     | `probe/menu-display-1440.png`                                                                                                                                                                                                             |
| Balanced layout, secondary controls at end  | ✅     | Navigation at the start, Calendars/Display/New at the end. `calendar-1440x900-light.png`                                                                                                                                                  |
| Never wrap or reflow lazily                 | ❌     | The 1024 cliff; the heading degrading to a single letter.                                                                                                                                                                                 |
| Never scale to indicate interactivity       | ✅     | No `scale-` utilities in the rebuilt files.                                                                                                                                                                                               |
| Standardize input fields                    | ❌     | In the New form: `input:text` and both `input:datetime-local` compute `box-shadow: yes`; the sibling `select` computes `none`. Same border, same radius, mixed elevation. `misc/report.json`                                              |
| Inline elements share the same height       | ⚠️     | Toolbar: all six controls exactly 32px — correct. New form: inputs 36px, submit button 32px.                                                                                                                                              |
| Adequate padding, text never touches edges  | ⚠️     | Holds generally; the 320px-wide dedupe popover truncates two of five rows.                                                                                                                                                                |

---

## Findings, by severity

1. **The 1023→1024 responsive cliff — the single worst defect.**
   `AppShell.tsx:159` docks a 22rem rail at `min-width: 64rem`. `<main>` collapses from 1023px to
   344px across one pixel, so the schedule goes 964px/79.6% → 307px/26.8% and the day count goes
   3.3 → 1. Making the window **wider** makes the calendar three times smaller. At 1100px the calendar
   is 383px while the agenda rail beside it is 352px and 90% empty.
   _Fix:_ the rail must not dock until `<main>` can still seat ≥2 full lanes plus the hour gutter
   (~1440px), or the rail must default collapsed and become an overlay below that width. The
   collapsed state already looks right — `gate/w1440-rail-collapsed.png` shows 4 lanes at 64% of
   viewport with the full-text toolbar. The capability exists; the default is wrong.

2. **The event happening now renders with no title.**
   `populated/grid-1440x900-light.png` and `-390x844-light.png`: the 10:00–11:30 meeting is a bare
   blue rectangle because its title row is scrolled above the canvas fold. The overlapping 10:30
   block _does_ show its title purely because it happens to start 5px lower. Directly defeats
   "hierarchy centred on events".
   _Fix:_ clamp an item's title/time row to the top of the visible canvas while any part of the item
   is on screen (`scheduling-item-body.tsx` `ItemBodyContent`, density `'full'`).

3. **The heading degrades to a single letter.**
   `probe/sweep-1024.png` → `A…`; `probe/sweep-320.png` → `A`. `calendarRangeLabel`'s `'short'` style
   already produces `Aug 2026`, but at 1024 six controls consume 275px of a 344px `<main>`, leaving
   32px. The abbreviation cannot rescue a 32px box. Downstream of finding 1; also fixed by it.

4. **The empty-state notice paints over the now-indicator.**
   At 320, 390, 1024 and 1100 the notice wraps to 2–3 lines and its opaque background splits the red
   now-line into two stubs (`probe/sweep-320.png`, `calendar-390x844-light.png`,
   `probe/sweep-1100.png`). The notice is also positioned scroll-relative and unaligned to any lane,
   so it reads as a floating orphan across the grid.
   _Fix:_ centre it in the canvas viewport, drop the opaque fill, or render it below the now-line.

5. **Magenta selection rows in the Display menu.**
   `dropdown-menu.tsx:266-267,299-300` sets `data-[state=checked]:bg-tertiary-container`. In a surface
   that is otherwise 100% neutral, the checked "Dates" and "Default" rows read as a bright pink block
   (`probe/menu-display-1440.png`). This is the one control the goal doc asked to be _subtle_.
   _Fix:_ use `secondary-container` or a neutral `surface-container-highest` for the checked state.
   Note this is a shared primitive — the change affects every menu in the app.

6. **The dedupe popover truncates the fact that makes it trustworthy.**
   `populated/dedupe-popover-1440-light.png`: the redundancy annotation renders as
   `Google · synced 10 hr. ago…` — the `· Also on ada@acme.com` half, the only thing telling you
   _which_ account duplicates the calendar, is clipped. Two of five titles also truncate
   (`Holidays in United …`) because the 320px popover reserves ~64px for a `Read-only` badge. The
   native layer additionally stacks three identical words: group heading `Docket`, row title
   `Docket`, provider subtitle `Docket`.
   _Fix:_ widen the popover, move `Also on …` to its own line, and suppress the provider subtitle
   when it equals the row title.

7. **Third rendering of the same date.**
   `Sun 2` (lane header) and `Sunday, August 2` (rail heading) sit 400px apart under
   `August 2026`. The ISO duplication the goal doc named is gone, but the pattern it names —
   two formats of one date visible at once — is still on screen.
   _Fix:_ the rail heading should carry its own identity ("Tasks", "Today") rather than restating
   the selected date the grid already labels.

8. **Mixed input elevation in the New form.**
   Text and datetime inputs carry a box-shadow; the sibling select does not. Submit button is 32px
   against 36px fields. `misc/new-popover-1440.png`, `misc/report.json`.

9. **Disabled primary action does not explain itself.**
   `Create event` renders washed-out with no adjacent hint that Title is required.
   `misc/new-popover-1440.png`.

10. **Two conditional entry points to Athena.**
    A text button "Open Athena for Calendar" appears in the toolbar only when `<main>` is wide
    (`gate/w1440-rail-collapsed.png`, `probe/sweep-1023.png`) and vanishes entirely at 1440 with the
    rail docked — it does not collapse to a glyph like its neighbours. The FAB is always present, so
    the capability is never lost, but the toolbar's contents change unpredictably with width.

11. **A11y: day lanes are not column headers.**
    `[role="columnheader"]` count is 0 inside the Schedule region. Off-screen lanes (`Fri 31`,
    `Tue 4`, `Wed 5` at 1440) are in the accessibility tree with no visible peer and no scroll
    affordance — the canvas is `overflow-auto` with overlay scrollbars and no "more days" hint.

---

## Corrections to my own first pass

- I initially observed a literal **`undefined`** on event cards. That was **my** fixture using
  `kind: 'event'`, which is not in `CalendarItemKind`. With valid kinds the cards read
  `Calendar event` / `Block` correctly. **Not a product defect.** Worth one line of hardening
  anyway: `calendar-schedule-item-content.tsx:33` does an unguarded `KIND_LABELS[item.kind]`, so an
  API that adds a kind ahead of a web deploy would print `undefined` into the UI.
- I initially read `toolbarRows: 2` as a wrap. It is not — the `<h1>` is a 24px box optically
  centred in a 32px row. **The one-row, never-wraps claim in the integration report is correct.**
- I initially suspected off-screen day lanes were unreachable. They are reachable: the Schedule
  section is `overflow-auto` with `scrollWidth` 1993 vs `clientWidth` 715 at 1440. The defect is the
  missing affordance, not unreachability.
- The integration report's claim of "25.3%–77.7% of viewport" reproduces (I measured 26.8%–78.6%),
  and its self-reported 1024–1150 heading clip is real and correctly attributed to `AppShell`.

## On the 10% gate and Athena

Opening Athena drops the schedule's _hit-testable_ area to 0% at every width, because the docked
panel ships a full-viewport scrim. I am **not** counting this as a gate failure: it is a dismissible
transient overlay, not a layout state, and the calendar remains visible behind it
(`gate/w1440-athena.png`). The gate is scored on reachable layout states, where the worst case is
26.8%. Flagging it so the call is visible rather than silently made.

I could not reach Athena's `Expand` control programmatically. If Expand goes full-bleed, that state
is unverified.

## What must change before this ships

Findings 1, 2, and 5 are the blockers. Finding 1 alone resolves findings 3 and most of finding 14's
chrome-vs-content ratio, and it is a shell-level default rather than a calendar rewrite — the
collapsed-rail screenshot proves the calendar is already capable of looking right.

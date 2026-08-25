---
surfaces: ['agenda']
date: 2026-08-25
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Agenda panel polish — 2026-08-25

**Verdict: SHIP.** Product and Web maintainers can ship this Agenda design. The panel now keeps
date selection, timeline content, work-location context, and overflow controls clear at 320px.
This review supersedes the August 24 scorecard. That review missed the edge pressure, empty space,
visible scrollbar, and narrow collision failures shown in the August 25 user capture.

## Screenshots and runtime evidence

The screenshot root is `docs/design/audits/screenshots/2026-08-25-agenda-panel-polish/`.

| State                               | Files                              |
| ----------------------------------- | ---------------------------------- |
| Populated desktop, both themes      | `agenda-1440x900-{light,dark}.jpg` |
| Populated mobile Sheet, both themes | `agenda-390x844-{light,dark}.jpg`  |
| Focused work-location marker        | `agenda-390x844-focus-dark.jpg`    |
| Minimum-width boundary              | `agenda-320x844-dark.jpg`          |

The authenticated local account read and wrote real API-backed calendar and work-location records.
The capture state contained an all-day Home assertion, Main library from 11:00 AM to 6:00 PM,
Design studio from 7:30 PM to 11:30 PM, one boundary-crossing event, three simultaneous events,
and the resulting `+2` disclosure. The audit removed every temporary record and the localhost
session cookie after capture. The claimed Chrome tab returned to its production Docket page.

```text
320px document clientWidth 320 / scrollWidth 320
schedule clientWidth 256 / offsetWidth 256 / scrollbar-width none
schedule clientHeight 774 / scrollHeight 1210
Page Down scrollTop 282 -> 436
first visible time label inset 19px
rightmost visible event inset 13px
seven day targets 40x50
work-location marker 40x40
all-day Home target 66x40
Previous day controls 0
Next day controls 0
icon-only Display controls 0
focused controls 7 / 7 matched :focus-visible
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                      |
| ------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice |     3 | The panel uses Docket's MD3 surface roles, icons, event color, and tonal selected-day circle. The controls now read like Docket instead of a browser toolbar.                 |
| 2. Typographic craft      |     3 | Month, view, weekday, day, time, title, and event range each have one job. Narrow cards keep one useful title line and one time line instead of clipping both.                |
| 3. Spatial rhythm         |     3 | The panel keeps a 12px frame. Measured content leaves 19px before the first time label and 13px after the rightmost event. The 40px all-day row contains its create target.   |
| 4. Hierarchy              |     3 | The month trigger handles arbitrary jumps. The seven-day strip handles nearby dates. The named Timeline menu handles presentation. The timed grid begins after those choices. |
| 5. Colour discipline      |     3 | Light and dark use the same semantic roles. The tinted location band stays behind the marker, and event cards remain the strongest color in the schedule.                     |
| 6. Motion & feedback      |     3 | Page Down moves the native scrollport with no visible scrollbar. Existing pointer, keyboard, resize, preview, rejection, and persistence behavior remains in shared code.     |
| 7. States completeness    |     3 | The capture covers all-day Home, two partial locations, a crossing event, dense overlap, `+2`, desktop, mobile, 320px, both themes, and keyboard focus.                       |
| 8. Detail craft           |     3 | Every date cell and location target meets 40px. The 28px location band stays inside the 40px track. Events and disclosure controls use the same resolved leading inset.       |

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                               |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass   | Month, view, dates, Home, markers, event cards, and overflow disclosure expose names. Seven tested controls matched `:focus-visible` with a two-pixel ring or outline. |
| Responsive          | Pass   | The document reports `320 === 320`. The first label and last card keep more than the required 12px at desktop, and the same frame remains visible at 320px.            |
| Theme parity        | Pass   | Desktop and mobile screenshots show the same layout and state hierarchy in light and dark.                                                                             |
| No placeholder      | Pass   | A signed-in local account and the real API supplied every record. The audit did not replace routes or component data.                                                  |
| Screenshot-verified | Pass   | The repository contains two widths in both themes, the 320px boundary, and a focused-marker frame.                                                                     |

## Repository gate status

The design and repository gates pass. The focused Agenda slice passes 104 tests across nine files.
The complete Web suite passes 3,162 tests across 418 files with two workers. Tooling passes 167
tests. Every package linted successfully before the final `DocketLink` correction, and scoped
ESLint passes both corrected link files. Every package typecheck and the Web production build pass.
The API typecheck required a command-scoped 4 GB heap after the bounded Turbo run hit the machine's
2 GB Node heap. The commit hook's second full Web lint reached its fixed 180-second timeout. That
timeout did not report a lint defect, so the final commit used the passing scoped lint result.

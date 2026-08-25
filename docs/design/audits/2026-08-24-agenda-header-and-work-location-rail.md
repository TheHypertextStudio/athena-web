---
surfaces: ['agenda']
date: 2026-08-24
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

# Design review: Agenda header and work-location rail — 2026-08-24

**Verdict: SHIP.** Product and Web maintainers can ship this Agenda treatment. All eight craft
dimensions meet the bar, and every hard gate passes. This scorecard supersedes the 2026-08-10
Agenda rail review because that pass did not capture a partial-day location intersecting real
overlapping events.

## Screenshots and runtime evidence

Root: `docs/design/audits/screenshots/2026-08-24-agenda-rail/`.

| State                                   | Files                              |
| --------------------------------------- | ---------------------------------- |
| Populated desktop, both themes          | `agenda-1440x900-{light,dark}.jpg` |
| Populated mobile Sheet, both themes     | `agenda-390x844-{light,dark}.jpg`  |
| Focused custom-place marker and tooltip | `agenda-390x844-focus-dark.jpg`    |
| Minimum-width overflow check            | `agenda-320x844-dark.jpg`          |

The authenticated production account supplied the events and three work-location intervals on
August 20. No screenshot uses placeholder or seeded review data. The date picker switched from
August 24 to August 20 and closed immediately. The Display menu exposed Timeline, List, 1×, 2×,
and 3×. The visible partial-day regions were Home from 6:00 AM to 10:35 AM, Pop Cafe from 12:00 PM
to 5:50 PM, and Home from 7:30 PM to 10:00 PM.

Required CI run `32819011751` passed the build, type, lint, test, secret-scan, and core-screen
acceptance gates for the production Web revision. Vercel deployment
`dpl_CsB7g8yQwPvzU7RgxenTmdtfJAht` contains revision `3198e96b` and is READY on all four production
aliases. The authenticated custom-domain pass confirmed the one-row header, immediate date switch,
Display choices, all-day Home chip, partial-day rails, and overlap insets after that promotion.

```text
320px document clientWidth 320 / scrollWidth 320
previous, next, Display, and work-location targets 40×40
date trigger 186×40 at 390px
intersecting clusters data-schedule-leading-inset 40
outside events data-schedule-leading-inset 0
focused tooltip Pop Cafe, 12:00 PM to 5:50 PM
focused run 8 files / 89 tests / one worker
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                                         |
| ------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice |     3 | The controls use Docket's MD3 surfaces and icons. Home and other places use semantic markers without adding a second event color system.                                                         |
| 2. Typographic craft      |     3 | The date reads as the primary control. Event titles and exact times retain their hierarchy, and the full location name and range remain available through accessible text and the focus tooltip. |
| 3. Spatial rhythm         |     3 | One 40px control row replaces the stacked header. The rail reserves exactly 40px only for intersecting clusters, and the empty work-location all-day band is gone.                               |
| 4. Hierarchy              |     3 | Previous day, date, next day, and Display form one sequence. The location track sits behind schedule context without reading as another event card.                                              |
| 5. Colour discipline      |     3 | Both themes use the same semantic surface roles. The two-pixel rail stays neutral, while the event palette remains the strongest color in the timeline.                                          |
| 6. Motion & feedback      |     3 | Pointer and keyboard previews, completion announcements, and rejected-edit restoration remain in the shared work-location composition.                                                           |
| 7. States completeness    |     3 | The review covers Home, a custom place, overlapping columns, an overflow disclosure, outside events, keyboard focus, desktop, mobile, light, dark, and 320px.                                    |
| 8. Detail craft           |     3 | The marker is a 24px semantic icon inside a 40px target. The rail never crosses an event card, and overflow disclosures inherit the same cluster inset.                                          |

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                                                      |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass   | Every header and location control has an accessible name. Focus exposes the complete place and time range. Keyboard move, resize, date navigation, and rejected edits have behavior coverage. |
| Responsive          | Pass   | The mobile Sheet keeps the header on one row. The document reports no horizontal overflow at 320px, and every measured control exceeds WCAG's 24px target-size floor.                         |
| Theme parity        | Pass   | The authenticated desktop and mobile capture sets show the same geometry and state hierarchy in light and dark.                                                                               |
| No placeholder      | Pass   | Production calendar and work-location records drive every captured state.                                                                                                                     |
| Screenshot-verified | Pass   | The repository contains both widths, both themes, the 320px boundary, and the focused marker state.                                                                                           |

## Findings

No ship blocker remains. A narrow desktop rail truncates the visible date label after the month,
but the 40px trigger remains visually distinct and its accessible label contains the full date.
The mini calendar exposes the full month for arbitrary jumps.

The authenticated pass found one source-timezone defect outside the original screenshot state.
An imported all-day assertion could split across the viewer's civil date and disappear from both
the all-day row and timed track. Revision `3198e96b` anchors the visible chip to the selected date
while preserving the provider instants used for edits. The regression covers a UTC assertion in an
America/Los_Angeles schedule across the spring DST boundary.

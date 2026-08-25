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

# Design review: Scalable utility-panel switcher — 2026-08-25

**Verdict: SHIP.** Product and Web maintainers can ship this utility-panel navigation. The mobile
Sheet names the active panel in one 40px trigger and moves every panel choice into a vertical menu.
The work-location treatment now reserves 32px only inside intersecting collision clusters. This
review extends the Agenda panel scorecard with the shell navigation and narrower location-track
requirements that the earlier review did not cover.

## Screenshots and runtime evidence

The screenshot root is
`docs/design/audits/screenshots/2026-08-25-scalable-utility-panel-switcher/`.

| State                                   | Files                                                  |
| --------------------------------------- | ------------------------------------------------------ |
| Populated desktop, both themes          | `utility-panel-1440x900-{light,dark}.png`              |
| Populated mobile Sheet, both themes     | `utility-panel-390x844-{light,dark}.png`               |
| Minimum-width Sheet, both themes        | `utility-panel-320x844-{light,dark}.png`               |
| Focused work-location marker            | `utility-panel-390x844-work-location-focus.png`        |
| Five-choice stress fixture, both themes | `utility-panel-five-choice-320x844-{light,dark}.png`   |
| Five-choice keyboard focus              | `utility-panel-five-choice-320x844-keyboard-focus.png` |

The authenticated local route used an isolated PGlite database through the real Web and API
applications. The capture state contained an all-day Home assertion, Main library from 11:00 AM to
6:00 PM, Design studio from 7:30 PM to 11:30 PM, a boundary-crossing event, overlapping event
columns, a dense-overflow disclosure, and events outside both location intervals. The audit did not
alter the existing `.data/docket` database. Closeout removed the seeded records, isolated database,
localhost cookie, and dev processes, then returned the claimed Chrome tab to its production route.

The five-choice screenshots used a temporary visual-only fixture that appended Documents and Inbox
to the real Agenda, Focus, and Athena definitions. The fixture proved that the vertical menu scales
without changing the trigger width or wrapping shell chrome. The fixture was removed after capture,
and `app-shell-frame.tsx` has no remaining fixture diff. The normal desktop and mobile screenshots
use the final three-panel product state.

```text
320px document clientWidth 320 / scrollWidth 320
active-panel trigger 113.16x40
horizontal tablists 0
five-choice stress menu items 5
intersecting cluster data-schedule-leading-inset 32
location tint 12px / rail 2px / marker 24x24
location move target 40x40
schedule clientHeight 686 / scrollHeight 1210 / scrollbar-width none
Page Down scrollTop 0 -> 524
focused work-location outline solid 2px
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                    |
| ------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice |     3 | The switcher uses the same named panel icons, selected-container role, menu treatment, and MD3 surfaces as the rest of Docket.                                              |
| 2. Typographic craft      |     3 | The trigger shows one active-panel name. The menu gives every panel a full label, and the timeline preserves useful event titles and time ranges at 320px.                  |
| 3. Spatial rhythm         |     3 | One 40px trigger replaces the non-scaling button row. The 32px location inset contains a 12px tint, a 2px rail, a 24px marker, and a gutter-biased 40px target.             |
| 4. Hierarchy              |     3 | The Sheet exposes one current panel and one disclosure action. Panel choice no longer competes with the selected panel's own date, view, and timeline controls.             |
| 5. Colour discipline      |     3 | Light and dark states use matching semantic roles. The location tint remains quieter than event cards, and focus uses the primary outline token.                            |
| 6. Motion & feedback      |     3 | Menu selection changes the panel through the shared rail state. Native Page Down scrolling remains available even though Agenda hides scrollbar chrome.                     |
| 7. States completeness    |     3 | The review covers desktop, 390px, 320px, both themes, three real panels, five stress choices, keyboard menu focus, location focus, overlap, boundaries, and dense overflow. |
| 8. Detail craft           |     3 | The menu aligns icons and labels in one column. Intersecting cards and overflow use one cluster inset, while outside events keep full lane width.                           |

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                                            |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass   | The trigger names the active panel. The menu exposes five `menuitem` roles in the stress state. Arrow Down moved focus to Focus, and the location marker shows a solid 2px outline. |
| Responsive          | Pass   | The document reports `320 === 320`. The switcher never wraps, the five-choice menu fits the Sheet, and every measured panel and location interaction target is 40px tall.           |
| Theme parity        | Pass   | Desktop, 390px, 320px, and the five-choice stress state use the same layout and state hierarchy in light and dark.                                                                  |
| No placeholder      | Pass   | The final captures use the real authenticated shell, API, Agenda, Focus, Athena, scheduling canvas, and work-location composition. The clearly named stress fixture was removed.    |
| Screenshot-verified | Pass   | The repository contains six final responsive/theme captures plus focused marker and five-choice menu evidence.                                                                      |

## Repository gate status

The shell suites pass 83 tests across two files. The focused Agenda, scheduling, and work-location
slice passes 432 tests across 51 files. The complete UI suite passes 653 tests across 34 files, the
complete Web suite passes 3,162 tests across 418 files, and tooling passes 167 tests. Repository
lint passes every package. Twenty-five packages passed typecheck under the bounded 2 GB run, and
API typecheck passed alone with a command-scoped 4 GB heap. The isolated API suite passes 4,784
tests across 392 files. The production build passes all four executable tasks and emits 75 Web
pages.

The first concurrent repository test run exceeded the API work-view p95 threshold while Web ran at
the same time. The unchanged performance test passed at its original threshold by itself, and the
complete API suite passed in isolation. This branch changes shell presentation and scheduling
geometry. It does not change the API query path measured by that test.

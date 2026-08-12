---
surfaces: ['orgs-[orgId]-recurrence-series-[seriesId]']
date: 2026-08-12
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 4
  color: 3
  motion: 3
  states: 4
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Repeating work — 2026-08-12

**Verdict: SHIP.** Repeating work reads as an ordinary Docket capability rather than a separate
automation product. The series is the subject, its schedule is immediately editable, generated
tasks stay navigable, and future-only changes explain their boundary without exposing the process
engine underneath.

## Screenshots and runtime evidence

Root: `docs/design/audits/assets/repeating-work/`.

| Surface                        | Files                          |
| ------------------------------ | ------------------------------ |
| Series management, desktop     | `series-1440-{light,dark}.png` |
| Series management, mobile      | `series-390-{light,dark}.png`  |
| Task composer recurrence entry | `task-compose-1440-dark.png`   |

The authenticated local browser probe created an actual `Run six miles` series on Monday,
Wednesday, and Friday. The API materialized 13 ordinary tasks across the 28-day rolling horizon;
the first task linked back to this management surface, and every upcoming row linked to its task.

```text
320px document overflow: 0
320px document width: 320px
recurrence interaction targets below 40px: 0
keyboard focus-visible: true, 2px ring
desktop and mobile themes: light and dark captured
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                         |
| ------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice |     3 | Direct labels such as “Schedule,” “Pause,” and “Save future schedule” use Docket's existing language and primitives. The process model never becomes product-facing jargon.      |
| 2. Typographic craft      |     3 | The series title, readable recurrence summary, section headings, dates, and state labels form a restrained token-based type hierarchy at both widths.                            |
| 3. Spatial rhythm         |     3 | The surface uses a consistent 16/24px rhythm. Desktop separates occurrences from a compact schedule card; mobile places the schedule before the longer upcoming list.            |
| 4. Hierarchy              |     4 | The name and cadence establish context first, lifecycle actions stay secondary, schedule editing remains above the fold, and generated work forms one scannable supporting list. |
| 5. Colour discipline      |     3 | Colour is reserved for semantic surfaces, the active state, focus treatment, and the primary save action. Light and dark preserve the same hierarchy.                            |
| 6. Motion & feedback      |     3 | Existing button, popover, pending, and error feedback handle transitions without decorative motion. Pause, resume, end, and save disable safely while mutations are pending.     |
| 7. States completeness    |     4 | Active, paused, ended, upcoming, history, empty, loading, error, event-triggered, missed-decision, moved, skipped, and completed states all have explicit rendering or tests.    |
| 8. Detail craft           |     3 | The upcoming list scrolls independently on desktop, schedule editing stays sticky, mobile targets measure 40px, keyboard focus is visible, and the 320px probe has no overflow.  |

## Gates

| Gate                | Result | Evidence                                                                                                                                                                  |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Named landmarks and controls, real links for generated tasks, visible keyboard focus, and measured 40px mobile targets cover the reviewed interaction path.               |
| Responsive          | ✅     | The management layout moves the schedule before occurrences on mobile, splits at the available-content container breakpoint, and reports zero document overflow at 320px. |
| Theme parity        | ✅     | The same authenticated series was captured at 1440×900 and 390×844 in both light and dark themes.                                                                         |
| No placeholder      | ✅     | Captures use a real local workspace, persisted recurrence series, and 13 materialized tasks rather than mocked or decorative content.                                     |
| Screenshot-verified | ✅     | Four final management captures and the real task-composer entry capture are committed under the audit root.                                                               |

## Findings resolved during review

1. The first desktop pass stacked the schedule below 13 upcoming occurrences whenever Docket's
   navigation and Agenda rail reduced the content width. The page now splits at the earlier
   content-container breakpoint, keeps the schedule sticky, and bounds the upcoming list.
2. Compact shared controls initially measured 32–34px on mobile. Lifecycle, schedule, date, and
   occurrence actions now retain compact typography inside measured 40px targets.
3. Soft navigation initially routed the new management URL through the organization catch-all,
   leaving the previous task page mounted with a missing task id. Regenerating the offline route
   table made the series page a first-class Docket route and added regression coverage.

## Limitations

- Loading skeletons resolve too quickly in the local production bundle for a stable browser
  capture; their structure is covered by the page component and focused tests.
- The reviewed series had no missed occurrence, so its decision controls are covered by component
  and service tests rather than screenshot evidence containing fabricated history.

# Design review: Agenda quick create — 2026-08-10

Screenshots: `docs/design/audits/screenshots/2026-08-10-agenda-quick-create/` —
`desktop-{light,dark}-overview.png`, `tablet-light-overview.png`,
`mobile-{light,dark}-overview.png`, and `desktop-light-timezone-search.png`
(1440×900 + 820×900 + 390×844, light + dark).

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                               |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice         | 3     | The app register stays calm and operational: neutral MD3 surfaces, concise `Add title`, `More options`, and `Save` copy, with no provider jargon in the overview.                                                                                      |
| 2. Typographic craft              | 3     | The title, segmented intent, schedule summary, metadata, field labels, and actions form five legible levels using the shared Plex/MD3 scale; time values remain readable at both widths.                                                               |
| 3. Spatial rhythm & density       | 3     | Desktop uses a 544px dialog on the shared 4px rhythm; tablet and mobile replace the Agenda timeline with a full-height sibling editor using consistent 16px insets and no clipped controls.                                                            |
| 4. Hierarchy & information design | 4     | The five-second path is title → schedule summary → Save. Date, time, all-day, recurrence, and timezone controls appear only after activation, and timezone search moves to a focused child dialog.                                                     |
| 5. Color discipline               | 3     | Screenshots show token-only neutral surfaces in light and dark; the red title underline is earned validation state and the blue selection is the single active accent.                                                                                 |
| 6. Motion & feedback              | 3     | The dialog uses the shared tokened fade/scale motion, its top grip directly moves the desktop panel, dirty dismissal asks before discarding, Save disables immediately, and failed saves retain the draft with feedback outside the dialog.            |
| 7. States completeness            | 4     | Missing title, invalid time, pending save, persistence failure, all-day, multi-day, expanded schedule, timezone search, independent-zone choices, and dirty dismissal all have implemented states without validation prose crowding the dialog.        |
| 8. Detail craft                   | 4     | Live geometry asserts the dialog never crosses the Agenda edge after pointer drag, the mobile/tablet timeline stands down for a sibling host, 320px has no horizontal overflow, and the zoom readout opens direct 1×/2×/3× plus timeline/list choices. |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings (ordered by severity)

1. No ship-blocking findings. Independent review gaps were closed before this score: 768–1023px
   sibling presentation, all-day and recurrence disclosure, timezone combobox semantics, dirty
   dismissal, timezone-only provider writes, controlled-draft retention, and real persistence.
2. The recovery-code nudge in the authenticated evidence account is an independent app-level state
   and does not intersect the dialog or Agenda geometry.

Verdict: **SHIP** — every dimension meets the crafted bar and all hard gates are green.

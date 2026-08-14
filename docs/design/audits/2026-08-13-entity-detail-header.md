---
surfaces: ['orgs-[orgId]-projects-[projectId]']
date: 2026-08-13
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

# Design review: Entity detail header — 2026-08-13

> Superseded by the 2026-08-14 correction review. The original screenshot harness paused color
> transitions while pinning header-collapse progress, so its dark-theme evidence and verdict were
> invalid even though the production theme tokens were switching correctly.

Screenshots:

- `apps/web/.data/design-review/entity-detail-header/project-header-1440x900-light.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-1440x900-dark.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-390x844-light.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-390x844-dark.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-320x720-overflow-light.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-320x720-start-picker-light.png`
- `apps/web/.data/design-review/entity-detail-header/measurements.json`

Register: app — calm, dense Plex/MD3. The captures use an authenticated local account and a
Project created through the application API for this review.

| Dimension                         | Score | Evidence                                                                                                                                                                                     |
| --------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | The Project identity remains the first readable object, with direct Owner, Status, Start, and Target vocabulary and no developer-facing labels.                                              |
| 2. Typographic craft              |     3 | Compact identity uses the canonical title role on one line, while picker labels retain the shared label/body scale without wrapping at 390px.                                                |
| 3. Spatial rhythm & density       |     3 | The compact glyph, title, and actions share an exact top coordinate in a 46px row; separate date triggers retain 12px inline padding and an 8px property rhythm.                             |
| 4. Hierarchy & information design |     3 | Ownership precedes operational properties, Publish remains top-level, Repeat is subordinate in Project actions, and lower-priority fields disclose through one ellipsis menu.                |
| 5. Color discipline               |     3 | Light and dark captures remain neutral; green is reserved for the on-track health state and blue is reserved for focus/selection feedback.                                                   |
| 6. Motion & feedback              |     3 | The compact endpoint preserves identity/action alignment, and keyboard focus visibly opens both the property overflow and the nested Start calendar.                                         |
| 7. States completeness            |     3 | Every collapsed property remains a real picker in overflow; dates remain independent Start/Target controls, unset ownership remains actionable, and no arrow summary or dead value is shown. |
| 8. Detail craft                   |     3 | DOM measurements report `nowrap` and equal client/scroll widths at 1440, 760, 480, and 360px; the document also remains contained at 320px.                                                  |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: the overflow trigger and nested Start picker were focused and opened with Enter at
  360px; both retain visible focus treatment and accessible names.
- **Responsive**: property-row and document measurements show no horizontal overflow at 1440,
  760, 480, 360, or 320px. Hidden properties remain operable from the overflow menu.
- **Theme parity**: the same compact hierarchy and focus surfaces remain legible in the 1440 and
  390 light/dark captures.
- **No placeholder**: absent owner/program/initiative/label values are functioning picker prompts,
  not passive “not set” rows.
- **Screenshot-verified**: all visual claims above are represented in the capture set; exact
  geometry is recorded alongside it.

## Findings resolved

1. Detail mastheads no longer advertise drag behavior; their shared object context menu remains.
2. Project actions no longer consume a separate upper row, and Repeat Project is no longer a
   top-level button.
3. Strategic-object properties never wrap. Conservative container thresholds move lower-priority
   controls into a stable, keyboard-operable overflow menu.
4. Project accountability now has its own Owner row, with assigned participants represented as a
   compact deduplicated indicator rather than repeated in the Overview body.
5. Start and Target are independent chips with individual clearing and range bounds; the former
   arrow summary and cramped segmented calendar header are gone.

## Engineering follow-up observed

The local development server logged the existing cold-open skeleton-to-detail hydration mismatch
before React regenerated the client tree. It did not affect the settled screenshots or responsive
measurements, but the route lifecycle should be corrected separately because clean hydration is a
broader server-data concern than this header slice.

Verdict: **SHIP** — every visual dimension meets the craft bar and all five surface gates are green.

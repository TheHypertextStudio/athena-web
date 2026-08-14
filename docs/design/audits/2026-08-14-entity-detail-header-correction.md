---
surfaces: ['orgs-[orgId]-projects-[projectId]']
date: 2026-08-14
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

# Design review: Entity detail header correction — 2026-08-14

Screenshots:

- `apps/web/.data/design-review/entity-detail-header/project-header-1440x900-light.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-1440x900-dark.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-390x844-light.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-390x844-dark.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-320x720-overflow-light.png`
- `apps/web/.data/design-review/entity-detail-header/project-header-320x720-start-picker-light.png`
- `apps/web/.data/design-review/entity-detail-header/measurements.json`

Register: app — calm, dense Plex/MD3. Captures use an authenticated local account and a Project
created through the application API. The test moves from desktop to mobile in one browser session
to exercise resize-dependent wrapping rather than loading each width from a clean state.

| Dimension                         | Score | Evidence                                                                                                                                                                                                          |
| --------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | Project identity, ownership, workflow state, health, and dates use direct product vocabulary; no implementation labels or duplicate ownership heading remain.                                                     |
| 2. Typographic craft              |     3 | The expanded title wraps to two complete lines at 390px and the summary wraps without clipping; compact-only truncation remains available at the collapsed endpoint.                                              |
| 3. Spatial rhythm & density       |     3 | The expanded masthead has a measured 20px top inset, a 48dp identity glyph, and at least 16px between metadata and tabs; compact geometry still aligns identity and actions in one 46px row.                      |
| 4. Hierarchy & information design |     3 | Owner precedes operational properties without a redundant label, Publish remains top-level, Repeat remains in Project actions, and the single-line property row discloses lower-priority values through overflow. |
| 5. Color discipline               |     3 | Light and dark screenshots now show token-correct surface, text, chip, tab, and action colors; browser assertions compare the dark controls directly with their resolved semantic tokens.                         |
| 6. Motion & feedback              |     3 | Only the `detail-*` scroll-collapse animations are pinned for evidence; color transitions remain live, while keyboard focus opens both overflow and the nested calendar.                                          |
| 7. States completeness            |     3 | Empty ownership is one actionable `Set owner` control; Start and Target remain separate, complete controls in overflow; every hidden property remains an operable picker.                                         |
| 8. Detail craft                   |     3 | Metadata and document geometry remain contained at 1440, 760, 480, 360, and 320px; both date labels satisfy `scrollWidth <= clientWidth`, and expanded title/summary satisfy `scrollHeight <= clientHeight`.      |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Findings resolved

1. Editable title and summary fields now size from content at the current width, with an observer
   fallback, so a desktop-to-mobile resize cannot leave either at a stale one-line height.
2. Full mastheads restore their 20px top separation and 16px pre-tab rhythm while compact headers
   retain the dense endpoint; the expanded object glyph is exactly 48dp.
3. Start and Target/End chips keep intrinsic, non-wrapping widths, and the whole date property moves
   to overflow before either label can be compressed.
4. Project ownership no longer renders an `Owner` label beside a `Set owner` chip; the control's
   accessible name retains the ownership context.
5. The evidence helper now pauses only header-collapse animations. The prior helper also paused
   theme color transitions and produced false light-colored controls in dark screenshots.

Verdict: **SHIP** — every dimension meets the craft bar and all five gates are green.

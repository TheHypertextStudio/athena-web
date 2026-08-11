---
surfaces: ['agenda']
date: 2026-08-10
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

# Design review: Agenda rail structural redesign — 2026-08-10

**Verdict: SHIP.** All eight craft dimensions meet the bar and every hard gate passes. This pass
supersedes the 2026-08-07 Agenda review for the redesigned rail.

## Screenshots and runtime evidence

Root: `apps/web/.data/design-review/agenda-rail-structural/final/` (gitignored).

| State                               | Files                             |
| ----------------------------------- | --------------------------------- |
| Populated desktop, both themes      | `today-1440x900-{light,dark}.png` |
| Populated mobile Sheet, both themes | `today-390x844-{light,dark}.png`  |
| Selected desktop draft              | `draft-1440x900-light.png`        |
| Selected mobile draft               | `draft-390x844-light.png`         |
| Measured runtime report             | `report.json`                     |

The authenticated Playwright pass used a throwaway local account, seeded calendar rows through the
product API, and rendered one provider `workingLocation` fixture through the real serializer. It
also exercised date-picker navigation, click selection, pointer drag, all-day selection, Save,
Cancel, responsive presentation, and the 320px overflow boundary.

```text
documentOverflow 0 · agendaScrollports 1 · visibleDateTriggers 1
visibleLockIcons 0 · workingLocationContextChips 1 · scheduleRadius 0px
minimumNonNegativeVerticalGap 1 · itemCount 7 · readableNamedItems 7
scaleLabels Timeline/List/1×/2×/3× · 320px scrollWidth 320
create POSTs before Save 0 / after Save 1 · saved matching items 1
drag 21:00–22:30 · all-day 2026-08-10–2026-08-11
mobile presentation agenda-mobile · runtimeErrors 0
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                                             |
| ------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice |     3 | The rail is quiet, direct, and specific: date movement, day context, all-day work, and timed work each have one clear region without instructional filler.                                           |
| 2. Typographic craft      |     3 | Long two-hour items retain title and exact time on separate lines. Short items keep their title before secondary time, while the time axis uses stable tabular labels.                               |
| 3. Spatial rhythm         |     3 | The timed viewport is edge-to-edge, with one scrollport and no inherited outer canvas padding. Adjacent vertical items measure a minimum one-pixel gap; concurrent columns have explicit separation. |
| 4. Hierarchy              |     3 | One date control leads the rail. Working location is context above all-day items, all-day items precede the timed grid, and event title precedes time inside each block.                             |
| 5. Colour discipline      |     3 | Semantic surface tones separate shell, context, all-day, and timed content in both themes. Layer colour remains a restrained item accent instead of becoming decorative rail chrome.                 |
| 6. Motion & feedback      |     3 | Pointer-down produces a visible local selection before the editor opens. Existing reduced-motion behavior is preserved, and the mobile Sheet/dialog animations settle without layout shift.          |
| 7. States completeness    |     3 | Populated, empty, overlap, all-day, context, draft, saved, cancelled, desktop, mobile, light, and dark states are covered. Save produces exactly one write; pre-save and Cancel produce none.        |
| 8. Detail craft           |     3 | Resting locks are absent, accents are straight two-pixel inset bars, the nested schedule radius is `0px`, controls remain named, and no horizontal overflow appears at 320px.                        |

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                                                                                                                  |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Date, navigation, display, all-day, grid, item, and dialog controls have accessible names. Focused-grid date and draft keyboard paths have behavior coverage. Read-only context remains available to assistive technology without repeated visible locks. |
| Responsive          | ✅     | Desktop uses an inward anchored editor; 390px uses the full mobile rail Sheet plus bottom dialog. At 320px, `clientWidth === scrollWidth === 320`.                                                                                                        |
| Theme parity        | ✅     | Populated desktop and mobile rail captures exist in light and dark, with the same hierarchy and readable state treatment.                                                                                                                                 |
| No placeholder      | ✅     | Every captured record is a local API-backed calendar item or explicit provider-semantic fixture; controls execute real local behavior.                                                                                                                    |
| Screenshot-verified | ✅     | Required desktop/mobile and light/dark capture set is present, plus both editor presentations.                                                                                                                                                            |

## Findings

No ship-blocking finding remains. Concurrent events at mobile rail width necessarily receive less
horizontal text space, but they remain separate, titled, openable regions rather than blending or
disappearing. The rail intentionally preserves exact time in the accessible item name when the
visual secondary line cannot fit.

## Regression checks

- A provider event with `eventType: workingLocation` renders one context chip and no timed card.
- A normal event whose title is `Home` remains in the timed grid.
- The direct-create callback remains stable across controlled draft projection; the live pass has
  zero runtime or console errors after the maximum-update-depth regression was fixed.
- The date picker jumped from Aug 10 to Aug 11 and Today returned to Aug 10.
- Display settings expose only `1×`, `2×`, and `3×`; legacy fractional values normalize to the
  nearest supported step in behavior tests.

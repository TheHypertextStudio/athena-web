---
surfaces:
  - orgs-[orgId]-projects
  - orgs-[orgId]-projects-[projectId]
  - orgs-[orgId]-initiatives
  - orgs-[orgId]-initiatives-[initiativeId]
date: 2026-08-21
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

# Design review: Planning timeframes — 2026-08-21

The review covers Project creation, Project detail, the grouped Project list, Initiative creation,
and Initiative detail. The authenticated browser scenario creates a Project with Q1 FY 2027 and H2
FY 2027 boundaries under a July fiscal year, changes the workspace to a January fiscal year, and
confirms that every saved label retains its original basis.

The 20 screenshots live in
`docs/design/audits/screenshots/2026-08-21-planning-timeframes/`. Each of the five surfaces has a
1440 by 900 desktop capture and a 390 by 844 mobile capture in light and dark themes.

Register: app. The controls use Athena's compact MD3 product vocabulary and density.

| Dimension                           | Score | Evidence                                                                                                                                                                                                       |
| ----------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | Project and Initiative surfaces use plain Start, Target, Month, Quarter, Half-year, Year, and Specific date labels. No storage or fiscal-snapshot terms reach the interface.                                   |
| 2. Typographic craft                |     3 | Picker rows preserve the shared label scale and weight. Q1 FY 2027 and H2 FY 2027 remain readable without wrapping in the 390-pixel captures.                                                                  |
| 3. Spatial rhythm and density       |     3 | The precision list, period navigator, and choices use one compact vertical rhythm. Creation chips align with the existing status and relationship controls.                                                    |
| 4. Hierarchy and information design |     3 | People choose precision before period. Project Start and Target stay inline when space permits, while Initiative Target moves into the existing property overflow instead of competing with status and health. |
| 5. Color discipline                 |     3 | Light and dark captures stay neutral. Selection and focus use the semantic primary treatment, while the inverted Project range uses the semantic error treatment.                                              |
| 6. Motion and feedback              |     3 | Enter opens the focused target picker, Escape closes it, selection updates the trigger immediately, and disabled creation controls reflect invalid ranges.                                                     |
| 7. States completeness              |     3 | The scenario covers unset, month, quarter, half-year, exact date, clear, invalid range, changed fiscal settings, grouped list, and progressive overflow states.                                                |
| 8. Detail craft                     |     3 | The document has no horizontal overflow at 1440, 390, or 320 pixels. Planning triggers remain at least 40 pixels tall at 320 pixels, and the focused trigger has a visible ring or outline.                    |

Gates: A11y passed. Responsive behavior passed. Theme parity passed. No placeholder passed.
Screenshot verification passed.

The Initiative tree does not group by target timeframe. Grouping would flatten parent and child
context, so the hierarchy keeps semantic target labels and filtering while the flat Project roster
owns semantic target grouping.

The feature has no unresolved design finding. The E2E scenario passed all behavior, overflow,
focus, touch-target, and non-hydration runtime checks.

## Engineering follow-up observed

Project detail still logs the previously documented skeleton-to-cached-record hydration mismatch
on a cold development-server navigation. React regenerates the same settled tree, and the mismatch
predates the planning-timeframe work. The test rejects every other uncaught page error. The broader
server-data boundary should remove this race in its own change.

Verdict: **SHIP**. Every dimension meets the craft bar, and all five surface gates pass for the
planning-timeframe slice.

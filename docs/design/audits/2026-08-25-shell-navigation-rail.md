---
surfaces: ['shell-navigation-rail']
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

# Design review: Shell navigation rail — 2026-08-25

**Verdict: SHIP.** The rail keeps daily navigation present in a single, labeled 96 px desktop
column. The full sidebar remains available when expanded. More keeps secondary destinations in one
anchored menu, and the endpoint screenshots show no duplicate shared elements after a density
change.

## Screenshot evidence

The authenticated evidence test created a disposable local account and captured the settled shell
at `docs/design/audits/screenshots/2026-08-25-shell-navigation-rail/`:

- `expanded-1440x900-light.png` and `expanded-focus-1440x900-light.png`
- `rail-1440x900-light.png`, `rail-more-1440x900-light.png`, and `rail-1440x900-dark.png`
- `rail-1024x900-light.png` and `rail-1024x900-dark.png`

The test waits for Today’s real content and for the 200 ms density change before screenshotting.
That matters because a screenshot taken during a View Transition correctly contains a snapshot of
both endpoint layouts and is not evidence of the settled UI.

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                                   |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice | 3     | The quiet MD3 rail uses one selected tonal pill and one familiar workspace glyph. No card chrome competes with Today.                                                                      |
| 2. Typographic craft      | 3     | The full and compact labels remain readable at 1024 px. The page title, rail labels, More group labels, and menu rows form distinct, restrained levels.                                    |
| 3. Spatial rhythm         | 3     | The 96 px rail keeps one icon and one label per 56 px item. The More menu maintains the same row rhythm without crowding its 12 secondary routes.                                          |
| 4. Hierarchy              | 3     | Today stays selected and daily routes remain directly reachable. Workspace administration moves behind More instead of competing with the primary path.                                    |
| 5. Color discipline       | 3     | Light and dark captures use neutral surfaces and reserve blue for Today, the Athena prompt, and keyboard focus. Both preserve the sidebar-to-panel depth order.                            |
| 6. Motion & feedback      | 3     | The density control retains focus after the View Transition. Screenshots capture the settled endpoint only, while focused tests cover the reduced-motion fallback and unique shared names. |
| 7. States completeness    | 3     | A newly created personal workspace still exposes all daily destinations, a useful More partition, and the real Today prompt. No skeleton or invented data remains in the settled captures. |
| 8. Detail craft           | 3     | Focus rings remain visible on the expanded control and More trigger. The menu clears the viewport edge, labels do not clip, and the 320 px check reports no horizontal overflow.           |

## Hard gates

| Gate                | Result | Evidence                                                                                                                             |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A11y                | Pass   | The expanded collapse control and compact More trigger show visible focus. The evidence test preserves focus through density change. |
| Responsive          | Pass   | The 1024 px screenshots show the persistent rail, and the test asserts no document overflow at 1024 px and 320 px.                   |
| Theme parity        | Pass   | Rail endpoints are captured at 1440 px and 1024 px in light and dark themes.                                                         |
| No placeholder      | Pass   | The test waits for the real Plan today with Athena prompt before capture.                                                            |
| Screenshot-verified | Pass   | Each finding cites the captured authenticated states above.                                                                          |

## Repository gate status

`APP_URL=https://md3-navigation-rail.docket.localhost PASSKEY_RP_ID=md3-navigation-rail.docket.localhost E2E_EVIDENCE=1 pnpm --filter @docket/web exec playwright test e2e/shell/navigation-rail-evidence.spec.ts --workers=1` passes. The focused shell suite passes 97 tests across five files. The Web type check and evidence-test lint pass. The full Web suite, design-token policy, and production build remain recorded in the original navigation validation commit.

## Findings

No ship-blocking findings remain. The expanded screenshot includes the real recovery-code prompt
for the new disposable account. It is an account-security action, not placeholder UI.

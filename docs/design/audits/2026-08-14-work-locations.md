# Design review: Work locations — 2026-08-14

Screenshots:

- `docs/design/audits/screenshots/2026-08-14-work-locations/work-locations-1440x900-light.png`
- `docs/design/audits/screenshots/2026-08-14-work-locations/work-locations-1440x900-dark.png`
- `docs/design/audits/screenshots/2026-08-14-work-locations/work-locations-390x844-light.png`
- `docs/design/audits/screenshots/2026-08-14-work-locations/work-locations-390x844-dark.png`
- `docs/design/audits/screenshots/2026-08-14-work-locations/work-locations-add-place-1440x900-light.png`

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                                     |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice   | 3     | The app register is calm and tool-like in all four page frames. Copy names the person’s task directly: “Add place,” “Schedule,” “Automatic location,” and “Calendar sync,” without provider or implementation jargon.                                        |
| 2. Typographic craft        | 3     | The desktop and phone frames use the MD3 title, body, and label hierarchy consistently. Place names carry medium emphasis, addresses and schedule details recede, and no heading or control label wraps awkwardly.                                           |
| 3. Spatial rhythm & density | 3     | Saved places and schedules use aligned 40 px icon/action boxes inside compact 64 px rows. The 16 px phone inset, separators, section spacing, and desktop content edges repeat consistently across the surface.                                              |
| 4. Hierarchy & information  | 3     | “Add place” is the single filled primary action. Editing, home designation, retirement, and occurrence changes are progressively disclosed through row overflow menus; address and map choices appear only in the editor.                                    |
| 5. Color discipline         | 3     | Light and dark captures use only semantic surface, outline, text, and primary tokens. Home and Current remain neutral outline badges; provider and location state do not introduce decorative colors.                                                        |
| 6. Motion & feedback        | 3     | The browser journey verifies immediate Home and Current feedback after writes. The Add place dialog uses the shared tokened dialog transition and restores focus to its opener after Escape; reduced-motion behavior is inherited from the shared primitive. |
| 7. States completeness      | 3     | The populated, no-linked-account, disabled automatic-location, and editor states are visible in the evidence set. DOM tests also cover loading skeletons, application-owned errors, action-required sync, and empty place/schedule copy.                     |
| 8. Detail craft             | 3     | Borders and icon boxes remain aligned in both themes; badges do not disturb row baselines; long secondary copy truncates; the phone frame is fully usable; and the automated 320 px check proves no document overflow.                                       |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Verification notes

- The real Playwright journey creates multiple arbitrary places, designates Home independently,
  sets Current, creates a weekly schedule, changes one occurrence, reloads, and verifies persisted
  state.
- The evidence journey verifies keyboard activation of Add place, visible keyboard focus, editor
  autofocus, Escape focus restoration, a full-width 390 px content surface, and zero horizontal
  overflow at 320 px.
- The mobile settings shell replaces the permanently visible rail with a labelled section select;
  all personal and permitted workspace destinations remain keyboard- and touch-accessible.

## Findings

No ship-blocking craft findings remain in the reviewed states.

Verdict: **SHIP** — every dimension meets the craft bar and every hard gate is green.

# Design review: shell navigation states — 2026-08-28

Screenshots: `docs/design/audits/screenshots/2026-08-28-shell-navigation-states/`
(1440×900 and 390×844, light and dark; 1024×900 density check; explicit hover and focus states)

| Dimension                         | Score | Evidence                                                                                                                                                                                   |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice         | 3     | Docket's Plex typography and restrained surface treatment remain intact. The generic More destination is gone.                                                                             |
| 2. Typographic craft              | 3     | Daily labels use the shared label token. Recent entities use icons and reveal their resolved names through tooltips.                                                                       |
| 3. Spatial rhythm & density       | 4     | The shell reserves 80px. Rail targets are 64×64 with 4px gaps, indicators are 56×32, and auxiliary and recent icon targets are 40×40. The workspace mark is 32×32 inside its 40×40 target. |
| 4. Hierarchy & information design | 4     | Six daily destinations remain primary. A divider separates three recent document shortcuts. Expansion owns the complete catalog.                                                           |
| 5. Color discipline               | 3     | Selection uses secondary-container. Hover, press, and focus use semantic primary or on-surface state layers in both themes.                                                                |
| 6. Motion & feedback              | 4     | The indicator pill paints 4% hover, 8% press, 12% focus, and 16% combined hover and focus layers without changing geometry. Reduced-motion behavior remains inherited.                     |
| 7. States completeness            | 3     | Active, inactive, hover, press, focus, disabled, loading, empty-recents, expanded, and collapsed states have explicit behavior.                                                            |
| 8. Detail craft                   | 3     | A 3px secondary focus ring follows the indicator pill instead of outlining the full rectangular hit box. The workspace mark and recent icons align on the rail centerline.                 |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings

The review found no blocking defect after the implementation pass. The authenticated browser test
asserts the geometry and computed rest, hover, press, focus, and combined state paint. Docket keeps
an 80px total shell-width override instead of the 96px M3 Expressive rail width. The navigation
items still use the M3 Expressive 64px minimum height, 4px gap, and 56×32 indicator. The mobile
drawer capture waits until its left edge reaches zero, so the evidence does not record an in-flight
slide transition.

Verdict: SHIP. Every dimension meets the bar, and every gate passes.

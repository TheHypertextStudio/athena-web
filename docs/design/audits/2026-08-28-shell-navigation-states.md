# Design review: shell navigation states — 2026-08-28

Screenshots: `docs/design/audits/screenshots/2026-08-28-shell-navigation-states/`
(1440×900 and 390×844, light and dark; 1024×900 density check; explicit hover and focus states)

| Dimension                         | Score | Evidence                                                                                                                                            |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Docket's Plex typography and restrained surface treatment remain intact. The generic More destination is gone.                                      |
| 2. Typographic craft              | 3     | Daily labels use the shared label token. Recent entities use icons and reveal their resolved names through tooltips.                                |
| 3. Spatial rhythm & density       | 4     | The shell reserves 80px. Rail targets are 64×60, indicators are 56×32, and auxiliary and recent icon targets are 40×40.                             |
| 4. Hierarchy & information design | 4     | Six daily destinations remain primary. A divider separates three recent document shortcuts. Expansion owns the complete catalog.                    |
| 5. Color discipline               | 3     | Selection, hover, press, and focus use semantic surface, secondary-container, and ring tokens in both themes.                                       |
| 6. Motion & feedback              | 4     | Hover and focus paint the same state layer. Press adds a stronger state token without changing geometry. Reduced-motion behavior remains inherited. |
| 7. States completeness            | 3     | Active, inactive, hover, press, focus, disabled, loading, empty-recents, expanded, and collapsed states have explicit behavior.                     |
| 8. Detail craft                   | 3     | The focus ring follows the indicator pill instead of outlining the full rectangular hit box. Recent icons align on the rail centerline.             |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings

The review found no blocking defect after the implementation pass. The authenticated browser test
asserts the geometry and computed hover and focus paint. The mobile drawer capture waits until its
left edge reaches zero, so the evidence does not record an in-flight slide transition.

Verdict: SHIP. Every dimension meets the bar, and every gate passes.

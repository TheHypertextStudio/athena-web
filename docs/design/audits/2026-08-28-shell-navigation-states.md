# Design review: shell navigation states — 2026-08-28

Screenshots: `docs/design/audits/screenshots/2026-08-28-shell-navigation-states/`
(1440×900 and 390×844, light and dark; 1024×900 density check; explicit hover and focus states)

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Docket's Plex typography and restrained surface treatment remain intact. The generic More destination is gone.                                                                                                                                                                                                              |
| 2. Typographic craft              | 3     | Daily labels use the shared label token. Recent entities use their saved identity icons and reveal their resolved names through tooltips.                                                                                                                                                                                   |
| 3. Spatial rhythm & density       | 4     | The shell reserves 80px around a 64px rail. Its destination scrollport uses 1px outer margins to expose the full 66px focus treatment without adding padding. Primary targets are 64×56 with 4px gaps, so six labeled destinations consume 356px. Indicators remain 56×32, while auxiliary and recent targets remain 40×40. |
| 4. Hierarchy & information design | 4     | Six daily destinations remain primary. A divider separates three recent document shortcuts. Expansion owns the complete catalog.                                                                                                                                                                                            |
| 5. Color discipline               | 4     | Selection uses secondary-container. Hover, press, and focus use semantic primary or on-surface state layers in both themes. Recent Projects and Initiatives preserve their saved preset or custom identity color.                                                                                                           |
| 6. Motion & feedback              | 4     | The indicator pill paints 4% hover, 8% press, 12% focus, and 16% combined hover and focus layers without changing geometry. Reduced-motion behavior remains inherited.                                                                                                                                                      |
| 7. States completeness            | 3     | Active, inactive, hover, press, focus, disabled, loading, empty-recents, expanded, and collapsed states have explicit behavior.                                                                                                                                                                                             |
| 8. Detail craft                   | 4     | A 3px secondary focus outline sits 2px outside the indicator pill instead of reading as its border. The workspace mark and 32px recent identity circles align on the rail centerline.                                                                                                                                       |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings

The review found no blocking defect after the implementation pass. The authenticated browser test
asserts the geometry and computed rest, hover, press, focus, and combined state paint. Docket keeps
an 80px total shell-width override instead of the 96px M3 Expressive rail width. It also uses a
denser 56px labeled desktop target with grid-aligned 4px gaps instead of the 64px Expressive
minimum. The 56×32 indicator and its interaction model remain unchanged. The mobile drawer capture
waits until its left edge reaches zero, so the evidence does not record an in-flight slide
transition.

The recent shortcuts now reuse detail-page identities. The Project evidence uses a saved bus icon
with a custom rose color, and the Initiative uses a saved purple rocket. The Program keeps its
fixed blue layers identity. Each identity renders in a 32px tonal circle inside the existing 40px
target, so the added backgrounds do not change rail geometry.

Verdict: SHIP. Every dimension meets the bar, and every gate passes.

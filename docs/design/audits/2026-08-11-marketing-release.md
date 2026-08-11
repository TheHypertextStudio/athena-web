# Design review: Marketing release — 2026-08-11

Screenshots: `docs/design/audits/assets/2026-08-11-marketing-release/` (`/`, `/pricing`,
and `/about` at 1440×900 and 390×844, light plus OS-dark emulation)

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     4 | The home page uses the locked positioning once, follows it with one literal sentence, and moves from cream editorial framing into labeled captures of the real Docket app. Pricing names Docket and Docket Pro as products and explains the organization billing unit directly. |
| 2. Typographic craft              |     3 | Fraunces carries the home headline and product names; Plex Sans carries factual prose; Plex Mono is reserved for the screenshot disclosure and price unit. The 390px home capture preserves the headline hierarchy without clipping.                                            |
| 3. Spatial rhythm & density       |     3 | Home sections use a consistent generous marketing rhythm, pricing keeps two comparable products aligned at desktop and stacked at mobile, and About holds a single readable measure. The screenshot plates align to the same content grid.                                      |
| 4. Hierarchy & information design |     4 | The home page has one dominant claim, one supporting fact, one primary account action, then one factual section per product concept. Pricing separates the two available products before presenting billing mechanics.                                                          |
| 5. Color discipline               |     3 | The surface remains cream, ink, and neutral borders; the embedded application screenshots carry only their own semantic colors. OS-dark screenshots confirm that the deliberately light marketing canvas and overscroll remain intact.                                          |
| 6. Motion & feedback              |     3 | Marketing controls use the shared Button interactions or restrained link color transitions. The page has no decorative motion, and the above-the-fold product capture now loads eagerly without a delayed LCP warning.                                                          |
| 7. States completeness            |     3 | Anonymous captures show “Create free account” and “Sign in”; authenticated captures show “Open Docket.” Every example-data frame contains a rendered app view rather than an empty shell, and each is explicitly labeled “Example data.”                                        |
| 8. Detail craft                   |     3 | Borders, crops, and disclosure badges remain aligned at both widths. Every route passed the automated 320px overflow check; all nine screenshot assets resolve with literal alt text and no placeholder frame remains.                                                          |

Gates: A11y ✅ (semantic landmarks, literal image alt text, link/button focus behavior preserved) ·
Responsive ✅ (desktop/mobile captures plus 320px overflow checks) · Theme parity ✅ (light-only
marketing verified under OS dark mode) · No placeholder ✅ (real app captures, disclosed as example
data) · Screenshot-verified ✅

## Findings (ordered by severity)

None on the audited surfaces. Production publication remains governed by the separate Docket Pro
billing release gate; this visual verdict does not claim that the live purchase path is configured.

Verdict: **SHIP** — all eight dimensions meet the craft bar and all five gates pass.

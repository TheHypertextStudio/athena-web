# Design review: Public documentation — 2026-08-25

The review covers the refreshed Today guide at 1440×900 and 390×844 in light and dark themes.
The screenshots are:

- `apps/docs/images/audits/2026-08-25-today-desktop-light.png`
- `apps/docs/images/audits/2026-08-25-today-desktop-dark.png`
- `apps/docs/images/audits/2026-08-25-today-mobile-light.png`
- `apps/docs/images/audits/2026-08-25-today-mobile-dark.png`

| Dimension                     | Score | Evidence                                                                                                                                                        |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice   | 3     | Fraunces headings, IBM Plex Sans body text, the Docket mark, and direct product language carry the public Docket register without launch copy or filler.        |
| 2. Typographic craft          | 3     | The page uses one display heading, clear section headings, readable body measure, and bold text only for the UI labels that a person must find.                 |
| 3. Spatial rhythm and density | 3     | The desktop page keeps a steady reading column between the navigation and page outline, and the mobile page reduces that layout to one column without crowding. |
| 4. Hierarchy and information  | 3     | The opening answers what Today does, and each following heading names one action in the order a person uses the page.                                           |
| 5. Color discipline           | 3     | The page stays neutral in both themes. Mintlify measures the dark-theme primary at 4.60:1 on white and 4.22:1 on the dark background.                           |
| 6. Motion and feedback        | 3     | Theme controls, navigation, and links show interactive states through the Mintlify theme. The page does not add decorative motion.                              |
| 7. States completeness        | 3     | Static guide content has no fake controls, placeholder data, or dead actions. Every internal page link resolves.                                                |
| 8. Detail craft               | 3     | The mobile document width is 375px inside a 390px viewport. Headings, lists, and navigation remain aligned without horizontal overflow in either theme.         |

The hard gates pass. Mintlify reports no broken links, all 40 MDX files give media alternative
text, and the color checker passes after the dark-theme primary correction. The 390px screenshots
show no horizontal overflow. The content includes no placeholder UI or demo data.

No ship-blocking visual findings remain.

Verdict: The public documentation meets the ship bar.

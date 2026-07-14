# Design review: Projects experience — 2026-07-14

Screenshots:

- `apps/web/.data/design-review/project-md3/detail-desktop-light.png`
- `apps/web/.data/design-review/project-md3/detail-desktop-dark.png`
- `apps/web/.data/design-review/project-md3/detail-mobile-light.png`
- `apps/web/.data/design-review/project-md3/detail-mobile-dark.png`

Register: app — calm, dense Plex/MD3. The captures use an authenticated local account and
user-authorized Las Vegans for Better Transit sample Projects created through the application API;
the records are not product fixtures.

| Dimension                         | Score | Evidence                                                                                                                                                                               |
| --------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | The Project name and outcome lead the page; vocabulary is direct, and decorative or developer-facing labels are absent.                                                                |
| 2. Typographic craft              |     3 | Detail uses canonical MD3 `headline-large`, `body-large`, and label tokens. The permanent document steps through headline and title roles without custom sizes or a second type scale. |
| 3. Spatial rhythm & density       |     3 | Identity, summary, two quiet property controls, tabs, contents, and document all appear in the first mobile viewport with a consistent 4px-based rhythm.                               |
| 4. Hierarchy & information design |     3 | The Project itself precedes secondary properties. Health and target remain immediately actionable; the rest stays in one anchored Properties disclosure.                               |
| 5. Color discipline               |     3 | Neutral surfaces dominate both themes. Semantic red and amber are limited to the Project display icon and health state.                                                                |
| 6. Motion & feedback              |     3 | Property controls have resting, hover, and visible keyboard-focus state layers; the compact contents chevron explains expansion without decorative motion.                             |
| 7. States completeness            |     3 | Empty people do not manufacture a row, heading-free documents do not reserve a gutter, multiple headings generate Contents, and Resources remain a dedicated tab.                      |
| 8. Detail craft                   |     3 | Rounded MD3 glyphs are one size below their containers, property controls and contents use 40px targets, and DOM checks show no page overflow at 1440, 390, or 320px.                  |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: Project properties, icon customization, health, target, tabs, and contents are semantic
  controls with accessible names. Keyboard focus is visible on the health control. Primary mobile
  controls measure at least 40px high.
- **Responsive**: authenticated runtime checks report `scrollWidth === innerWidth` at 1440, 390,
  and 320px. The tab strip owns its horizontal overflow instead of widening the page.
- **Theme parity**: the same hierarchy and semantic state surfaces remain legible in the captured
  light and dark themes.
- **No placeholder**: absent participants disappear instead of showing “No people yet”; the
  Properties disclosure contains real editors and the document uses real local API data.
- **Screenshot-verified**: all scored visual claims are represented in the four captures above;
  a 320px DOM pass additionally reported no console errors and no horizontal overflow.

## Findings resolved

1. Health and target were semantic buttons but visually read as metadata. Both now use a quiet
   resting MD3 state layer, full rounding, smaller glyphs, and 40px targets.
2. The document contents control looked like an empty ruled section. It is now a compact rounded
   disclosure with a rounded Material chevron, while wide containers retain the unboxed gutter.
3. The recovery prompt displaced the Project on detail routes. Object-detail detection now keeps
   that prompt on overview surfaces and removes it from Project, Initiative, Task, Program, and
   Cycle detail pages.
4. The application had a parallel custom typography vocabulary. Production surfaces now use the
   canonical fifteen-role MD3 scale, enforced by a source contract that rejects the removed names.

Verdict: **SHIP** — every dimension meets the craft bar and all hard gates are green.

# Design review: entity glyph picker — 2026-09-05

This scorecard is for the maintainer who approves the picker for release. They must review the five
screenshots and either approve main integration or name a visual defect that still blocks it.

The screenshots are in
`docs/design/audits/screenshots/2026-09-05-entity-glyph-picker/`. The set contains 1440 by 900 and
390 by 844 frames in light and dark themes. It also contains a 320 by 844 overflow frame.

| Dimension                           | Score | Evidence                                                                                                                                                                                                  |
| ----------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     2 | The segmented tabs, bare glyph matrix, and unlabelled color strip read as a generic generated settings panel rather than Docket's dense picker family.                                                    |
| 2. Typographic craft                |     2 | The component uses the type tokens, but every section label has the same weight and the boxed search plus boxed tabs creates a stack of unrelated controls.                                               |
| 3. Spatial rhythm and density       |     1 | Fourteen color buttons share one 320-pixel flex row and shrink below the required 40-pixel target. The icon catalog also spends its first rows on low-value numeric and resolution symbols.               |
| 4. Hierarchy and information design |     1 | The first mobile browse frame promotes `123`, `1x`, `2D`, and resolution badges above useful work symbols. The panel exposes package order instead of a designed browsing order.                          |
| 5. Color discipline                 |     2 | Color belongs in this editor, but the saturated dot strip has no visual labels or stable selection mark. Candidate icons omit the selected-color tinted background required by the feature specification. |
| 6. Motion and feedback              |     1 | A focus ring appears in one staged frame, but all 3,905 icon buttons remain in the Tab order and the selected glyph, skin tone, and color lack a strong non-color visual state.                           |
| 7. States completeness              |     2 | Loading and empty copy exist, but an emoji load failure offers no retry. Search result changes are not announced to assistive technology.                                                                 |
| 8. Detail craft                     |     1 | The tone controls render as small floating squares, the color targets collapse, candidate backgrounds are missing, and the mobile panel reads as an undifferentiated wall of symbols.                     |

Gates: A11y ❌ · Responsive ❌ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Findings

The following findings block release:

1. `entity-icon-picker-loaded.tsx:563-610` lets fourteen nominally 40-pixel color buttons shrink
   inside one row. The rendered targets are about 22 pixels wide. The replacement must preserve a
   40 by 40 target at every supported width.
2. `entity-icon-picker-loaded.tsx:94-123` gives every catalog button `tabIndex=0`. A keyboard user
   must traverse thousands of controls. Each grid needs one roving Tab stop and arrow-key movement.
3. `entity-icon-picker-loaded.tsx:518-540` assigns tab roles without arrow-key behavior,
   `aria-controls`, or an associated tab panel. The replacement must implement the complete tab
   pattern.
4. `entity-icon-picker-model.ts:17-28` exposes package order as browse order. The first rows contain
   numeric and resolution symbols. A curated work-icon set must lead the complete catalog.
5. `entity-icon-picker-loaded.tsx:116-121` renders bare candidate glyphs. Each candidate must preview
   the selected tinted identity. Emoji must retain native color inside the same tinted circle.
6. `entity-icon-picker-loaded.tsx:819-885` gives skin-tone selection no stable visual indicator and
   permits controls narrower than 40 pixels. The controls need radio semantics, roving focus, and a
   non-color selected mark.
7. `entity-icon-picker-loaded.tsx:667-672` reports an emoji-load failure without recovery. It needs
   a retry action and an announced loading or error state.

The Turbopack development server did not complete an authenticated route under the host's swap
pressure. The final screenshots therefore use the production build against the documented local
API, database, Portless origin, and passkey session. The production artifact passed its build,
typecheck, asset-boundary, and service-worker budget checks before capture.

Verdict: BELOW BAR. Dimensions 1 through 8 and the accessibility and responsive gates require a
new implementation and new screenshot evidence.

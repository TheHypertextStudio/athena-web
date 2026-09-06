# Design review: entity glyph picker — 2026-09-06

This scorecard is for the maintainer who approves the picker for release. They must review the five
screenshots and either approve main integration or name a visual defect that still blocks it.

The screenshots are in
`docs/design/audits/screenshots/2026-09-06-entity-glyph-picker/`. The set contains 1440 by 900 and
390 by 844 frames in light and dark themes. It also contains a 320 by 844 frame with the complete
color selector open.

| Dimension                           | Score | Evidence                                                                                                                                                                                      |
| ----------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     4 | The picker now uses Docket's dense menu treatment, tinted entity marks, tonal grouping, and compact footer instead of generic boxed controls.                                                 |
| 2. Typographic craft                |     4 | Search, tabs, section labels, option text, and footer metadata form a clear type hierarchy in both themes.                                                                                    |
| 3. Spatial rhythm and density       |     4 | Every interactive choice keeps a 40 by 40 target. The virtual grid remains dense without collapsing targets, and the footer no longer tries to fit fifteen colors in one row.                 |
| 4. Hierarchy and information design |     4 | Curated work symbols lead the icon catalog. Each tab owns its browse and search results, and the selected tab remains clear.                                                                  |
| 5. Color discipline                 |     4 | Every candidate previews the selected tinted identity. Emoji retain native color. The compact color popover shows every preset with a persistent ring and check mark on the selected choice.  |
| 6. Motion and feedback              |     4 | Roving focus leaves one Tab stop per grid. Arrow, Home, End, Page, Enter, Space, and Escape behavior passed the browser and component checks. Focus and selection use shape as well as color. |
| 7. States completeness              |     4 | The component covers loading, retryable load failure, empty results, tab-scoped results, suggestions, recents, selected states, and an announced result count.                                |
| 8. Detail craft                     |     4 | Tone controls render real hand variants. Tooltips name glyphs. The 320-pixel color selector contains all fifteen fixed-size choices without clipping or horizontal page overflow.             |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Review evidence

The authenticated browser run passed the five-frame matrix. It verified search autofocus,
tab-scoped icon and emoji results, emoji browsing, skin-tone selection, keyboard focus, Escape
focus return, long-result virtualization, fixed target sizes, and zero horizontal page overflow at
320 pixels.

The implementation replaces the failed September 5 review in four specific ways. It uses a roving
Tab stop instead of placing 3,905 symbols in the page Tab order. It leads with a reviewed work-icon
set instead of package order. It renders every choice as the saved tinted identity. It moves preset
colors into a bounded popover that never shrinks its targets.

The picker contains no horizontal hairlines. Spacing separates the search field from the tabs. A
rounded tonal state marks the selected tab. A surface-tone change groups the color footer without
drawing a rule across the panel.

The screenshots use the compiled production application against the documented local API, PGlite
database, Portless origin, and authenticated passkey session. The evidence test passed in 48.8
seconds.

Verdict: SHIP after maintainer approval. This review does not authorize main integration or a
production deployment.

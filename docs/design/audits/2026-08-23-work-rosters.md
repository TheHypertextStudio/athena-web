# Design review: Work rosters — 2026-08-23

This review covers the production Tasks, Projects, Programs, and Initiatives rosters after the
shared work-view migration was corrected. The screenshots are in
`screenshots/2026-08-23-work-rosters/`.

| Dimension                           | Score | Evidence                                                                                                                                                                                        |
| ----------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | Quiet MD3 surfaces, restrained blue selection, and target identity glyphs now replace the generic checkbox-first table.                                                                         |
| 2. Typographic craft                |     3 | Every roster uses the semantic MD3 body and label roles. The design-token release gate passes with no new type debt.                                                                            |
| 3. Spatial rhythm and density       |     3 | The 56px rows support a title and optional summary without the old compressed metadata string. The roster fills the available page width.                                                       |
| 4. Hierarchy and information design |     4 | View chips sit left, display controls sit right, and save/default actions live in View settings. Initiative rails show arbitrary nesting without status groups splitting the tree.              |
| 5. Color discipline                 |     3 | Status, health, priority, identity, and progress use semantic theme tokens. The list adds no raw colors or non-overlay shadows.                                                                 |
| 6. Motion and feedback              |     3 | Selection replaces the identity only on hover, keyboard focus, or after selection begins. Drag and reparent feedback remains available for Initiatives.                                         |
| 7. States completeness              |     3 | Loading uses roster-shaped rows. Empty and failed states use one title and one relevant action without explanatory filler. Search remains available from Display and the page shortcut.         |
| 8. Detail craft                     |     3 | Dates are formatted, actors are resolved, relation ids are absent, summaries truncate, progress is visual, and metadata keeps a bounded horizontal pan when the Focus panel reduces the canvas. |

Gates: A11y PASS · Responsive PASS · Theme parity PASS · No placeholder PASS ·
Screenshot-verified PASS

The authenticated production pass checked all four targets in the installed Docket app. It also
opened Display and View settings to verify that search, grouping, sorting, layout, and properties
are display concerns while save and default actions remain view concerns. CI run 32654156538 passed
the full type, lint, test, design-policy, build, migration, health, and deployment gates.

Verdict: SHIP. Every dimension meets a score of 3, and every hard gate passes.

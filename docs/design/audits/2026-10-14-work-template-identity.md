# Design review: Work-template identity — 2026-10-14

Register: calm Plex/MD3 application UI. Scope: template library, guided creation, canonical draft
editor, retained publication identity, and project-list grouping. This is local interface acceptance;
it does not establish deployment, provider, or owner acceptance.

Screenshots are retained privately at
`/Users/williecubed/.codex/recovery/2026-10-14-athena/identity-captures/`.
The final matrix covers 1440×900, 390×844, 320×844, and 390×600 in both themes.
Use `orgs-orgId-settings-templates-*` for the final library ordering; earlier concrete-ID library
frames precede that correction. The other four route sets use their concrete fixture IDs.
All records shown were created through the authenticated local API or interface.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The library uses the established Settings shell and Plex type. “Only you”, “Team”, “Draft”, and numbered publications distinguish privacy from availability without exposing storage terms.                                                                                                   |
| 2. Typographic craft              | 3     | Desktop library frames show one page title, kind headings, and name/description rows. The 320px dark editor preserves label/value hierarchy and wraps explanatory prose.                                                                                                                      |
| 3. Spatial rhythm & density       | 3     | Kind groups share row edges and spacing. Short-phone frames show usable template rows before the secondary authoring policy; the desktop editor retains one aligned form column.                                                                                                              |
| 4. Hierarchy & information design | 3     | New template is the library’s primary action. Guided creation remains reachable; the canonical editor separates Save draft, publication, and immutable history. Identity/version appears above ordinary project metadata.                                                                     |
| 5. Color discipline               | 3     | Light and dark captures retain neutral surfaces and semantic status color. Fresh browser checks confirm the active Save draft text contrast is at least 4.5:1 in both themes.                                                                                                                 |
| 6. Motion & feedback              | 3     | Shared controls provide visible focus; keyboard Tab reaches the next named field. With reduced motion enabled, a failed save shows application-owned feedback, retains the draft, and permits retry.                                                                                          |
| 7. States completeness            | 3     | Base templates make the library useful before custom publications. Four kinds save/reopen privately and publish. Regression coverage exercises denied writes and lost permissions; live 503 recovery retains edits and successfully retries. Long-document and dirty-dismissal journeys pass. |
| 8. Detail craft                   | 3     | Narrow project identity and editor frames retain inset text and aligned controls. Standard capture checks report no horizontal overflow at 320px; the short-phone primary save target measures at least 40px in each dimension.                                                               |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

Accessibility evidence covers named controls, keyboard field movement, visible shared focus
styles, primary-action contrast, phone touch size, and reduced-motion operation. It is a focused
review of the changed flows, not a claim that every unrelated application control was audited.

## Findings and corrections

1. The authoring-policy group originally displaced useful templates below the short-phone fold.
   Moved it below the four kind groups and repeated all eight library captures.
2. A cold development route could receive the Display click before hydration. The browser
   acceptance test now uses the existing bounded retry pattern; the final Event journey passes.
   No product behavior changed for that test correction.

Verdict: SHIP for the reviewed local identity interface. Blueprint authoring, generated-tree update
previews, Program schedules, gallery installation, and production verification remain separate
milestones. The short-phone editor intentionally scrolls; Save draft remains reachable after the
starting document rather than floating over editable content.

# Design review: Work resources — 2026-10-26

Register: authenticated app, calm Plex/MD3. People retrieve and manage the context an agent leaves
with a task, project, program or initiative. The canonical resource panel is shared across all four.

Screenshots are retained privately under
`/Volumes/WillieDrive/CodexScratch/docket-mcp-library-writes/shots/`.
The final shared presentation is `resources-final-{1440x900,390x844}-{light,dark}.png`;
`resources-error-simulation-*` records a controlled failed read, and `resources-text-zoom-*` records
200% root text with a long filename. Earlier `task-resources-*`, `project-resources-*`,
`program-resources-*` and `initiative-resources-*` establish route placement in both themes;
`resources-empty-*`, `resources-add-link-*` and `resources-loading-simulation-*` cover the other
states. Their early file metadata included a repeated filename, removed in the final shared panel.
Loading and failure simulations establish presentation only. All records are labeled acceptance
fixtures, created through authenticated local APIs and removed by resetting the disposable database.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                            |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Final panels retain Plex, neutral tinted surfaces, Resources navigation and plain “Upload file” copy. The size limit is beside the action.                                                                                          |
| 2. Typographic craft              | 3     | Section heading, file label and subordinate type/size have distinct MD3 roles. Long filenames wrap; at 200% text the decorative glyph yields space to the filename instead of forcing a few clipped characters.                     |
| 3. Spatial rhythm & density       | 3     | File and link rows share aligned text/action columns and the same spacing. A long filename expands its row without pushing removal beyond the pane.                                                                                 |
| 4. Hierarchy & information design | 3     | The list leads to authenticated downloads. Add resource, upload and per-row removal have distinct roles; destructive controls remain subordinate. Programs expose the same Resources destination.                                   |
| 5. Color discipline               | 3     | Final light/dark frames use neutral page/list surfaces, primary action and selected-tab accents. No new decorative palette was introduced.                                                                                          |
| 6. Motion & feedback              | 3     | Uploading changes the button label and disables competing writes. The shared mutation notice presents failure once and retries the original variables. Keyboard and reduced-motion browser passes complete the actual file journey. |
| 7. States completeness            | 3     | Empty copy explains the collection, loading names the region, read failure offers classified recovery, and a failed upload can retry without losing its bytes or identity. A failed read no longer claims the collection is empty.  |
| 8. Detail craft                   | 3     | Final phone/200% captures show wrapped labels and reachable controls. Oversized mastheads scroll away, reserving at least half the pane before sticking. Download links, upload and removal retain meaningful names.                |

Gates: A11y pass · Responsive pass · Theme parity pass · No placeholder pass · Screenshots pass.

Axe reported no WCAG A/AA violations in the resource regions for all four work types in both themes.
Keyboard upload, byte-for-byte download and removal passed with reduced motion. The standard capture
harness found no document overflow at 320px. The final enlarged-text browser pass clicked the actual
upload control; screenshots show the resource region rather than an occluding header. Removal and
upload controls retain the shared touch/focus treatment. These are local Chromium results, not a
claim about every assistive technology or a hosted deployment.

## Findings resolved

1. File selection needed a real keyboard-operable button, rather than a styled label.
2. A failed load appeared alongside “No resources yet”; structured read recovery now replaces that
   empty state. Write failures use the existing mutation notice once.
3. A tall sticky masthead obscured content at enlarged text sizes. Geometry now permits it to scroll
   away, and it becomes sticky again only while leaving adequate content space.
4. Filenames became indistinguishable when truncated at enlarged text size. Titles now wrap, repeated
   filename metadata is omitted, and decorative glyphs yield space in constrained containers.

Verdict: SHIP for the locally verified Resources experience. Production rollout and live MCP
acceptance are separate release work.

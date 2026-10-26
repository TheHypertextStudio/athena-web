# Design review: MCP work graph — 2026-10-26

Register: host-themed Docket app. The resource inherits the MCP host's palette and font; it does
not load a second application shell or brand font. This review covers the production resource in
the local sandbox acceptance host with explicitly synthetic work, not a hosted connector.

Screenshots: `/Volumes/WillieDrive/CodexScratch/docket-mcp-graph-craft/captures/`.
The 30 captures include inline, expanded overview, selected expanded, search results, and search reveal at
390×844 and 1440×900 in both themes, plus empty, completed, disconnected, oversized and long-title
states in both themes. `results.json` records the width/theme accessibility and overflow results.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | `inline-390-light.png`: work/status language, quiet surfaces, scope totals and one Explore action. State glyphs retain Docket semantics inside the host theme.                                                                                                                    |
| 2. Typographic craft              | 3     | `expanded-1440-light.png`: structural headings, 14px host-token work titles and subordinate status text remain readable at the initial scale. Counts use tabular figures. `longtitles-dark.png` bounds titles without hiding their full accessible text or inspector destination. |
| 3. Spatial rhythm & density       | 3     | `inline-390-light.png`: two connected work rows and their completed prerequisite summary fit below 480px. Secondary controls are disclosed. Expanded view uses the host height; map and inspector share aligned edges.                                                            |
| 4. Hierarchy & information design | 3     | `search-reveal-1440-light.png`: the match is centered, selected and named in the adjacent inspector while its incoming/outgoing context remains visible. Containment has dashed bounds; dependency arrows remain separate.                                                        |
| 5. Interaction & affordance       | 3     | Group disclosures are direct labeled buttons. The browser journey verifies keyboard selection/search, focus after group toggles, explicit Ask, contextual off-view links, relationship list, refresh and Back. Fit all is explicit; initial framing keeps labels readable.        |
| 6. Motion & feedback              | 3     | Reads retain the current content and display a loading notice; search acknowledges input immediately before its debounced read. Framing/selection do not animate. The matrix runs with reduced motion and retains all interactions.                                               |
| 7. States completeness            | 3     | `empty-light.png` offers the existing Docket destination. Completed work remains searchable; oversized results reveal work beyond the loaded page. Failed refresh retains content and retry. Search races and late neighborhood responses cannot replace newer navigation.        |
| 8. Detail craft                   | 3     | `expanded-390-dark.png` docks the scrollable inspector below readable selected work; map controls remain above it. Focus rings, scoped borders, title clamping and 40px mobile search/buttons preserve precision in both themes.                                                  |

Gates: A11y PASS (zero axe violations for the map, search results and relationship list across the width/theme matrix, keyboard journeys and visible
focus; mobile controls/search checked) · Responsive PASS (320px overflow check plus narrow/wide
captures) · Theme parity PASS · No placeholder PASS (synthetic data is confined to the documented
acceptance harness) · Screenshot-verified PASS.

The extended browser verifier completed after capacity became available. Map, search-popup and
relationship-list axe checks pass in both widths and themes. All thirty captures and the search,
framing, paging, inline-only host, refresh and Back regressions pass.

## Findings resolved

1. The initial miniature inline canvas consumed space without improving comprehension. It is now
   a compact connected strip; only saved dependencies receive an arrow/Blocks label.
2. Expanded framing previously shrank labels and left the map at a fixed height. The host allocation
   now frames the workspace; readable framing and Fit all have different, explicit purposes.
3. Search previously dimmed loaded nodes. It now queries authorized scope work, reveals completed
   or collapsed matches and frames the selection, including work beyond the first 100-child page.
4. Long dependency labels repeated whole titles. Adjacent dependencies now use a short Blocks
   connector; other labels and titles are bounded, with full text retained for inspection.
5. Independent source review found stale Back rollback, inline expansion without explorer mode,
   and lost group-toggle focus. Focused browser regressions cover all three corrections.

Verdict: SHIP for the local implementation. Main integration remains blocked by unrelated changes
in the shared main checkout. The connected tool catalog does not expose `view_work_graph` in this
session; hosted discovery, display negotiation and rendering remain separate acceptance work.

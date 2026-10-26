# Design review: work graph orientation — 2026-10-26

> Superseded for mobile hierarchy and framing by the [workspace review](2026-10-26-mcp-work-graph-workspace.md). User review exposed weaknesses that this scorecard graded too generously. Its data/provenance evidence remains applicable.

Register: host-themed Docket app. This is a review of the production resource in the local sandbox
with synthetic work. Hosted connector availability and launch acceptance remain separate.

Evidence root: `/Volumes/WillieDrive/CodexScratch/docket-mcp-graph-orientation/captures/`.
The standard matrix captures 390×844 and 1440×900 in light and dark, with inline cards cropped to
their actual content. Expanded overview, selection, search results, revealed match and restored view
are captured, plus empty, completed, disconnected, oversized and long-title cases (34 captures).

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                             |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Canonical project folders and program layers replace repeated type words. Work titles, workflow marks and original relationships carry the content. No forecast or readiness claim is introduced.                                                    |
| 2. Typographic craft              | 3     | `search-reveal-1440-dark.png`: title, status and parent context have distinct emphasis. Work cards no longer devote a line to Task; full text remains accessible when clamped.                                                                       |
| 3. Spatial rhythm & density       | 3     | `inline-390-light.png` remains a compact connected answer. Expanded cards use the space reclaimed from type labels. Narrow inspectors reduce duplicate header context to expose relationship content.                                                |
| 4. Hierarchy & information design | 3     | `search-reveal-1440-light.png`: Export member records appears once under Prerequisites, with Membership as context. Project headers show displayed/total children. Breadcrumbs preserve orientation when a group extends outside the viewport.       |
| 5. Interaction & affordance       | 3     | Previous view restores groups, completion and exact framing. Match controls cross search pages; Focus and Fit all have different purposes. Offscreen connections are named outside the canvas, avoiding title obstruction.                           |
| 6. Motion & feedback              | 3     | Framing stays readable without animation; query and graph reads retain content and show feedback. Superseded results cannot override a new selection, close or Back action. Reduced motion remains fully usable.                                     |
| 7. States completeness            | 3     | Existing empty/completed/disconnected/large/long-title captures remain in the matrix. Interrupted reads, failed refresh, display-mode changes and bounded deep ancestor context have explicit behavior and regression coverage.                      |
| 8. Detail craft                   | 3     | Canonical icons share the host's type/color system. Projects use a header band and enclosure; individual work uses neutral cards with state marks. Phone context wraps instead of collapsing to unreadable fragments; links stay outside the canvas. |

## Findings resolved

1. A collapsed project arrow and its original endpoint appeared as two prerequisites. Inspector
   provenance now comes from the authorized semantic graph, with saved project dependencies explicit.
2. Repeated Task labels added little meaning. Titles and workflow marks now identify work; folder
   glyphs, enclosing outlines and header bands identify projects.
3. Search could leave people in expanded groups or Show everything without a route back. A visit
   preserves the prior view; match paging keeps that same return destination.
4. Floating offscreen labels covered selectable work on narrow layouts. Named connections now sit
   in a horizontally reachable strip below the map.
5. Source review found stale navigation overriding newer selections and unbounded ancestor output.
   Regression cases first failed, then passed after cancellation and explicit bounded/truncated paths.
6. A display-mode regression replayed a cached fullscreen scene into inline rows. A failing browser
   case drove mode-aware reprojection during restoration.

Gates: A11y PASS (map, search-popup and relationship-list axe checks; keyboard selection,
match paging, Back, close, and 40px mobile controls) · Responsive PASS (320px overflow plus narrow/wide
captures) · Theme parity PASS · No placeholder PASS (synthetic data is confined to the acceptance
harness) · Screenshot-verified PASS.

Validation: 26 focused data/MCP tests, API typecheck, affected-source lint, complexity ratchet and
API production build pass. Browser journeys additionally cover interrupted query/selection/close,
restoration across display modes, paging, failed refresh and embedded Back. Review findings have
red-to-green regressions. Proof is retained under the evidence root; screenshots establish local
rendering, not hosted connector acceptance.

Verdict: SHIP for the local implementation. Main integration still awaits resolution of unrelated
changes in the primary checkout. No deployment or hosted launch acceptance is claimed.

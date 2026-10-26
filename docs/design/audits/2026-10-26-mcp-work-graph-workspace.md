# Design review: work graph workspace — 2026-10-26

Register: host-themed Docket app. Review of the actual production resource rendered by the existing
local sandbox host with synthetic work, not a deployed connector. This supersedes the mobile
hierarchy/framing verdict in the earlier orientation review. That review graded the stacked header
and permanent footer too generously; interaction checks did not establish good information design.

Evidence root: `/Volumes/WillieDrive/CodexScratch/docket-mcp-graph-workspace/captures/`.
Standard views: 390×844 and 1440×900, both themes. Each has inline, initial expanded, selected,
full-details, search results, revealed result and restored view captures. Additional captures cover
empty, completed, disconnected, oversized and long-title states in both themes, plus fixed host
resizing, safe areas and rejected fullscreen (43 captures, including search loading and recoverable refresh failure).

## Assessment

Before this pass, spatial rhythm and hierarchy both scored 2: repeated scope/breadcrumb/control
rows occupied the top of the phone, secondary controls competed with work, and a permanent strip
mixed counts with links. The canvas/inspector arrangement depended on window media queries even
when the host constrained only the app container.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | `inline-390-light.png`, `details-390-light.png`: titles and saved workflow marks identify work; folders/enclosures identify projects. Open graph, Show details, Needs first, Ask in chat and Open in Docket name useful effects/destinations. No repeated Task heading or graph jargon.                                                  |
| 2. Typographic craft              | 3     | `expanded-390-light.png`: structural scope title, subordinate Dependencies/remaining line, and search form one header. Selected title, parent/status, dependency status and action have distinct emphasis. Host fonts/tokens remain authoritative for native MCP fit. Long scope titles clamp with full title available.                 |
| 3. Spatial rhythm & density       | 3     | Mobile header is approximately 112px before safe-area padding. The canvas reaches both edges and all remaining height. A compact selection tray replaces the always-open detail panel; full details remove the peek's extra dependency/action row. The inspector floats on wide canvases.                                                |
| 4. Hierarchy & information design | 3     | `inline-390-light.png` has one primary Open graph action and a compact connected answer. Expanded scope and search stay above the map; options holds secondary controls. `search-reveal-390-light.png` selects and frames the found item while preserving Back and surrounding dependencies. Routine counts no longer occupy the bottom. |
| 5. Color discipline               | 3     | `expanded-390-dark.png`, `search-reveal-1440-dark.png`: neutral host surfaces distinguish project bands, work and inspector. Color belongs to status, selection and highlighted saved dependencies. Both themes retain readable text/borders; map/search/list axe scans report no AA violations.                                         |
| 6. Motion & feedback              | 3     | Search/graph reads retain existing content and announce loading. Host resize and path highlighting use no decorative animation; the matrix runs with reduced motion. Held-response journeys prove a newer selection, close or Back wins, and a host resize cannot overwrite an in-flight completion choice.                              |
| 7. States completeness            | 3     | Empty/completed/disconnected/oversized/long-title captures retain purposeful actions and overflow treatment. Paging appears only for a bounded scene. Original off-view endpoints remain in details; options discloses continuing connections. Failed refresh preserves current work and offers Retry in a contained message.            |
| 8. Detail craft                   | 3     | `details-390-light.png` uses icon collapse/close controls in the title row, avoiding an empty action row. Canonical icons and 40px touch controls align with the shared runtime. Camera framing excludes actual inspector/controls/safe-area bounds while the canvas itself remains full width. No horizontal overflow at 320px.         |

## Host contract and interaction evidence

- The harness supplies standard `displayMode`, `availableDisplayModes`, `containerDimensions` and
  `safeAreaInsets`. The actual expansion result is honored, including a host advertising fullscreen
  but returning inline. These fields belong to the MCP Apps standard, not a vendor-only extension.
- A 390px flexible inline cap inside a 1440px host becomes a 1440px fullscreen canvas. New dimension
  objects clear old fixed/max constraints on both axes. Theme-only updates retain dimensions/insets.
- Same-shape fullscreen width/height updates resize locally without another geometry request.
  Fallback explorers grow and shrink on same-shape height updates too, and fill an explicitly fixed height. Container queries respond to
  the actual app width, including constrained inline apps in wide browser windows.
- A held completion-filter request plus a breakpoint resize preserves the chosen filter in the
  subsequent geometry request. Search restoration includes details state as well as filters,
  expanded groups, selection, highlighting and the camera.
- Keyboard search selection, result paging, project expansion, relationship-list selection,
  selection/close/Back races, embedded Back and failed refresh are exercised by the same verifier.

Gates: A11y PASS (map, search-popup and relationship-list axe scans, keyboard journeys, focus and
40px mobile controls) · Responsive PASS (320px overflow, 390px and 1440px captures, constrained host)
· Theme parity PASS · No placeholder PASS (synthetic data belongs only to the named acceptance
harness and is identified as demo evidence) · Screenshot-verified PASS.

Verdict: SHIP for this local interface revision. No claim of deployed availability, real connector
acceptance, or completed launch review. Host implementations can differ; that acceptance remains
separate from the local standardized protocol evidence.

# Work graph craft implementation plan

## Intent

Inline is a compact answer about a connected piece of remaining work. Expanded is a readable workspace for investigating dependencies, grouped work and completion history. The user approved this direction and specifically prioritized density, framing and navigable search, with craft a completion requirement.

## Implementation

1. Add bounded search of the authorized graph scope, independent of display pagination and collapsed/completion state. Return matching work with context. Selecting a match reveals its ancestors, includes it on the visible page and preserves the selected scope. Add actual completed-branch and off-view connection metadata for contextual navigation; never infer readiness from missing visible edges.
2. Render a compact connected strip inline, with accurate status, history attached to its real branch, one primary Explore action and secondary view options. Use a viewport-filling expanded canvas with readable framing, explicit overview, stable zoom/pan, direct group disclosures and a docked or phone detail panel.
3. Make search keyboard-accessible, debounced and safe against stale responses; bring selected results into view at readable scale. Retain focus/selection and camera intent through refresh, resizing, collapse/expand and Back. Simplify inspector sections and make completed/unloaded prerequisites actionable.
4. Verify behavior and the complete rendered experience in both themes and relevant widths/states. Run affected types/lint/build/tests under the required capacity guard, record evidence, review and commit. Preserve unrelated main changes; no PRs or deployment claims.

## Constraints and rulings

- Keep the existing MCP tool, resource, runtime and permission boundary; no new dependencies, mutations, stored preferences, schema migrations or host-specific SDK.
- Search is scoped to currently authorized saved work, includes ended work, and uses bounded pages of 20 results. Picking ended work reveals it explicitly; searching alone does not change completion display.
- Initial framing favors readable work, while Fit all is an explicit overview action. Inline shows at most three connected work nodes, two on narrow hosts.
- Local rendered acceptance and hosted connector availability remain separate.

# Design review: Canvas graphs — 2026-08-24

This review is for maintainers deciding whether to release canvas editing for Project
Dependencies and Task graph. The review covers the 363-Task and 28-dependency fixture, the
36-Project dependency fixture, context creation, selection, bulk properties, trash confirmation,
undo and redo, and creation continuity. The screenshots are in
`screenshots/2026-08-24-canvas-graphs/`.

| Dimension                           | Score | Evidence                                                                                                                                                                                                                                     |
| ----------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | The graph uses Docket's quiet MD3 surfaces, blue relation edges, semantic status and health marks, and plain action labels. Context menus call deletion “Move to trash” and explain restoration.                                             |
| 2. Typographic craft                |     3 | Node titles remain readable at the 0.5 initial zoom. Menus, floating bars, composers, confirmations, and bulk properties use shared semantic type roles without canvas-specific font rules.                                                  |
| 3. Spatial rhythm and density       |     4 | Connected components lay out independently and pack to the viewport. The 363-Task fixture opens as two to five readable columns across 390px, 1024px, and 1440px instead of one unbounded column.                                            |
| 4. Hierarchy and information design |     4 | The empty-pane menu owns creation and viewport tools. Selection owns Properties and trash. Node menus own object actions. One bottom navigation row now keeps zoom, Fit selection, Re-layout, and the minimap from occupying the same space. |
| 5. Color discipline                 |     3 | Light and dark captures preserve the same hierarchy. Nodes, selection, focus, edges, menu state layers, and destructive confirmation use semantic theme roles with no raw canvas color overrides.                                            |
| 6. Motion and feedback              |     3 | Area selection leaves a persistent count bar. Commands keep selection visible, report results, and enter local undo history. Fit selection and deterministic re-layout animate without changing data.                                        |
| 7. States completeness              |     4 | The review covers read-only disabled commands, mixed bulk values, picker hover and selection, creation over the mounted graph, hidden-by-filter handling, multi-item trash confirmation, undo, and redo.                                     |
| 8. Detail craft                     |     4 | The priority picker's first hover layer stays inside its rounded shell. Composer close restores canvas focus. The 320px Project tabs retain distinct hit targets, and both graph routes have zero page overflow.                             |

Gates: A11y PASS · Responsive implementation PASS · Theme parity PASS · No placeholder PASS ·
Post-correction screenshot PENDING

The screenshot matrix covers 1440×900, 1024×768, and 390×844 in light and dark for both graph
types. The 320×720 pass measured
`document.scrollWidth === document.clientWidth === 320` on both routes. Context menus measured
224px wide and stayed inside the 390px viewport. Both composers measured 358px wide from x=16 to
x=374 and kept the graph mounted behind them. The live 363-Task diagnostics completed layout in
10.1–18.7ms, below the 100ms release budget.

The live keyboard and interaction pass selected two Tasks and two Projects through the one-shot
area tool. It applied a mixed-value bulk change, preserved the selection across query refresh, and
kept Fit selection enabled. Command-Z inside the Properties dialog did nothing. Command-Z on the
canvas restored the prior value, and Command-Shift-Z reapplied it. Escape cleared selection. The
multi-Task and multi-Project confirmations reported the object counts and stated that graph links
remain available for restoration. The browser console reported no warnings or errors.

The current executable review passes 163 Canvas behaviors across 37 Web files. It includes the
363-Task fixture, the 36-Project fixture, readable initial framing, selection, properties, trash,
history, minimap retention, and creation continuity. The database-backed review passes 282 tests
across 13 API files for atomic commands, permissions, replay conflicts, archived reads, and
relationship restoration. The object-command contract passes 17 tests. Web type checking, the
139.6-second bounded repository lint, formatting, and the direct Web production build all pass.
The production CSS also proves the corrected narrow-width geometry: a 320px canvas leaves 290px
inside the dock insets, while zoom, mobile viewport actions, minimap, and gaps consume 266px. The
row therefore keeps 24px of free space at 320px and 94px at 390px.

## Findings

1. Resolved: property-only Task updates changed database response order, which changed Dagre's
   stable tie-breaker and moved nodes. The dependency projection now sorts nodes and edges by id.
2. Resolved: controlled graph refreshes replaced selected nodes with unselected query results. The
   flow controller now preserves selected ids while applying new data and geometry.
3. Resolved: Fit selection read a selection callback that could miss controlled-store refreshes.
   The toolbar now reads selected nodes from the React Flow store.
4. Resolved: a disappearing pane-menu trigger could leave focus on `body` after Project creation
   closed. The retained work-view host now receives the canvas focus target, and the provider
   retries focus only when no other connected control has claimed it.
5. Resolved: the 320px Project view buttons shrank into overlapping hit targets. The tabs now keep
   their shapes and use the visible label “All” below 640px while retaining the accessible name
   “All projects.” The before-state evidence is `project-tabs-320-before.png`.
6. Verified: the picker applies hover, focus, and selection to one inset row shape. The top state
   layer no longer exposes a second rectangle inside the rounded popover shell.
7. Resolved after the screenshot review: the minimap, zoom controls, and viewport toolbar each
   used independent absolute positions. At 390px, the minimap sat under the toolbar and became a
   thin strip. The canvas now lays out those controls in one responsive bottom row. Mobile keeps
   both viewport actions as named icon buttons, while wider screens retain their visible labels.
   Notices and the Ready panel sit above that row. The saved 390px images are the before-state
   evidence for this correction, so the post-correction visual pass remains open.

The browser automation layer did not preserve Shift during a low-level drag, so that attempt
panned the canvas and cannot support a product conclusion. The component contract covers
Shift-drag selection, while the same live marquee path passed through the keyboard-accessible
one-shot Select area command.

Verdict: HOLD for one post-correction visual pass. Every code and interaction gate passes, but the
saved 390px screenshots predate the bottom navigation correction.

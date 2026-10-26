# Work dependency graph MCP App

`view_work_graph` answers questions about remaining work and recorded dependencies. The same
read-only explorer opens from task/project details, program/initiative details, and task lists
explicitly scoped to one project. Existing cards render the graph themselves and offer Back;
a nested tool call does not depend on the host switching to another resource.

## Contract and meaning

Call with `orgId` and `scope: { kind, id }`, where kind is task, project, program or initiative.
Optional `focus` identifies a canonical `kind:id` key. `completion` is `collapsed` (default), `all`
or `remaining`; `expanded` contains group keys. `display` is inline or fullscreen, and `viewport`
is portrait, square or landscape. Task neighborhoods accept depth 1–5, default 2.

The structured snapshot contains saved work identities, canonical status names/categories, saved
dependency edges, distinct containment/contribution links, authorized totals, snapshot time,
scene geometry and continuation information. Dependency direction is blocker → blocked.
Aggregated task dependencies between collapsed groups are labeled separately from saved project
dependencies. Expanding the groups reveals the actual endpoints.

Canonical status foreign keys determine completion across customized workflows. Canceled work
has its own count and does not count as completed. Task counts include each scoped task once,
including subtasks. In a scope without tasks, totals describe its contained work. External direct
dependency endpoints provide context and do not contribute to the selected scope's totals.
These are current saved states, not historical completion receipts or forecasts.

Access is checked live for every read. Canonical task visibility and batched resource access run
before projection, summaries or serialization. Denied and archived work and its relationships are
absent. No hidden-object identities, titles, existence counts or readiness verdicts are returned.
Only recorded, visible dependencies are available; absence of an arrow is not proof work can start.

## Presentation and navigation

Inline shows up to three work nodes (two in portrait), preferring a connected slice around focused
or started work. Completed branches have expandable summaries. The map explicitly distinguishes
its displayed scene from authorized scope totals and records connections continuing beyond it.
Inline uses readable work rows with the scope totals and one Open graph action; actual completed
prerequisites attach to their dependent work. Secondary view controls are disclosed on demand.
Expanded views use the full available canvas and frame readable work by default. Zoom to fit offers
an explicit overview. A contained header groups scope, remaining count and search; Graph options
holds completion display, list view, refresh, the Docket destination and detailed counts. A floating
inspector overlays the canvas on wide hosts. Narrow hosts show a compact selection tray containing
title, parent, status and the first dependency's status; Show details opens the full inspector.
Routine counts and offscreen-link strips do not occupy the bottom of the map. A continuation control
appears only for a bounded scene; group headers show displayed children versus their authorized total.

`search` (up to 160 characters) searches all authorized work in the selected scope, independently
of collapsed groups, completion display and scene pagination. All query terms match title or ID,
case-insensitively. `searchOffset` pages twenty stable title/identity-ordered results. The snapshot's
`search` includes total, offset, continuation and ancestor context for each match. Selecting a result
reveals its ancestors, returns it on the first scene page and frames it at readable scale. Ended
work is explicitly included when chosen. Typing and selecting never start a conversation turn.

`completedBranches` names real completed prerequisite chains attached to displayed work. Boundary
counts retain every authorized off-view connection; each boundary names at most twenty endpoints
for direct reveal, with narrower-scope navigation for further exploration. These counts never imply readiness.

Fullscreen can highlight prerequisite and downstream connections. Inspector actions say Highlight
and Clear highlights; a Highlight action is offered only when a displayed connection exists. An equivalent relationship list supports keyboard and assistive navigation.

Inspector `details` carry original relationship endpoints for each displayed identity, with separate
incoming/outgoing totals and at most ten items per side. Collapsed visual arrows are not added as
extra prerequisites. Saved project dependencies retain their kind; task dependencies summarized at
a group retain the contained endpoint in `via`. Breadcrumbs contain at most ten nearest ancestors;
`trailTruncated` explicitly discloses omitted earlier groups. All fields use the authorized semantic
reader, including hidden-by-display endpoints; no filtered scene is treated as a readiness verdict.

Project cards and group headers use the canonical folder glyph, an enclosing outline and a header
band. Individual work cards rely on their title and workflow status instead of a repeated Task
label. Canonical icons identify navigation, relationship direction, conversation and destination
actions. Expanded group headers distinguish displayed children from authorized child totals.

Show selection frames the selected item and nearby connected work when it fits. The canvas fills
the host width, including the space beneath the floating inspector; automatic framing accounts for
inspector, map controls, continuation controls and safe areas so the selected item stays visible.
Original connections beyond the displayed scene remain reachable through inspector links labeled
Show on graph. View details selects an endpoint already displayed. The options panel discloses
when connections continue outside the scene.

Search visits offer Back to previous view, restoring expansion, completion, selected work,
expanded details, highlighting and the prior camera. The restoration reprojects through the authorized reader when the host display mode
or coarse viewport changed; it never replays a large fullscreen scene as inline rows. Previous/next
result controls traverse result pages while retaining the original return destination. Explicit
selection, close, a new query and Back invalidate superseded navigation. Selection and restored
selection update model context without sending a conversation message.

Structural changes call the same read-only tool through the existing MCP bridge. Geometry uses
shared React-independent Dagre layout. Selection, highlighting and viewport gestures stay local;
stale reads cannot replace newer results. Reads retain the previous view on failure and offer Retry. Refresh
returns a new snapshot; there is no claim that this is a live subscription.

`focusFilter` accepts the existing task `list_work` filters. It highlights matching work while
retaining dependency context, rather than building a graph from a paginated list. `focusKeys`
can highlight an explicit bounded set. These are presentation annotations, not scope changes.

The `ui://docket/work-graph` resource is self-contained HTML under the existing CSP and theme
runtime. Fullscreen negotiation checks available display modes and respects the actual response.
Hosts declining fullscreen retain an inline explorer sized within their advertised height limit.
Display mode, available modes, independent fixed/flexible/unbounded dimension axes and safe area
insets follow the [MCP Apps standard](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).
A new dimension object clears obsolete constraints on both axes. Theme-only updates preserve prior
dimensions and safe areas. The shared runtime exposes merged host-context updates; graph layout
observes these and the actual body size. CSS container queries choose the compact or wide inspector.
Same-shape resizing adjusts framing locally; structural display/shape changes request new geometry.
A pending user read settles before a resize read so the latter preserves its filter/expansion/scope.
Explicitly fixed inline height is filled; flexible inline height uses up to 720px within the host cap.
Inline explorer height also reacts to host-context changes without requiring a new graph snapshot. Selection can update model context for a
future turn; only an explicit Ask in chat action sends a user message. Host support varies.

## Validation and operation

Projection tests exercise scope totals, external context, completed/canceled work, collapsed
aggregation, compact selection and bounded scenes. MCP transport tests exercise real authorization,
cross-workspace isolation, revocation, grouping and resource metadata. The browser verifier renders
the production resource with named synthetic data through a sandbox host, calls the real projection,
and exercises interaction, accessibility and display negotiation.

Run affected checks through the repository's required `disk-janitor guard`. The browser command is
`GRAPH_CAPTURE_DIR=<owned guarded output> pnpm exec tsx scripts/verify-work-graph-app.mjs`.
It starts and tears down an ephemeral loopback host and a fresh headless browser; it uses no
personal browser session, live workspace, credential, or production data. Its screenshots prove
local rendering and protocol interactions. Real connector discovery/rendering is a separate
acceptance check; local harness results do not establish hosted availability.

No schema migration or new OAuth scope is required. The tool requires `work:read`. No graph control
changes saved work, creates groups, edits dependencies, or starts an agent session.

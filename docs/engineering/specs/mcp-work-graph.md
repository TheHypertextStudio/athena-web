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

Inline shows up to six work nodes (two in portrait), preferring a connected slice around focused
or started work. Completed branches have expandable summaries. The map explicitly distinguishes
its displayed scene from authorized scope totals and records connections continuing beyond it.
Fullscreen supports nested groups, pan, zoom, fit, search, inspectors and prerequisite/downstream
tracing. An equivalent relationship list supports keyboard and assistive navigation.

Structural changes call the same read-only tool through the existing MCP bridge. Geometry uses
shared React-independent Dagre layout. Selection, highlighting and viewport gestures stay local;
stale reads cannot replace newer results. Reads retain the previous view on failure. Refresh
returns a new snapshot; there is no claim that this is a live subscription.

`focusFilter` accepts the existing task `list_work` filters. It highlights matching work while
retaining dependency context, rather than building a graph from a paginated list. `focusKeys`
can highlight an explicit bounded set. These are presentation annotations, not scope changes.

The `ui://docket/work-graph` resource is self-contained HTML under the existing CSP and theme
runtime. Fullscreen negotiation checks available display modes and respects the actual response.
Hosts declining fullscreen retain an inline explorer. Selection can update model context for a
future turn; only an explicit Ask about this action sends a user message. Host support varies.

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

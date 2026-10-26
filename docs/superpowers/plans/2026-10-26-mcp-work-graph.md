# MCP work graph implementation plan

## Goal and design

Implement the approved read-only dependency graph: a six-node inline slice and an expanded spatial explorer for task neighborhoods, projects, programs and initiatives. Completed work collapses by default; canceled work remains distinct. Saved containment and contributions never imply blocking. Visible external blockers are context, excluded from scope totals. Shared work renders and counts once.

## Delivery

1. Authorized graph reader and `view_work_graph` tool: canonical status categories, live resource access, graph scope traversal, summary counts, boundary markers, 100-child pages and 200-node expanded scenes. Validate through projection tests and the real MCP transport.
2. Shared layout and MCP app: extract React-independent Dagre geometry; accessible DOM nodes/SVG edges, collapsed completed work, nested containers, pan/zoom/fit/search, inspector, prerequisite/downstream tracing, explicit conversational action, stale-response recovery and host-mode negotiation.
3. Existing-card integration and acceptance: shared embedded renderer with Back, task/project/program/initiative actions and project-scoped list action retaining filter focus. Document usage; validate affected types/lint/build/tests and rendered narrow/wide light/dark states. Review the whole change before linear integration; no pull requests.

## Defaults and boundaries

Read-only `work:read`; no database migration, new grouping editor, dependency edits, forecast dates or critical-path claims. Inline chooses selected work and immediate neighbors, otherwise started work, open prerequisites, then unblocked work, with priority/title/id ties. Expanded geometry uses mode and coarse viewport shape; pan/zoom stay local. Retain selection and navigation during refresh and mode changes. Permission filtering precedes all output and totals; partial subgraphs never establish readiness.

## Progress and rulings

- Setup: existing clean managed worktree, branch `codex/mcp-work-graph`.
- Ruling: use canonical `work_status` foreign keys for categories across all four work kinds rather than legacy team JSON, because persisted status IDs are authoritative.

- Source implementation and independent whole-change review are complete. Review corrections cover container access, focused completion, ancestor-retaining paging and accessible relations/focus.
- Verified: 145 API/MCP tests, 21 web layout tests, 681 shared-work tests with passing coverage, API/web production builds, affected typechecks/lint, clean complexity ratchet, and sixteen populated and edge-state browser captures with keyboard/protocol/accessibility checks.
- Ruling: use two connected work nodes in portrait inline views to keep the relationship readable; up to six remain available at wider widths.
- Ruling: preserve existing shared-main changes and keep this delivery on its isolated branch until integration is safe.
- Remaining acceptance: main integration and hosted connector acceptance. The shared main checkout contains unrelated uncommitted work; local verification does not establish hosted connector acceptance.

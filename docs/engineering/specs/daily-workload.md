# Daily workload MCP App

Read-only, authenticated personal workload within an explicitly
selected workspace. Existing MCP App runtime, theme tokens, shell, and native form controls are the
embedded component system; importing the Next.js provider-bound React app would be inappropriate.

## Calculation contract (before implementation)

- Day is a local calendar date in an explicit IANA timezone. Clip intervals to local midnight → next
  midnight (including 23/25-hour DST days); actuals stop at server `asOf`, never a client clock.
- Scope is the caller's own human work in the selected workspace. No arbitrary actor/user input.
  Organization scope plus live task/project visibility apply before titles or aggregates leave the server.
  Agents do not own a personal ledger and receive an honest unsupported identity error.
- Assigned work for the day means assigned tasks starting or due that day, plus retained items
  on the caller's daily plan. Undated backlog is not quietly scheduled for today. Completed tasks also contribute to the full-day commitment. Past days use retained plans and
  current task metadata; this is not a versioned historical estimate snapshot.
- Date-only assignment dates are compared by their stored calendar date, independently of the
  timezone used to clip timed intervals. Accepted plans use all canonical task allocations, including
  split and shared sessions; legacy timeboxes are the fallback before acceptance.
- One task appears once. Known planned minutes are the larger of its explicit estimate and union of
  its day-clipped timeboxes. Missing estimate without a timebox remains unknown. No default estimate.
- Actual work is the union of non-superseded human-active intervals in this workspace, including running
  timers only through `asOf`. During overlap, divide the overlapping slice equally among distinct tasks.
  This deterministic attribution makes every chart sum to the same union without inventing effort.
- Scheduled minutes are the union of daily-plan timeboxes. Remaining scheduled minutes are only their
  future intersection with the day. Gross overlap is reported separately; estimates are never added to
  their own timeboxes. Due dates alone are candidacy, not timeboxes.
- Daily available hours are a user-selected budget, initially 8h, visibly editable from 0–24h. It is
  a view assumption, not a persisted availability change or inferred productivity goal. Both expected
  utilization and tracked utilization divide by this SAME FULL-DAY budget. No elapsed-day extrapolation.
  Zero capacity gives null percentages. Percentages can exceed 100%.
- Known remaining work sums max(planned minus attributed actual, 0) per unfinished task. Budget left
  is available minus tracked; forecast headroom is budget minus tracked minus known remaining work.
  Negative headroom is explicit over-allocation. Unknown durations make known demand a lower bound and headroom an upper bound, not
  proof of spare capacity. Missing task estimates are surfaced even when a timebox supplies a known
  day-plan duration; a timebox is not proof of the task’s total effort. Completed work with no ledger time is labeled untracked, not zero effort.
- Track-only tasks appear with zero planned contribution, not a fabricated estimate. Filters by project,
  task, and priority are genuine task schema dimensions. Filtered charts never change the day denominator.
  Other workspaces, meetings, unnamed timers, breaks and unrecorded work are outside this scope; explain
  this where the numbers are used. Remaining budget is not a promise of free calendar slots.

## Interaction and architecture

`view_workload` reads a typed projection and points at `ui://docket/workload` via `_meta.ui.resourceUri`.
Keep the JSON/text fallback. The self-contained app uses the existing JSON-RPC bridge and deny-all CSP. It paints its canvas
with the host primary-background token so text contrast does not depend on a transparent iframe
backdrop.
Date navigation, timezone and capacity changes make read-only tool calls; filters work locally and keep
scope/denominator visible. New reads keep old content while loading, reject stale responses, and provide
retry without losing choices. Snapshot timestamp and explicit Refresh avoid pretending a timer is live.

Tool descriptions and the existing server guidance recommend the view during planning, scheduling,
adding work, and feasibility discussions. Hosts decide whether to render and whether assistants follow
guidance; server metadata does not override host system instructions. No schedules or commitments change.

Official reference checked: https://modelcontextprotocol.io/extensions/apps/overview (2026-10-14).

## Setup and use

No migration, new dependency, provider credential, or setting change is required. Build/start the
existing API through the repository bootstrap workflow and connect its existing OAuth MCP endpoint
with `work:read`, using an authenticated human identity with a Hub and workspace read access.

Call `view_workload` with:

```json
{
  "orgId": "<authorized workspace id>",
  "date": "2026-10-14",
  "timezone": "America/Los_Angeles",
  "availableHours": 8
}
```

The response supplies the structured snapshot plus a text fallback. The tool's `_meta.ui.resourceUri`
references `ui://docket/workload`; `resources/read` serves self-contained HTML with
`text/html;profile=mcp-app`. The existing runtime performs `ui/initialize`, sizing and host-theme
updates. Controls call only `view_workload` through the host's `tools/call` bridge. Native settings
controls use explicit click/Enter handlers because an MCP sandbox need not grant HTML form submission.
No `allow-forms` permission or external network/CSP relaxation is needed.

The `initialize` server instructions, tool description, and optional Docket context prompt recommend
surfacing the view during scheduling, planning, adding work, and feasibility discussions. These are
host-consumable guidance, not a server override of the host's system prompt. A host must negotiate and
render MCP Apps; changing the server alone does not install or enable a connector in an existing chat.

### Reproduce local verification

After normal dependency bootstrap:

```sh
pnpm --filter @docket/api typecheck
pnpm --filter @docket/api build
WORKLOAD_EVIDENCE_DIR=/tmp/docket-workload-evidence pnpm --filter @docket/api exec vitest run \
  tests/workload/calculations.test.ts tests/mcp/mcp-workload.test.ts \
  tests/mcp/mcp-apps.test.ts tests/mcp/mcp-app-runtime.test.ts tests/mcp/mcp-apps-tokens.test.ts
WORKLOAD_EVIDENCE_DIR=/tmp/docket-workload-evidence node apps/api/scripts/verify-workload-app.mjs
```

The MCP tests migrate an isolated in-memory PGlite database and seed named test accounts. The optional
`WORKLOAD_EVIDENCE_DIR` exports their actual resource and responses. Optional `WORKLOAD_CAPTURE_DIR` selects the private capture destination; the default is the ignored
`apps/api/.data/workload-captures` directory. The browser runner opens a fresh
headless browser on an ephemeral loopback host; its sandboxed iframe renders that exact resource and
uses standard MCP messages. It uses no personal browser profile, login cookie, production database,
OS unlock, or external site. The host bridge replays only these test-account responses, so its
screenshots prove the rendered app and protocol behavior locally, not production connector availability.
The real client/server integration tests separately exercise each server read and permission boundary.

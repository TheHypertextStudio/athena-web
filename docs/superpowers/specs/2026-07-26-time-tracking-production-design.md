# Time Tracking Production Build-Out — Design

> **Status**: Approved for planning
> **Date**: 2026-07-26
> **Companions**: `docs/engineering/specs/time-tracking.md` (domain model — Time Ledger, records,
> intervals, contexts, allocations, agent accounting — already implemented and treated as
> authoritative here), `docs/core/specs/layered-calendar.md`, `docs/engineering/specs/calendar-ui.md`,
> `docs/superpowers/specs/2026-06-29-portable-agenda-rail-design.md` (the panel-rail pattern this
> project reuses).

## Context

Docket's Time Ledger domain (records, intervals, contexts, allocations, agent-execution accounting)
already shipped to `main` in commit `d8e08c45` and is fully specified in `time-tracking.md`. A
companion UI build was done in parallel but was parked ahead of a `main` sync (see WORKLOG
`WIP-RECONCILE-001`) and is **unrecoverable** — the git stash object was garbage-collected and the
patch/tarball backups lived in an ephemeral session scratchpad that has since been cleared. This
project rebuilds the UI, adds the MCP surface, adds the analytics/breakdown view, and adds a new
capability that did not exist before: a constrained, cycle-aware auto-scheduler.

Goal: Docket replaces Toggl Track as the one place time is tracked, and closes the loop between what
a person _planned_ (Daily Plan Item, Calendar Item, Cycle) and what they _actually did_ (the Time
Ledger) — exposed identically through the web app, the REST API, and MCP, in keeping with Docket's
"one engine behind every door" principle.

## Scope

Five independently-shippable workstreams, in dependency order:

1. **Backend/MCP extension** — new `SchedulingConstraint` entity, a `TimeCategoryDefault` (Task →
   TimeCategory) link, and a from-scratch MCP tool surface for time tracking and scheduling.
2. **Time panel (UI)** — a shell activity-bar panel (peer to Tasks/Agenda) plus the `/time` page
   (Now / Timeline / Breakdown) specified but never built in `time-tracking.md` §6.4.
3. **Breakdown / analytics (UI)** — the Sunsama-style reflection view: filterable time-by-project/
   workspace/category/actor, human/agent/combined effort, estimate-vs-actual variance.
4. **Constrained auto-scheduler** — a new engine that places unscheduled Tasks into open calendar
   slots within a Cycle window, refusing any placement that would exceed a user-defined weekly-rate
   cap (scoped to an organization, or an organization+category).
5. **End-to-end testing** — Playwright coverage across all of the above.

Workstreams 1–3 have no dependencies on each other. 4 depends on 1 (the constraint entity). 5 depends
on everything.

## 1. Backend / MCP extension

### 1.1 New data model

**`TimeCategoryDefault`** — explicit Task → `TimeCategory` link, user-set only (bulk-assignable from
the Breakdown view), never inferred. An untagged Task still tracks and schedules fine; it counts
toward its organization's cap only, never a category cap.

- `id`, `hubId`, `taskId`, `categoryId`, `createdByUserId`, `createdAt`

**`SchedulingConstraint`** — a Hub-scoped planning guard, not a tracking restriction. You can still
manually track past a cap (the Ledger records reality); the guard only stops the auto-scheduler from
_planning_ a violation.

- `id`, `hubId`, `scopeKind`: `organization | organization_category`
- `organizationId`, `categoryId` (required iff `scopeKind` is `organization_category`)
- `weeklyMinutesCap` — expressed to the user as a weekly rate; scaled to whatever cycle window it's
  evaluated against (see §4.1)
- `createdAt`, `updatedAt`, `archivedAt`

### 1.2 REST additions

Small additions to the existing `/v1/time/*` surface plus a new `/v1/scheduling/*` namespace:

- `PUT /v1/time/categories/:id/tasks/:taskId` / `DELETE …` — set/clear a `TimeCategoryDefault`
- `GET/PUT /v1/orgs/:orgId/scheduling/constraints` — list/upsert `SchedulingConstraint` rows
- `POST /v1/scheduling/plan-cycle` — run the auto-scheduler (see §4)

### 1.3 MCP tools — agent-shaped, not a REST mirror

MCP tools call the same underlying Time/Scheduling service the REST routes call, but their input/
output schemas are chosen independently for tool-calling ergonomics. The existing codebase
convention (`apps/api/src/mcp/task-crud-tools.ts`: `create_task`, `update_task`, `move_task` — one
simply-named tool per verb, never a single dispatch tool with an `action` enum) is the pattern to
follow: small, clearly-named tools, each doing one obvious thing, with a flat input schema, explicit
`outputSchema`, and `annotations`.

| Tool                          | Purpose                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `start_time_tracking`         | Start a live record (title/label, optional category, optional primary context ref). Resumes if the target record was paused.     |
| `pause_time_tracking`         | Pause the active human interval without closing the record.                                                                      |
| `stop_time_tracking`          | Close the active record; optional close-out fields (outcome note, category, allocations).                                        |
| `switch_time_tracking`        | Atomically close the active record and start a new one — the common "I'm switching tasks" action in one call.                    |
| `log_past_time_interval`      | Add a reconstructed interval with an explicit start/end (materially different shape from the live-action tools above).           |
| `get_active_time_tracking`    | Cheap, frequent "what's running right now" check — mirrors `GET /v1/time/active`.                                                |
| `get_time_summary`            | Flexible read with a `groupBy` + date-range parameter, replacing the need to memorize separate timeline/breakdown/summary tools. |
| `list_scheduling_constraints` | List `SchedulingConstraint` rows for an organization.                                                                            |
| `set_scheduling_constraint`   | Create or update one `SchedulingConstraint`.                                                                                     |
| `plan_cycle_schedule`         | Run the auto-scheduler for a cycle; returns `placed`/`overflow`.                                                                 |

New file: `apps/api/src/mcp/time-tools.ts`.

## 2. Time panel (UI)

- **Activity-bar panel**: register a `RailPanel` in `ShellActivityBar`/`ShellAside` (the mechanism
  `agenda-rail.tsx` already uses), showing the live tracker — current record, elapsed time
  (server-clock driven per `time-tracking.md` §5.3, never a client-side counter written back),
  Pause/Switch/Stop, and recent records to resume.
- **`/time` page** — three views per `time-tracking.md` §6.4:
  - **Now**: active tracker + active/queued agent executions
  - **Timeline**: exact intervals, overlaps, handoffs, linked context, repair ("Add past time") actions
  - **Breakdown**: see §3 below

## 3. Breakdown / analytics (UI)

- Filterable aggregation by date range, workspace, project, category, actor, capture source, per
  `time-tracking.md` §6.4.3 and §8.
- Shows Human effort / Agent effort / Combined effort / Elapsed delivery time side by side, each
  labeled — never a single collapsed "productivity" number.
- Estimate-vs-actual variance per task (`time-tracking.md` §8.2).
- Category-tagging affordance: bulk-assign `TimeCategoryDefault` from a filtered task list (e.g.
  "tag all Acme Corp tasks as Deep Work") — this is where a person is already looking at time by
  category, so it's the natural place to set the tags a `SchedulingConstraint` will key off.

## 4. Constrained auto-scheduler

### 4.1 Cycle-aware, not calendar-week-aware

Docket already has a `Cycle` primitive (`domains/work/src/contracts/cycle.ts`): team-scoped, auto-rolling
iteration windows on a configurable cadence (default weekly; `team.cycle_cadence_weeks`), with
`startsAt`/`endsAt` and an `isCurrent` flag. The auto-scheduler plans against a **Cycle window**, not
a hardcoded Monday–Sunday grid:

- A `SchedulingConstraint.weeklyMinutesCap` is scaled to whatever cycle window it's evaluated
  against: `capForWindow = weeklyMinutesCap × (cycleLengthDays / 7)`. A team on a 2-week cadence
  effectively gets 2× the weekly number; a personal weekly cycle uses it as-is.
- The trigger is **"Plan my cycle,"** not "Plan my week." Input is a `cycleId` (defaults to the
  caller's current cycle for a team, or their personal weekly cycle for team-less tasks).
- Committed load for a scope is computed over the cycle's actual `[startsAt, endsAt]`, so mid-cycle
  planning counts only what's left in the window.

### 4.2 Trigger and placement

On-demand only (no background/cron sweep) — a "Plan my cycle" action, placed on the Cycle surface
(`cycle-row.tsx` / cycles page), since that's where a person is already thinking "what goes in this
cycle," not the Time panel.

Algorithm:

1. Resolve the cycle window and every `SchedulingConstraint` in scope (the task's organization, plus
   any `organization_category` constraints for categories the candidate tasks carry).
2. Compute committed load per scope: tracked `human_active` interval minutes already logged in the
   window, plus minutes from existing `task_timebox`/`native_block`/`provider_event` items for the
   remainder of the window. This total updates as the run places more items.
3. Candidate tasks: `estimateMinutes` set, no existing timebox, due date within or before the cycle
   end, sorted by priority then due date.
4. For each candidate, scan open slots (free across every selected calendar layer) in ascending time
   order. Before committing a slot, check every applicable constraint's cap-for-window; skip to the
   next slot, then the next task, if any would be exceeded.
5. Commit via the existing Daily Plan Item CRUD, tagging created rows `createdVia: 'auto_schedule'`
   so a re-run is additive and idempotent — it only ever touches Daily Plan Items it created itself,
   never a manually-placed timebox.

### 4.3 Response contract

```ts
{
  placed: Array<{ taskId; dailyPlanItemId; date; timeboxStartsAt; timeboxEndsAt }>;
  overflow: Array<{
    taskId;
    reason: 'org_cap_exceeded' | 'category_cap_exceeded' | 'no_open_slot';
    constraintId?: string;
  }>;
}
```

The web UI surfaces `placed` items directly in the Agenda/timeline and shows `overflow` as a
dismissible inline summary ("3 tasks didn't fit — would exceed Acme Corp's cap"), each deep-linking
to its task. Nothing is ever silently dropped.

## 5. Testing

Backend/MCP additions (§1) get vitest coverage matching the existing pattern in
`apps/api/tests/time/` and `apps/api/tests/routes/time.test.ts` — new suites for
`SchedulingConstraint` CRUD, `TimeCategoryDefault`, the placement algorithm, and each MCP tool.

Playwright e2e covers the UI surfaces end to end:

- Start/pause/stop/switch through the Time panel, including the server-clock-driven elapsed display
  surviving a reload
- Breakdown view filters and category-tagging bulk assignment
- A full "Plan my cycle" run seeded with a tight `SchedulingConstraint` that forces at least one
  overflow, asserting the overflow item is reported with the correct `reason` and never silently
  placed as a timebox

## 6. Delivery sequence

1. Backend/MCP extension (§1) — `SchedulingConstraint`, `TimeCategoryDefault`, REST additions, MCP
   tools
2. Time panel UI + `/time` page (§2)
3. Breakdown/analytics UI (§3)
4. Constrained auto-scheduler engine + "Plan my cycle" UI (§4) — depends on 1
5. Playwright e2e (§5) — depends on 1–4

1–3 are independent of each other and suitable for parallel work.

## Non-goals

- No continuous/background auto-scheduling (explicitly deferred per product decision — on-demand
  only, to avoid surprising the user by moving things without an explicit action)
- No automatic Task→category inference — `TimeCategoryDefault` is always an explicit user action
- No hard block on manual time tracking past a cap — `SchedulingConstraint` only gates the
  auto-scheduler's placements, never what a person actually records as having happened

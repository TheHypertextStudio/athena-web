# Docket Time Ledger — Product & Engineering Spec

> **Status:** Active — the ledger foundation, contextual entry points, agent execution accounting,
> personal reflection, and recipient-scoped submissions are implemented. Estimate comparisons and
> richer planning-variance views remain additive projections, not alternate time sources.
> **Area:** Hub, work, calendar, agents, API, DB, web data layer
> **Last Updated:** 2026-07-12
> **Companions:** `data-model.md` (tenant and Hub ownership), `calendar-architecture.md`
> (planned/contextual time), `calendar-ui.md` (agenda and item workspace), `athena-agent.md`
> (agent sessions), `activity-feed.md` (typed entity references), and `data-layer.md` (web reads
> and writes).

This spec is the single source of truth for Docket's time-tracking system. It defines a precise,
user-controlled **Time Ledger** that records actual human and agent effort, attributes it to
Docket work when useful, and supports reflection and reporting without turning task state,
calendar data, or agent telemetry into a substitute for measured time.

---

## 1. Product contract

### 1.1 What Docket tracks

Docket records exact time spent on work that a person elects to track. A person can track a Task,
Calendar Item, workspace, project, category, freeform activity, Athena execution, or subagent
execution. A clocked interval is a measured fact with an actor and concrete start/end instants.

The feature must satisfy two equally important needs:

1. **Low-friction working:** a person can start, stop, switch, or repair a record without filling
   out a timesheet before they can work.
2. **Exact reflection:** a person can later break down their time by workspace, Task, project,
   category, actor, date, and planning variance. Agent contribution is visible separately from
   human contribution.

The standard UI words are intentionally direct:

- **Start tracking**
- **Pause**
- **Switch**
- **Stop**
- **Add past time**
- **Tracking** (the shell's live state)

The system may use _record_, _interval_, and _allocation_ in detailed UI or API documentation,
but it must not hide the fact that it is tracking time behind novel product terminology.

### 1.2 What Docket does not infer

A Calendar Item, task timebox, or planned Daily Plan Item says what was scheduled or intended; it
does **not** prove that the person worked for that duration. Calendar information can seed a time
record's context, but it never creates reportable actual time without the person's confirmation.

Docket does not measure application focus, keyboard input, screenshots, or other surveillance
signals. It measures user-started intervals and agent-runtime lifecycle intervals. A person may
repair a missed interval later, and the system must label it as manually reconstructed rather than
pretending it was live-tracked.

### 1.3 Separation of concerns

| Existing primitive             | Meaning                                           | Time Ledger relationship                                                                    |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Task                           | An outcome to move through a workflow             | A record can reference or allocate time to it; tracking never changes its state implicitly. |
| Daily Plan Item / task timebox | Personal intention for a date or time window      | A launch point and planning comparator, never actual time.                                  |
| Calendar Item                  | An external event or native commitment            | Context; the person decides whether to track against it.                                    |
| Agent Session                  | A durable conversation or delegated-job container | Its individual executions contribute measured agent intervals.                              |
| Time Ledger                    | Evidence of actual effort                         | Independent, Hub-owned source of truth for time.                                            |

No `actualMinutes`, running-clock state, or mutable rollup may be added to Task, Project, Calendar
Item, or Agent Session as a competing source of truth. Those surfaces consume ledger projections.

---

## 2. Design principles

1. **One ledger, many doors.** Task detail, Agenda, Calendar, command palette, and Athena all
   create or continue the same record model through one Time service.
2. **Human control is primary.** The user chooses what starts tracking, what counts, which category
   applies, and whether agent effort appears in a view or report.
3. **Intervals are facts; descriptions are editable context.** Exact timestamps and actor/runtime
   provenance must remain auditable. Titles, categories, links, and allocations can be refined.
4. **A record may have many contributors.** Human and agent intervals can belong to the same unit of
   work and may overlap in wall-clock time.
5. **Do not double-count.** Reports distinguish elapsed delivery time, human effort, agent effort,
   and combined effort. They never silently substitute one for another.
6. **Personal by default, shareable deliberately.** Raw time belongs to the person's Hub. Workspace
   reporting uses explicit submissions and current permission checks.
7. **Context is not attribution.** Linking a meeting or related Task makes it discoverable; only an
   explicit allocation makes its duration count toward a reportable target.

---

## 3. Domain model

### 3.1 TimeRecord — the user-visible unit of work

A `TimeRecord` is the semantic container a person sees in the tracker, timeline, and reports. It
answers, “what was this effort for?” It can contain one or more exact `TimeInterval` rows from the
person and any agents they delegated.

Required fields:

- `id`
- `hubId` — the personal, cross-workspace ownership boundary
- `title` — required, editable human label; generated from a starting context when possible
- `status`: `open | paused | closed | submitted | superseded`
- `categoryId` nullable — one optional Hub-owned primary category
- `startedAt` / `endedAt` — derived or transactionally maintained envelope of its intervals;
  never independently editable without changing intervals
- `createdByUserId`
- `captureSource`: `live | manual | reconstructed | agent`
- `createdAt`, `updatedAt`, `closedAt`

An open record may contain a user's one active interval, one or more active agent intervals, or
both. Its display duration is not stored as a counter; it is derived from the interval query.

### 3.2 TimeInterval — the exact measured fact

A `TimeInterval` is a bounded period attributable to exactly one actor. It is the only source of
duration in the system.

Required fields:

- `id`, `timeRecordId`, `hubId`
- `actorKind`: `human | agent`
- `userId` nullable, `agentExecutionId` nullable — exactly one is required by `actorKind`
- `mode`: `human_active | agent_active | tool_wait | awaiting_human`
- `startedAt`, `endedAt` nullable while active
- `source`: `user_timer | manual_entry | reconstructed_entry | agent_runtime`
- `createdAt`, `closedAt`, `supersededById` nullable

`human_active` and `agent_active` count as effort by default. `tool_wait` and `awaiting_human`
remain inspectable operational detail but do not count as effort unless a report explicitly opts
into them. A paused human record has no open `human_active` interval.

An active interval can be closed, but a closed interval is never overwritten. A correction creates
a replacement/superseding interval with a reason, preserving the audit trail and report
reproducibility.

### 3.3 TimeContext — typed, non-counting links

A record can carry a primary context plus any number of related contexts. `TimeContext` uses the
same typed `EntityRef` pattern used by the activity feed rather than inventing free-text foreign
keys.

Required fields:

- `timeRecordId`
- `role`: `primary | related | calendar_context | planning_context | agent_context`
- `entityRef` — kind, source, stable id, and display snapshot
- `organizationId` nullable only for truly personal/freeform contexts
- `createdByUserId`, `createdAt`

At write time, the Time service validates the referenced entity through its owning domain and
records only contexts the caller can read. At read time it re-checks visibility; a revoked
cross-workspace link is redacted rather than leaking a title or URL.

### 3.4 TimeAllocation — explicit reportable credit

Allocations answer, “where should this record count?” They are intentionally separate from
contexts. A record may be related to a meeting and three Tasks but allocate 100% of its effort to
one Task.

Required fields:

- `id`, `timeRecordId`
- `targetKind`: initially `task | workspace | project | category`
- typed target reference and scoped `organizationId` when applicable
- `basisPoints` — integer `0…10_000`
- `createdAt`, `updatedAt`

An unallocated record remains visible in personal reflection. A record becomes reportable only
when its allocations sum to exactly `10_000` basis points; the primary Task/workspace context can
seed a default 100% allocation. Splitting time is always an explicit user action.

### 3.5 TimeCategory — a user-owned taxonomy

`TimeCategory` is Hub-scoped and user-controlled, with `name`, optional `color`, optional parent,
sort position, and `archivedAt`. Categories are optional and should never be required to begin
tracking. Examples include Deep work, Coordination, Customer, Operations, Learning, and Personal.

### 3.6 TimeSubmission — the visibility boundary

`TimeSubmission` is an immutable, explicit snapshot of selected allocated time made visible to an
organization, approver, or export. It contains the reporting period, selected records/allocations,
recipient scope, and the policy used for rounding. Workspace-visible summaries must derive from
submissions, not from a direct read of the person's private Hub ledger.

---

## 4. Actors and agent execution

### 4.1 Human tracking

The global user identity owns human intervals; an organization-specific `Actor` is not the owner,
because one person's time crosses multiple workspaces. A Hub may have **at most one active
`human_active` interval** at a time. Starting a new human tracker atomically closes the previous
one and starts the new interval, preserving an exact handoff.

### 4.2 Agent sessions are not enough

`agent_session` remains the durable conversation/job substrate. It may be a long-lived chat and
can spend time queued, waiting for an approval, or inactive between turns. Its broad `startedAt`
and `endedAt` values must not be presented as agent effort.

The Agents domain adds `AgentExecution`: one dispatched job or conversational turn with its own
runtime lifecycle. Required fields include:

- `id`, `sessionId`, `parentExecutionId` nullable for a subagent tree
- `timeRecordId` nullable when a session has no authenticated initiator; otherwise it references
  the initiator's active record or an atomically-created agent record
- `initiatedByUserId`, `queuedAt`, `startedAt`, `endedAt`
- `status`: `queued | running | tool_wait | awaiting_human | completed | failed | canceled`
- safe provider/runtime reference and failure summary

The runtime opens/closes `TimeInterval` rows from authoritative lifecycle transitions. Beginning
an execution, creating an agent-owned record when necessary, attaching its task context and 100%
task allocation, and opening the interval are one transaction. It creates `agent_active` intervals
only while the execution is actually running. A child-capable runtime dispatches through the
subagent execution port with its parent's id; each child receives its own execution and interval linked through
`parentExecutionId`, and its time must never be folded into a parent's exclusive effort by mutation.

### 4.3 Exact measures

Every detail and report labels its metric:

| Measure               | Definition                                                      | Overlap handling                                 |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| Elapsed delivery time | Record envelope: earliest interval start to latest interval end | A wall-clock span; overlap does not increase it. |
| Human effort          | Sum of `human_active` intervals                                 | The one-active-human invariant prevents overlap. |
| Agent effort          | Sum of `agent_active` intervals                                 | Parallel agents intentionally add together.      |
| Combined effort       | Human effort + agent effort                                     | May exceed elapsed time.                         |
| Operational wait      | Sum of `tool_wait` / `awaiting_human` when requested            | Separate from effort by default.                 |

For an agent parent, **exclusive effort** is its own `agent_active` time; **inclusive effort** is
its exclusive effort plus descendant agent-active intervals. Both are useful, and neither is an
acceptable silent default for the other.

---

## 5. Service boundary and data flow

### 5.1 One Time service

Only the Time service may create, close, supersede, link, allocate, or submit time. Task,
Calendar, Agenda, and Agent code use this service or its typed API; they do not write time tables
directly. Its implementation is intentionally split into four narrow modules behind the stable
`time/service` façade: `commands` owns transactional writes, `access` owns Hub/context/allocation
policy, `read-models` bulk-hydrates and redacts projections, and `reporting` creates immutable
recipient-safe snapshots.

```text
Trackable surface or agent runtime
        │ supplies a validated TrackableContext / execution event
        ▼
Time service ── transaction ──▶ Record, interval, context, allocation
        │
        ├──▶ active-tracker projection
        ├──▶ Agenda actual-time overlay
        ├──▶ task/workspace time summaries
        └──▶ personal analysis, submission, and export projections
```

`TrackableContext` is the integration contract every launching surface supplies:

```ts
interface TrackableContext {
  label: string;
  primaryRef?: EntityRef;
  workspaceRef?: EntityRef;
  contextualRefs: EntityRef[];
  suggestedCategoryId?: string;
}
```

It is a typed input, not a persisted shadow model. The Time service validates it, mints the
`TimeRecord`, and derives default contexts/allocations only when the person has not chosen them.

### 5.2 API surface

All endpoints are Hub/session scoped unless they operate on an explicit submission:

- `GET /v1/time/active` — current human tracker plus visible active agent executions
- `POST /v1/time/records` — create a live or manual record from a `TrackableContext`
- `PATCH /v1/time/records/:id` — edit semantic fields such as title/category
- `POST /v1/time/records/:id/start|pause|stop` — server-clock lifecycle commands; `start` also
  resumes a paused record
- `POST /v1/time/records/:id/intervals` — validated historical/reconstructed entry
- `POST /v1/time/records/:id/contexts` and `DELETE …/contexts/:id`
- `PUT /v1/time/records/:id/allocations` — replaces an intentional allocation set atomically
- `GET /v1/time/timeline`, `GET /v1/time/breakdown`, `GET /v1/time/summary`
- `POST /v1/time/submissions`, `GET /v1/time/submissions/:id`
- `GET /v1/orgs/:orgId/time-submissions` — recipient-safe immutable report snapshots only

Agent runtime calls use an internal Time-service port rather than browser-visible endpoints. The
port is idempotent on execution lifecycle event ids, so retries cannot create duplicate intervals.

### 5.3 Server clock and concurrency

The API is the time authority. Clients render a running display by combining the last server
instant with the active interval's server-issued `startedAt`; the client never writes an elapsed
counter back to the server.

Every start, switch, pause, stop, and agent lifecycle transition is idempotent. The service uses a
transactional active-interval guard to enforce one active human interval per Hub. If two devices
start work concurrently, one command atomically wins and returns the canonical active record; no
overlapping human time is silently created.

All instants are stored as timezone-aware UTC timestamps. Daily, weekly, and billing-period views
bucket intervals in the Hub's selected IANA timezone; DST transitions are therefore correct and
visible at the date-boundary layer rather than corrupting raw timing facts.

---

## 6. UX architecture

### 6.1 Universal tracker

The authenticated shell renders one small `TimeTracker` backed by `GET /v1/time/active`. It shows
the current human record, elapsed time, and relevant active agents. It offers Pause, Switch, and
Stop without navigating away from the current surface.

On a Task, the default action is **Start tracking**. On a Calendar Item it is **Track time for
this**; opening a meeting does not start a clock. The command palette supports **Start
tracking…** for freeform work. All entry points call the same Time service.

### 6.2 Record detail and repair

Stopping a record opens an optional, compact close-out:

- “What changed?” outcome note
- add/remove context
- choose or change category
- split/report allocations
- create a follow-up Task or promote the note elsewhere

The Timeline includes an **Add past time** action for gaps. Reconstructed entries require an exact
start and end chosen by the person and are visibly labeled “Added later”; they are not second-class
time, but they are not represented as live observation.

### 6.3 Agenda and calendar

Agenda may display an optional **Actual** overlay alongside Calendar Item and task-timebox layers.
The overlay makes planning variance understandable without modifying either calendar source.

- planned/timeboxed: “I intended to work here”
- calendar event: “I was committed here”
- actual ledger interval: “I tracked effort here”

The three must remain visually and semantically distinct. Calendar write permissions never grant
permission to edit time records, and vice versa.

### 6.4 Time destination

`/time` is a personal Hub surface with three views:

1. **Now** — active user tracker and active/queued agent executions.
2. **Timeline** — exact intervals, overlaps, handoffs, linked context, and repair actions.
3. **Breakdown** — filterable aggregation by date, workspace, Task, project, category, actor,
   capture source, and planned-vs-actual variance.

The Breakdown view is for reflection, not surveillance. It presents measures and their definitions
instead of a universal productivity score. Users can include or exclude agent effort, operational
wait, and unallocated time deliberately.

---

## 7. Permissions, privacy, and retention

1. A person can always read and edit their own unsubmitted Hub records.
2. A Time context is validated against the linked domain at creation and visibility-checked again
   at read. For the personal ledger, current active workspace membership is the access boundary;
   losing it redacts title, URL, canonical Docket id, and workspace scope while retaining the
   non-identifying duration fact in personal history.
3. Workspace members and managers cannot browse a person's private ledger. They can read only
   records included in a submission they are authorized to view.
4. An agent execution can appear in a person's Time view only when it was initiated by that person,
   explicitly shared with them, or attached to a record they can read. An agent's organization
   permissions remain enforced independently.
5. Exports and submissions declare their measure, time zone, allocation policy, and rounding policy
   in their immutable metadata.
6. Deletion follows the account/Hub lifecycle. Submitted artifacts retain the minimum auditable
   snapshot necessary for their recipient's policy; they never retain unrelated private contexts.

---

## 8. Reporting rules

### 8.1 Aggregation

All totals derive from non-superseded intervals joined through the requested allocation set. A
query must choose exactly one measure before aggregation. The default personal views show Human
effort, Agent effort, Combined effort, and Elapsed delivery time side by side when relevant.

Allocating a record to two targets divides its eligible duration by `basisPoints`. Context links are
never joined into totals. An unallocated record is shown in personal “Unallocated” totals and is
excluded from target-specific submissions until allocated.

### 8.2 Estimate comparisons

Task `estimateMinutes` is a planning estimate. The Task detail can compare it with a selected time
measure and report scope, for example “45m human effort, 20m agent effort, against a 60m estimate.”
It must label agent inclusion and must not use the comparison to automatically change priority,
state, estimation, or health.

### 8.3 Planned-versus-actual reflection

Timeboxes can be matched to a record through a `planning_context` link. Reports can surface
scheduled duration, tracked duration, overlap, and unplanned work. They must not infer that a
timebox was completed from its elapsed calendar window.

---

## 9. Implementation boundaries

### 9.1 Storage

The DB owns the time tables and their cross-workspace Hub boundary. API routes own validation,
clock commands, authorization, and report queries. `@docket/types` owns the Zod DTOs and
discriminated unions. The web app accesses all reads/writes through the standard typed TanStack
Query definitions in `data-layer.md`.

The Time service emits typed domain observations for meaningful record lifecycle events (started,
stopped, submitted) only after the time transaction commits. The activity feed is a downstream
consumer; it must never become the time ledger.

### 9.2 Query and projection policy

The authoritative data path is normalized records, intervals, contexts, allocations, executions,
and submissions. Active-tracker, agenda-overlay, task-summary, and Breakdown responses are
read-model projections. They may be cached or incrementally refreshed, but stale projections never
write totals back into authoritative tables.

Expensive aggregate views use bounded date ranges and indexed Hub/time, target/time, execution/time,
and submission/time access paths. Materialized daily summaries are permitted only as invalidatable
projections; interval rows remain the audit source.

### 9.3 No hidden coupling

The following are prohibited:

- setting a Task to `in_progress` merely because tracking starts
- marking a Daily Plan Item `done` merely because tracking stops
- converting Calendar Item duration into actual time automatically
- deriving agent effort from an entire long-lived `agent_session`
- displaying summed parallel agent effort as elapsed wall-clock duration
- rolling up related context links as if they were allocations

---

## 10. Delivery sequence

1. **Ledger foundation:** migrations, DTOs, Time service, one-active-human invariant, live/manual
   human records, exact timeline read, and shell tracker.
2. **Contextual entry points:** Task, Agenda, Calendar Item, command palette, categories, contexts,
   allocations, and actual-time agenda overlay.
3. **Agent accounting:** `AgentExecution`, runtime lifecycle intervals, parent/subagent hierarchy,
   active-agent shell state, and human-versus-agent measures.
4. **Reflection:** Time Timeline, Breakdown, estimates/planning comparisons, repair workflow, and
   user-controlled filters.
5. **Submission/export:** workspace reports, explicit review/rounding, permission-scoped recipients,
   and export formats.

Every slice must be independently useful and preserve the core invariants. Agent accounting must
not block the human tracking foundation; equally, the foundation must reserve the actor/execution
model so agent timing does not require a second ledger later.

---

## 11. Acceptance criteria

The system is ready for a production slice only when all of the following are true:

- A user can start, pause, switch, stop, and reconstruct time from any Trackable surface.
- Server timestamps, not browser counters, remain accurate through reloads and multiple devices.
- Exactly one human interval is active per Hub; agents may run concurrently.
- Task, workspace, project, category, Calendar Item, and freeform contexts are distinguishable and
  permission-checked.
- A report can accurately distinguish human effort, agent effort, combined effort, elapsed delivery
  time, and operational wait.
- Parallel agents and parent/subagent execution do not double-count in any labeled measure.
- Calendar timeboxes and actual records render together without being conflated.
- A user can view personal cross-workspace time without exposing it to organizations by default.
- A workspace-visible report is an explicit, auditable submission with clear measure, allocation,
  timezone, and rounding semantics.
- The UI explains what is being measured and never implies surveillance or an unearned productivity
  judgment.

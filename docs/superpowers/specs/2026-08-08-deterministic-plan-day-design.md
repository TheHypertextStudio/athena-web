# Deterministic day planning — wiring the real planner into `plan_day`

> **Status**: approved (non-interactive session; the task brief's DO/VERIFY/CONSTRAINTS is the approval)
> **Date**: 2026-08-08

## Objective

`plan_day` produces a day **deterministically** from priority, dependencies and real availability,
stuffing the available windows — rather than being a list the caller hand-edits one task at a time.
The hand-edit actions keep working unchanged; this adds a capability, it does not remove control.

## What was actually there

Three systems that never met:

- `services/scheduling/week-planner.ts` — pure, property-tested `planWeek()`, five ordered passes,
  no I/O and no clock. It plans **`SchedulingCommitment`s by `WorkShape`** (filming sessions, deep
  writing), not `task` rows.
- `services/scheduling/availability.ts` + `intervals.ts` — personal time subtracted _before_
  planning, so protected minutes are structurally unreachable; `SpanPool` never hands out the same
  minute twice.
- `mcp/plan-tools.ts` — `plan_day`, hand-edit CRUD over `daily_plan_item` with a server-assigned
  `sort`. Nothing consumed the dependency DAG behind `/v1/orgs/:orgId/graph`.

### Two corrections to the brief

1. The reconciler-persisted fields are **`task.estimateMinutes`** and **`task.startDate`**, not
   `timeEstimateMinutes`/`plannedDate` (those names have zero hits repo-wide). Landed in
   `e504c3b9`, already on `main`. We consume the real columns.
2. **`planWeek` output is not a list of tasks**, so it cannot be "converted into" a day's plan.
   Reusing it as a task planner would be a category error. What genuinely connects the two is the
   deterministic substrate and the placed time.

## Approach

A new pure module `services/scheduling/day-planner.ts` exporting `planDay()`, built to the same
discipline as `planWeek`: **no I/O, no clock, no model call** — every input is an argument, so
"same inputs produce the same day" is a test rather than a claim.

The connection to `planWeek` is _time_, not shape: the scheduler's placed week blocks for the day
are loaded and passed to `planDay` as **busy**. Task work is fitted into what genuinely remains,
so an auto-planned day never double-books the week planner's own blocks. Protected time is
unreachable for free, because `expandAvailability` removes it before `planDay` sees a pool.

### The ordering: one canonical topological order

Kahn's algorithm over the dependency DAG restricted to the candidate set, where the ready-set is
drained by a **total** comparator:

1. priority (`urgent > high > medium > low > none`)
2. earliest `dueDate` (nulls last)
3. earliest `startDate` (nulls last)
4. `taskId` — the final tiebreak, which is what makes the order _total_ and therefore the whole
   function deterministic rather than dependent on input order.

A blocked task can never precede its blocker: it is not admitted to the ready set until every
in-set blocker has been emitted. Priority reorders _within_ what dependencies permit — an urgent
task waits behind its blocker rather than jumping it. Cycles cannot exist (the DB enforces
acyclicity) but are handled defensively: the lowest remaining `taskId` is force-emitted so the
function is total and never spins.

### Estimates and placement

Duration per task: `clamp(estimateMinutes ?? DEFAULT_TASK_MINUTES)` into `[MIN, MAX]`, with the
provenance reported (`measured` when the task carried an estimate, `shape_default` otherwise) —
consistent with how `duration-model.ts` already reports where a number came from.

Placement walks the topological order and takes the earliest fitting run from the `SpanPool`
(`desk` first, `field` as fallback), which stuffs the windows front-to-back. A task that no longer
fits is **still placed on the plan, in order, without a timebox**, and reported in `unplaced` with
a reason — an over-full day is reported honestly rather than silently truncated.

### Candidate selection

Incomplete, non-archived tasks in the org, assigned to the caller, that are any of:

- already on the day's plan (a manual add is never dropped by an auto-plan),
- `startDate` falls on the day (the reconciler's planned day), or
- `dueDate` falls on the day.

## MCP surface

`plan_day` gains one optional parameter:

```ts
autoPlan: z.boolean().optional();
```

**Auto-plan runs first, then the edits apply.** That ordering is the whole "manual control is
preserved" guarantee: a hand edit always lands on top of the generated day. Output gains
`autoPlanned` (how many the planner placed) and `unplaced` (what did not fit, and why).

Auto-plan rewrites `sort` into topological order and sets timeboxes on what it placed. It clears
timeboxes it cannot fit rather than leaving a stale one pointing at yesterday's slot.

## Files

- `apps/api/src/services/scheduling/day-planner.ts` — new, pure.
- `apps/api/src/services/scheduling/repository.ts` — candidate + dependency-edge loaders.
- `apps/api/src/mcp/plan-tools.ts` — `autoPlan` param, applied before edits.
- `apps/api/tests/services/scheduling/day-planner.test.ts` — new.
- `apps/api/tests/mcp/mcp-plan-tools.test.ts` — extended.

## Validation

- **Property test**: over many generated candidate sets and DAGs, the same inputs produce a
  byte-identical day, and input-order permutation does not change the result.
- **Dependency order**: a blocker's index is always below its blocked task's, including when the
  blocked task has strictly higher priority.
- **Estimates consumed**: a task carrying `estimateMinutes` gets a timebox of exactly that length.
- **No double-booking**: no two timeboxes overlap, and none lands in protected time or on a week
  planner block.
- Existing `plan_day` hand-edit tests must pass unchanged.

## Risks

- Candidate selection is a product judgement; it is documented above and kept in one function so
  it can be tuned without touching the planner.
- `autoPlan` is opt-in, so no existing caller changes behaviour.

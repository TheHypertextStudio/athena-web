# Repeating Work System Implementation Plan

> **For Codex:** Execute each behavioral slice with a failing test first, verify it before moving
> on, then complete code review, Docket craft review, integration, deployment, and live proof.

**Goal:** Ship the complete Docket-owned repeating-work system: one-step recurring tasks,
multi-step recurring projects/processes, rolling calendar materialization, completion-triggered
work, missed-occurrence outcomes, future-only revisions, calendar-event bindings, management UI,
and the API seams Athena uses without being required for correctness.

**Architecture:** `@docket/types` owns named discriminated unions. `@docket/db` persists normalized,
versioned process definitions and recurrence execution state. Pure API domain modules calculate
calendar dates and process readiness. Org-scoped Hono routes expose the same deterministic commands
to the web app, integrations, and Athena. Generated projects, milestones, and tasks remain ordinary
Docket work linked back through instance mapping tables.

**Tech stack:** TypeScript, Zod, Drizzle/Postgres, Hono, React, TanStack Query, Vitest, the existing
Docket scheduler and event bus.

---

## Task 1: Complete named public contracts

**Files:**

- `packages/types/src/recurrence.ts`
- `packages/types/src/primitives.ts`
- `packages/types/src/index.ts`
- `packages/types/tests/dto/recurrence.test.ts`

Define and test named schemas for:

- `RecurrenceSchedule`: daily, weekly, monthly, yearly, and after-completion arms.
- `MonthlyPattern`: day-of-month and nth-weekday arms.
- `RecurrenceEnd`, `MaterializationPolicy`, and missed-occurrence policy.
- `ProcessTrigger`: calendar, after-completion, event, and manual arms.
- `ProcessStepTiming`: on-trigger, relative-to-trigger, and after-step-completion arms.
- `ProcessInstanceItem`: project, milestone, and task arms.
- Definition/revision/step, series/occurrence/instance, create/update/list/detail DTOs.
- Calendar binding and RRULE import/export DTOs.

**Verification:** focused types test, types package typecheck and lint.

## Task 2: Add normalized, versioned persistence

**Files:**

- `packages/db/src/schema/recurrence.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/relations.ts`
- `packages/db/tests/schema/recurrence-schema.test.ts`
- generated Drizzle migration, journal, and snapshot

Test first, then add:

- process definition, immutable revision, project spec, milestone spec, task spec, task-label spec,
  dependency, and transition tables;
- recurrence series/revision, selected weekday, exception, and durable occurrence tables;
- process instance plus project/milestone/task mapping tables;
- stable external event-series binding and occurrence identity tables;
- tenant, lifecycle, uniqueness, ordering, non-negative-offset, and idempotency constraints.

Generate the migration, inspect every statement, and prove it applies to a fresh PGlite database.

**Verification:** focused schema/migration tests, DB typecheck and lint.

## Task 3: Implement pure recurrence and RRULE behavior

**Files:**

- `apps/api/src/lib/recurrence/calendar-date.ts`
- `apps/api/src/lib/recurrence/expand.ts`
- `apps/api/src/lib/recurrence/rrule.ts`
- `apps/api/tests/recurrence/expand.test.ts`
- `apps/api/tests/recurrence/rrule.test.ts`

Test daily intervals, weekly weekday sets, monthly overflow/nth-weekday rules, yearly leap days,
inclusive bounds, count endings, exclusions/additions, timezone-independent date math, and the
four-week/minimum-two rolling horizon. Test compatible RRULE round trips and explicit rejection of
rules Docket cannot represent without losing meaning.

**Verification:** focused API tests, API typecheck and lint.

## Task 4: Implement fixed and stateful process materialization

**Files:**

- `apps/api/src/lib/recurrence/process-definition.ts`
- `apps/api/src/lib/recurrence/materialize.ts`
- `apps/api/src/lib/recurrence/advance.ts`
- focused unit and integration tests under `apps/api/tests/recurrence/`

Test and implement:

- atomic definition/revision authoring with graph validation and immutable published revisions;
- all-at-once materialization for fixed processes, preserving project/milestone/task relationships,
  labels, dependencies, assignees, estimates, and relative dates;
- ready-step materialization for after-completion transitions;
- idempotency under retries/concurrent scheduler calls;
- one-step task processes using the exact same path;
- after-completion series creation from actual terminal task events;
- immutable past instances and future revisions.

**Verification:** focused tests with real migrated storage, API typecheck and lint.

## Task 5: Expose complete org-scoped APIs and automation seams

**Files:**

- `apps/api/src/routes/process-definitions.ts`
- `apps/api/src/routes/recurrence-series.ts`
- `apps/api/src/routes/orgs.ts`
- `apps/api/src/lib/automation/handlers.ts`
- route tests under `apps/api/tests/routes/`

Expose create/list/detail/update/archive for process definitions; create/list/detail/pause/resume/end,
materialize, edit-one, edit-future, and resolve-occurrence for series; plus one-call repeating-task
creation. Enforce org isolation and capability guards. Register `process.start` as an automation
action so event-driven workflows use the same engine.

**Verification:** behavioral route tests covering permissions, isolation, validation, idempotency,
revision boundaries, and application-owned errors.

## Task 6: Connect scheduler, completion events, missed work, and calendar bindings

**Files:** existing API scheduler/event entrypoints, calendar adapters, recurrence domain modules,
and focused tests.

Test and implement:

- periodic rolling-horizon materialization for every active calendar series;
- `skip`, `carry`, and `resolve` missed-occurrence behavior;
- completion-event advancement for completion-anchored series and dependent process steps;
- stable external calendar series/occurrence binding with at-most-one process instance;
- user-facing event action semantics: “Add tasks for each event” / “Plan work around this event.”

**Verification:** scheduler/event/calendar integration tests and repeat-run idempotency proof.

## Task 7: Build the native recurring-task UI

**Files:**

- `apps/web/src/components/recurrence/repeat-task-control.tsx`
- `apps/web/src/components/recurrence/repeat-task-editor.tsx`
- `apps/web/src/components/recurrence/repeat-options-dialog.tsx`
- `apps/web/src/lib/recurrence-summary.ts`
- task composer and query-layer integration files
- focused web tests

Match the approved full-scale preview: Repeat is an ordinary composer property; common rules expand
inline; advanced timezone/end/missed/horizon behavior lives behind “More options”; readable prose
and next dates preview the result. Keep all reads/writes in the typed TanStack Query layer, retain
single-draft undo/reset behavior, and use application-owned error copy.

**Verification:** component tests, keyboard/focus tests, 320px overflow check, web typecheck/lint.

## Task 8: Build repeating-project/process and series-management UI

**Files:** process definition setup routes/components, series detail route/components, task/project
detail backlinks, calendar event action, query keys/definitions, and focused tests.

Implement:

- focused project/process setup with included project, milestones, tasks, dependencies, relative
  timing, all-at-once versus ready-step creation, trigger, and next-instance preview;
- series detail with schedule, status, upcoming/history, pause/resume/end, edit one, edit future,
  resolve missed, and revision history;
- task/project backlinks to their series and process instance;
- calendar event action using product language rather than architecture vocabulary.

**Verification:** component/route tests, accessible primary journeys, narrow/desktop and light/dark
runtime proof.

## Task 9: Documentation and Athena-compatible command surface

**Files:** engineering/product specs, OpenAPI descriptions, MCP/Athena tool catalog where Docket
work commands are exposed, and `docs/WORKLOG.md`.

Document the template/process boundary, deterministic guarantees, scheduler ownership, missed-work
semantics, and revision behavior. Expose process/series authoring commands to Athena using the same
typed API without duplicating recurrence interpretation in the agent layer.

**Verification:** documentation review, generated/open API contract checks, MCP catalog tests.

## Task 10: Code review and follow-up closure

Use the requesting-code-review workflow against the full diff. Review correctness, tenant safety,
idempotency, graph cycles, dates/timezones, migrations, scheduler races, event recursion, query-layer
policy, accessibility, and test honesty. Resolve every actionable finding, rerun affected tests,
then perform a clean second review with no open findings.

## Task 11: Docket craft audit and anti-AI-slop fixes

Use `design-review --fix` on the task composer, process setup, series detail, and calendar action.
Capture 1440×900 and 390×844 in both themes plus 320px overflow, keyboard focus, empty/loading, and
long-content states. Apply `docs/design/craft-rubric.md` and the repo’s anti-AI-tells rubric. Iterate
until every dimension is at least 3 and every hard gate is green; write scorecards under
`docs/design/audits/`.

## Task 12: Full validation, commit, main integration, and production proof

Run focused suites, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, migration checks,
secret scan, and relevant E2E journeys. Complete the worklog/retrospection. Commit atomically using
the required clean-index chain and `projects` scope. Rebase onto current `main`, prove no merge
commits, fast-forward `main`, push, observe the repository’s production deployment workflow, apply
migrations through the official path, run `pnpm launch:verify-prod`, and verify the repeating-work
journey on the deployed application. Local success, a pushed SHA, and a live deploy are three
separate gates.

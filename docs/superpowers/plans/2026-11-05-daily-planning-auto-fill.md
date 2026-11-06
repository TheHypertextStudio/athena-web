# Daily Planning Auto-Fill Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Open daily planning with an editable schedule proposed from the person's existing unfinished work, calendar and work hours.

**Architecture:** Reuse the deterministic proposal endpoint and task visibility checks. Include created tasks as well as assigned tasks in its candidate set; keep the saved-draft, manual-edit, review and confirmation boundaries unchanged.

**Tech Stack:** TypeScript, Drizzle ORM, Hono, Vitest, React Query.

**Spec:** `docs/core/daily-planning.md` — “Plan today” and “Plan today opens with an ordered proposed schedule.”

## Global Constraints

- Task reads and writes use the existing typed API/query path and canonical resource visibility.
- Existing calendar commitments, dependencies, estimates, actual time, exclusions, pins and manual edits remain authoritative.
- A proposal is editable and does not accept the plan or start a timer.

## Review Focus

- Unassigned work created by the caller appears in the initial proposal.
- Work assigned to the caller remains included across memberships.
- Calendar events and work windows still constrain suggested placement.
- Existing saved/manual drafts and exclusions are not silently replaced.
- Empty days remain empty when no visible task fits or availability is zero.

### Task 1: Include created work in the initial day proposal

**Files:**

- Modify: `apps/api/src/services/daily-proposal-candidates.ts`
- Test: `apps/api/tests/routes/daily-plan-proposal.test.ts`
- Test: `apps/web/tests/daily-planning/store.test.tsx`
- Test: `apps/web/e2e/work/daily-planning-existing-work.spec.ts`
- Update: `docs/core/daily-planning.md`
- Update: `docs/design/audits/2026-11-04-daily-planning.md`

**Interfaces:**

- Input: active caller actor IDs already loaded for assigned-task discovery.
- Output: existing `VisibleProposalCandidate[]`, including viewable unfinished tasks where the caller is assignee or creator.

- [ ] Add a regression test with an unassigned task created by the caller; assert it is returned as a suggestion and receives an agenda allocation when work hours permit.
- [ ] Run the focused API proposal test and confirm the new regression fails while existing assigned-work cases pass.
- [ ] Include `task.createdBy` in the existing caller-owned candidate predicate without changing resource-access filtering, candidate duration, dependency ordering or exclusion logic.
- [ ] Rerun the focused proposal suite and verify both assigned and created work are scheduled, full days stay empty, and fixed calendar/workday intervals remain respected.
- [ ] Update the daily-planning audit with the actual first-open behavior, then run affected web/API types, lint and complexity checks.
- [ ] Commit the focused fix with its test and required worklog/design evidence.

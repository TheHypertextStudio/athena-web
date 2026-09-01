# Task descriptions and Library implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tasks one complete description of work with template-aware expansion, shared Resources, one Activity history, clear task relationships, automatic parent completion, and tracker-driven claim/start behavior.

**Architecture:** Extend the existing task record rather than adding a planning record. Persist template identity, use the existing mention and attachment/resource projections, and add only the relationship and event contracts the task record lacks. The web route composes standard entity Description, Resources, and Activity surfaces from these contracts.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Hono, Zod, TanStack Query, Next.js, Tiptap Markdown, Vitest, Playwright.

---

### Task 1: Persist task templates and related-task links

**Files:**

- Modify: `packages/db/src/schema/work.ts`
- Modify: `packages/db/src/schema/joins.ts`
- Modify: `domains/work/src/contracts/task.ts`
- Modify: `packages/db/src/schema/index.ts` and the generated migration directory
- Test: `the deleted legacy type warehouse tests/dto/task-data-integrity.test.ts`
- Test: `apps/api/tests/routes/tasks-detail.test.ts`

- [ ] Add failing DTO and route tests proving that a task round-trips its optional `templateId` and separate reciprocal related-task links.
- [ ] Add `task.templateId` with a foreign key to `template`, plus a canonical `task_related_task` join whose sorted task ids prevent duplicate reciprocal rows.
- [ ] Add `templateId`, `relatedTasks`, and create/update request fields to the task contracts. Reject cross-org templates, non-task templates, self-links, and duplicate links.
- [ ] Generate and inspect the migration. Run the focused types and API route tests.
- [ ] Commit the schema and contract slice.

### Task 2: Make hierarchy completion a workspace policy

**Files:**

- Modify: `packages/db/src/schema/organization.ts` or the existing workspace-preference schema
- Modify: `deleted legacy module workspace` and its DTO tests
- Modify: `apps/api/src/lib/task-state.ts`
- Modify: `apps/api/src/services/task-hierarchy.ts`
- Test: `apps/api/tests/routes/task-reparent.test.ts`
- Test: `apps/api/tests/routes/tasks-detail.test.ts`

- [ ] Write failing tests for the default-enabled policy, final active-child completion, canceled children, automatic reopen, and manually completed parents.
- [ ] Add one workspace-level boolean named `completeParentWhenSubtasksComplete` with default `true`.
- [ ] Centralize parent rollup transitions in the task-state service. Record whether a completion came from the rollup so reopening a child only reopens a rollup-completed parent.
- [ ] Invoke the rollup after subtask state changes, creation, cancellation, and reparenting.
- [ ] Run the focused API tests and commit the hierarchy slice.

### Task 3: Add task expansion as an atomic domain command

**Files:**

- Create: `domains/athena/src/task-expansion/contracts.ts`
- Create: `domains/athena/src/task-expansion/service.ts`
- Modify: `domains/athena/src/task-drafting/adapters/deterministic.ts`
- Modify: `domains/athena/src/task-drafting/adapters/anthropic.ts`
- Modify: `apps/api/src/routes/tasks.ts`
- Modify: `apps/api/src/routes/event-emit.ts`
- Test: `domains/athena/tests/task-expansion.test.ts`
- Test: `apps/api/tests/routes/task-expansion.test.ts`

- [ ] Write deterministic domain tests for preserving authored text, respecting explicit values, template-aware output, leaving uncertain fields unset, valid subtask creation, and explicit dependency-only creation.
- [ ] Define a structured expansion result that contains a replacement description, resource references, allowed property patch, subtasks, dependencies, and related-task links.
- [ ] Implement one transaction that applies the validated result, records one reversible expansion operation, reconciles mentions, and emits Activity events for each applied change.
- [ ] Add a capability-guarded `POST /tasks/:id/expand` route. It returns the updated detail and an undo token without exposing provider error text.
- [ ] Run the domain and API suites and commit the expansion slice.

### Task 4: Use one shared task Resources collection

**Files:**

- Modify: `apps/api/src/routes/attachment-routes.ts`
- Modify: `apps/api/src/routes/entity-mentions.ts`
- Modify: `apps/web/src/lib/use-task-detail.ts`
- Modify: `apps/web/src/components/entity-detail/resources-tab.tsx`
- Modify: `apps/web/src/components/task-detail/TaskAttachments.tsx`
- Test: `apps/api/tests/routes/task-resource-access.test.ts`
- Test: `apps/web/tests/task-detail/task-resources.test.tsx`

- [ ] Write tests that list files, explicit URLs, mail, calendar items, and structured mentions through one task resource read without duplicate URL rows.
- [ ] Expand the shared resource tab to render every attachment kind safely and add the existing task mention route to its query boundary.
- [ ] Remove the task-only attachment and mail panels from the task route after the shared tab covers their behavior.
- [ ] Add reverse Library usage coverage for task references and run the focused web/API suites.
- [ ] Commit the Resources slice.

### Task 5: Build the canonical task Activity feed

**Files:**

- Modify: `apps/api/src/routes/task-activity-routes.ts`
- Modify: `apps/api/src/routes/event-emit.ts`
- Modify: `domains/connections/src/contracts/activity.ts`
- Create: `apps/web/src/components/task-detail/task-activity-feed.tsx`
- Remove: `apps/web/src/components/task-detail/CommentActivityFeed.tsx`
- Remove: `apps/web/src/components/task-detail/task-activity-section.tsx`
- Test: `apps/api/tests/routes/task-activity.test.ts`
- Test: `apps/web/tests/task-detail/task-activity-feed.test.tsx`

- [ ] Write tests covering direct changes, comments, expansion, resources, related links, meaningful child changes, dependency-readiness changes, filtering, and event ordering.
- [ ] Project audit events, comments, timer events, and allowed propagated task events into one task-scoped query with stable filters and cursor pagination.
- [ ] Replace the split comments and history components with one Activity component that renders chronological entries and application-owned errors.
- [ ] Run the focused suites and commit the Activity slice.

### Task 6: Claim and start tasks when tracking begins

**Files:**

- Modify: `apps/api/src/time/commands.ts`
- Modify: `apps/api/src/time/task-anchor.ts`
- Test: `apps/api/tests/time/commands.test.ts`
- Test: `apps/web/tests/time-tracking/task-timer-button.test.tsx`

- [ ] Write failing tests for an unassigned unstarted task, an assigned task, a completed task, and a failed atomic transition.
- [ ] Move task claim and start-status work into the same database transaction that begins a task-anchored timer.
- [ ] Preserve existing assignment, completion, and priority values. Emit the task changes and timer event only after the shared transaction commits.
- [ ] Run time API and web control tests and commit the tracking slice.

### Task 7: Compose the task entity surface

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx`
- Modify: `apps/web/src/components/task-detail/task-header-controls.tsx`
- Modify: `apps/web/src/components/task-detail/task-properties-rail.tsx`
- Create: `apps/web/src/components/task-detail/task-details.tsx`
- Test: `apps/web/tests/task-detail/task-detail-client.test.tsx`
- Test: `apps/web/e2e/work/verify-task-description-and-library.spec.ts`

- [ ] Write tests that expose the description, direct status/priority/assignee/tracker actions, expanded details, subtasks, Resources, and Activity through the task route.
- [ ] Reuse the standard entity tabs for Resources and Activity. Keep the description primary and keep less-frequent properties inline or behind the existing responsive overflow behavior.
- [ ] Add the expansion action to the description editor without personifying the system or creating a second document.
- [ ] Run responsive component tests and the authenticated browser journey at desktop and phone widths.
- [ ] Commit the task surface slice.

### Task 8: Migration, validation, deployment, and documentation

**Files:**

- Modify: `docs/WORKLOG.md` only if the existing owner releases its pending edit
- Modify: `docs/superpowers/specs/2026-08-24-task-description-and-library-design.md`
- Test: relevant API, domain, web, repository-policy, and browser suites

- [ ] Apply the generated migration against the production-like database and prove existing tasks remain readable with null template identity and no related links.
- [ ] Run scoped typecheck, lint, API/domain tests, web tests, and the task browser journey with constrained workers.
- [ ] Run the design review at desktop and mobile widths in light and dark modes without opening a browser unless the user explicitly authorizes it.
- [ ] Commit each verified slice, push the isolated branch, complete required checks, deploy, and verify the public and authenticated task routes against the deployed revision.
- [ ] Update the work log only after resolving its existing unrelated dirty state. Do not stage another worker’s changes.

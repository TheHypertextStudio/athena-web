# Athena Companion Phase 2b (Work on the Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Proposals show on the page they change, decisions split by class (Approve with Undo inside Docket, Review before anything leaves), and delegated work is visible on the task it came from.

**Architecture:** No new entities. Undo reuses the MCP change-set ledger through a new personal route. Review is an inline expansion of the proposal's input, never a modal. The task page reads the same personal queue the rail reads and filters by source. Ghost rows are a `TaskTable` prop computed by the project page from the pending proposals of the conversation and of jobs waiting on the person; hover highlight is a small context both sides share.

**Spec:** `docs/superpowers/specs/2026-09-12-athena-companion-design.md` §2.1 (principles 4, 6), §4.6, §5 Phase 2. Global Constraints are those of the Phase 2a plan (`2026-09-18-athena-companion-phase-2a.md` lines 13–26) plus: zero borders (tonal steps only), no self-describing copy, descriptions only where they add context.

## Existing pieces

- Undo: `apps/api/src/mcp/change-set.ts` `undoChangeSet(...)`; `apps/api/src/routes/voice-sessions.ts` route `POST /:id/changes/:changeSetId/undo` and `apps/api/src/routes/phone-call-summary.ts` show how a route calls it with the owner's actor. Write tools return `changeSetId` in their output (`apps/api/src/mcp/write-tools.ts:88`); the web adapter keeps tool output under `activity.technical.output`.
- Proposals: `useSessionDetail(orgId, sessionId)` (`apps/web/src/lib/use-session-detail.ts`) exposes `proposals: ProposalGroupOut[]` for a session; `ProposalItemOut` carries `tool`, `input`, `summary`, `ghost`. `describeProposal(item)` in `apps/web/src/lib/athena/describe-proposal.ts` turns one into a sentence.
- Table: `TaskTable` (`apps/web/src/components/views/task-table.tsx`) renders the project tasks tab via `MilestoneTasks`; rows are `TaskOut`.
- Task page: `TaskActivityFeed({ orgId, taskId, onComment?, canComment? })` in `apps/web/src/components/task-detail/task-activity-feed.tsx`.
- Jobs: `personalAthenaQueueDef`, `jobsFromQueue(payload)`, `AthenaJobCard({ job, transport?, expanded?, id? })`, `job-card-parts.tsx` (receipt rows, steps, decision block).

## Tasks

### Task 1: Undo and Review

API: add `POST /v1/me/athena/changes/:changeSetId/undo` in `apps/api/src/routes/me-athena.ts`, authorising that the change set belongs to a session the caller owns (look up the session by the change set's session id; 404 otherwise), calling `undoChangeSet` the way the voice route does, returning `{ changeSetId, undone: true }` (reuse or mirror the voice `PhoneCallUndoOut` schema as `AthenaUndoOut` in `domains/athena/src/contracts/agent.ts`). Route test in `apps/api/tests` (owner can undo, other user 404).

Web: in `apps/web/src/lib/athena/query-defs.ts` add `undoChange(changeSetId)` to `PersonalAthenaTransport` and the default transport; `useAthenaActions` gains `undo(changeSetId)` (a `useApiMutation`, invalidating `queryKeys.athena()`). In `job-card-parts.tsx`: a step row whose `technical.output.changeSetId` is a string and whose job is `done` shows a `Button variant="ghost" size="sm"` "Undo" that calls it and then renders the row's detail with an "Undone" `Badge`; the receipt block gets the same control when the result carries a change set (read the newest such step). Decision classes: `isOutwardTool(tool)` in `describe-proposal.ts` (`/send|post|publish|mail|email|invite|pay|charge/i` on the tool name); in `proposal-group-card.tsx`, when any item is outward the primary reads "Review" and toggles an inline expansion of each outward item's `input` as label/value rows (`to`, `subject`, `body` first, then the rest; long values wrap); once expanded the primary reads "Approve"; the job card's decision block does the same when its decision title comes from an outward tool (the decision carries no tool name today: read it from the newest `tool` step's `technical.toolName`). Tests for each behaviour, values not prose.

Commit: `feat(athena): Undo what Athena changed and read what leaves before it goes` (Docs-impact: Updated - the companion design §4.6).

### Task 2: Delegated work on the task it came from

`TaskActivityFeed` gains, above the comments, a block that reads `useLiveApiQuery(personalAthenaQueueDef(), 10_000)`, filters `jobsFromQueue(payload)` to `job.context?.source?.type === 'task' && job.context.source.id === taskId`, and renders each as `AthenaJobCard` (newest first) under a neutral label `Athena`; nothing renders when there are none. Test with a mocked transport (one matching job, one other).

Commit: `feat(athena): Show Athena's work on the task it was asked from` (Docs-impact: Updated - §4.6).

### Task 3: Ghost rows on the project page, with hover highlight

- `apps/web/src/components/athena/proposal-highlight.tsx`: `ProposalHighlightProvider` (mounted once in `AthenaShell` in `app-shell-frame.tsx`), `useHighlightedIds(): ReadonlySet<string>`, `useSetHighlightedIds()`. `ProposalRow` and the job card's decision block set the ids of the tasks their proposal touches on pointer enter and clear on leave (`input.taskId` / `input.taskIds`).
- `apps/web/src/lib/athena/proposed-changes.ts`: `useProposedTaskChanges(orgId): ReadonlyMap<string, string>` (task id → `describeProposal` sentence), from the conversation's pending proposals (`useOrgChatThread(orgId)` status `awaiting_approval` → `useSessionDetail(orgId, thread.id).proposals`) and from each `needs_you` job's proposals (`GET /v1/me/athena/sessions/:id/proposals`; add `proposals(sessionId)` to the transport). Only `update_task`/`delete_task`-style tools with a `taskId` map to a row.
- `TaskTable` gains `proposedByTaskId?: ReadonlyMap<string, string>` and `highlightedIds?: ReadonlySet<string>`; a proposed row renders with the ghost tint and opacity, a trailing `text-body-small` sentence, and the `viewTransitionName` `proposal-task-<id>`; a highlighted row gets `bg-surface-container-high`. `MilestoneTasks` and the project page pass both through.
- Tests: the hook maps a pending `update_task` to its row sentence; the table renders a proposed row with the sentence; highlight tints the row.

Commit: `feat(athena): Show a proposed change on the row it would change` (Docs-impact: Updated - §4.6).

### Task 4: Journey and screenshots

Journey `apps/web/e2e/athena/companion-page.spec.ts` (mocked personal API as in `companion-work.spec.ts`, plus a chat thread awaiting approval with one `update_task` proposal on a seeded task): the project tasks tab shows that task's row with the proposal sentence; hovering the proposal in the rail tints the row; approving clears the ghost; a task page with a delegated job shows the Athena block. Screenshots (live stack, `DOCKET_DEV_PORT=1375`, seeded as before) into `apps/web/.data/design-review/2026-09-18-phase2b/`: (1) project tasks tab with a ghost row and the rail's proposal card; (2) the same while hovering the proposal (row highlighted); (3) task page with the Athena block; (4) a Done card with Undo on its receipt; (5) an outward proposal (mock a `send_email` if the local model offers one; otherwise the unit-tested Review expansion captured from the mocked journey); plus retakes of Phase 2a shots 2 and 3. No horizontal overflow on any.

Commit the spec: `feat(athena): Prove a proposal shows on its row and work shows on its task`.

### Task 5: Gates and the work log

Root gates; `docs/WORKLOG.md` Phase 2b bullet; `chore(athena): Record the companion's Phase 2b in the work log`.

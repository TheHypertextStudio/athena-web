# Athena Companion Phase 2a (Work in the Thread) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delegated work lives in the thread. A job is a card in the conversation and a row in a pinned Working strip; the wide view is the same thread with a Work ledger beside it; Today keeps one composer per screen.

**Architecture:** Jobs stay `kind: 'job'` sessions read through the existing personal queue and detail definitions. The thread does not change on the API: `AthenaConversation` merges the queue's jobs into its activity list by time and renders each as an `AthenaJobCard`, which fetches its own detail lazily and drives its own actions with `useAthenaActions`. The rail and the wide view both read the queue once (`personalAthenaQueueDef`) and pass jobs down. `AthenaWorkspace` is rebuilt as two columns: browser + ledger + connections on the left, the thread on the right. Ghost rows on the page, the Review/Undo split, and the job card on the task page are Phase 2b.

**Tech Stack:** Next.js App Router, React 19, TanStack Query (`apps/web/src/lib/query.ts`), Hono RPC, `@docket/ui` primitives (`Badge`, `Button`, `Collapsible*`, `DropdownMenu*`, `Surface`, `Chip`), Vitest + Testing Library under `apps/web/tests/`, Playwright under `apps/web/e2e/`.

**Spec:** `docs/superpowers/specs/2026-09-12-athena-companion-design.md` §4.2 (Working strip, job card), §4.6, §4.7, §4.8, §5 Phase 2.

## Global Constraints

- Tests live in `apps/web/tests/**`, never colocated in `src/`.
- Never assert exact UI copy in tests; assert roles, accessible names by regex, values, hrefs, presence.
- Every exported function, type, and component gets TSDoc.
- No chained or nested ternaries; no inline object types as parameter annotations or generic constraints.
- UI copy is application-owned and plain: no "session", "job", "tool", "execute", "queue" shown to a person; the card has no type label; the technical disclosure reads "What Athena used"; status lines name the object and its progress.
- Data access only through `apiQueryOptions` / `useApiQuery` / `useLiveApiQuery` / `useApiMutation`.
- Shared primitives from `@docket/ui` only; the primary display primitive is a list row.
- No new entries or larger numbers in `complexity-debt.json` / `design-token-debt.json`.
- The app never overflows horizontally at any width; the rail is 280px at 1440.
- `pnpm` only; root `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
- Commits: `feat(athena): …` / `fix(athena): …`, body ≥ 100 chars, `Docs-impact:` trailer, `Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>`; one chain `git restore --staged . && git add <paths> && git commit -F <file>`. Never push. Never `git stash`.
- No `// TODO`, no stubs, no skipped tests.

## Existing pieces to reuse (read before writing)

- `apps/web/src/lib/athena/presentation.ts`: `PersonalAthenaSessionSummary` (`id, objective, status, queueState?, workspace?, context?, createdAt, updatedAt`), `PersonalAthenaSessionDetail` (adds `decision?`, `activities`, `result?`, `activityNextCursor?`), `presentAthenaSession(detail)` → `{ objective, stateLabel, contextLabel, decision, activity[], result, canPause, canResume, canCancel, commandLabel }`, `athenaQueueState(status)`, `groupAthenaQueue(sessions)`.
- `apps/web/src/lib/athena/query-defs.ts`: `personalAthenaQueueDef(transport?, enabled?)` (key `queryKeys.athena()`), `personalAthenaDetailDef(sessionId, transport?, hostVisible?)` (key `queryKeys.athenaSession(id)`), `personalAthenaTransport`.
- `apps/web/src/components/athena/use-athena-actions.ts`: `useAthenaActions({ selectedId, transport, onSelected })` → `{ feedback, pending, sendMessage, lifecycle, decide({ id, option, kind }), create, createPending }`.
- `apps/web/src/components/athena/athena-workbench.tsx`: the current job view (header pills, decision block, work log rows with `McpAppPresentationCard` and a `<details>` disclosure, result receipt `<dl>`, steer form). Its rendering of activity rows and the receipt is lifted into the card; the component is deleted in Task 4.
- `apps/web/src/components/athena/elicitation-queue.tsx`: `ElicitationQueue({ organizationId?, showSettled?, className? })` renders pending questions (and presence).
- `apps/web/src/components/athena/athena-conversation-browser.tsx`, `athena-mcp-panel.tsx`: the topics/search browser and the connections panel, both currently in `athena-workspace.tsx`'s left column.
- `apps/web/src/components/athena/athena-conversation.tsx`: `AthenaConversation({ orgId, emptyState?, className?, initialDraft?, draftRequest?, context?, contextAttached?, onDetachContext?, onAttachContext?, suggestions? })`; entries are `ChatEntry` per activity; `ChatProposals` renders pending proposal groups; the composer is `Composer`.
- `apps/web/src/components/athena/athena-rail-conversation.tsx`: header + `AthenaConversation`.
- `apps/web/src/components/athena/athena-panel-provider.tsx`: `AthenaPanelValue { context, launchDraft, railStatus, contextAttached, attachContext, detachContext, openAthena, closeAthena, railContent, provideRailContent }`, `railVisible` prop.

---

## File Structure

| File                                                                                                                                                                                                                                                                                                          | Responsibility                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/athena/athena-job-card.tsx` (create)                                                                                                                                                                                                                                                 | One piece of delegated work as a card: state, objective, status line, steps, decision, receipt, Reply, overflow menu. Fetches its own detail; owns its actions. |
| `apps/web/src/components/athena/athena-working-strip.tsx` (create)                                                                                                                                                                                                                                            | Pinned rows for running and waiting work, collapsible, inline approve/decline.                                                                                  |
| `apps/web/src/components/athena/athena-work-ledger.tsx` (create)                                                                                                                                                                                                                                              | The wide view's Running / Needs you / Done list.                                                                                                                |
| `apps/web/src/lib/athena/job-presentation.ts` (create)                                                                                                                                                                                                                                                        | Pure helpers: `jobStatusLine(detail or summary)`, `jobTone(status)`, `mergeThreadEntries(activities, jobs)`.                                                    |
| `apps/web/src/components/athena/athena-conversation.tsx` (modify)                                                                                                                                                                                                                                             | Accepts `jobs`; interleaves job cards with activities; renders pending questions above the composer.                                                            |
| `apps/web/src/components/athena/athena-rail-conversation.tsx` (modify)                                                                                                                                                                                                                                        | Reads the queue; renders the Working strip under the header; passes jobs to the thread.                                                                         |
| `apps/web/src/components/athena/athena-workspace.tsx` (rewrite)                                                                                                                                                                                                                                               | Two columns: browser + ledger + connections; header + thread.                                                                                                   |
| `apps/web/src/components/athena/athena-workbench.tsx` (delete)                                                                                                                                                                                                                                                | Replaced by the job card.                                                                                                                                       |
| `apps/web/src/components/athena/athena-panel-provider.tsx` (modify)                                                                                                                                                                                                                                           | Exposes `railVisible`.                                                                                                                                          |
| `apps/web/src/components/today/today-prompt.tsx` + `apps/web/src/app/(app)/today/page.tsx` (modify)                                                                                                                                                                                                           | Capture-only prompt while the rail's Athena panel is open.                                                                                                      |
| Tests: `apps/web/tests/athena/job-presentation.test.ts`, `job-card.test.tsx`, `working-strip.test.tsx`, `work-ledger.test.tsx` (create); `athena-conversation.test.tsx`, `rail-conversation.test.tsx`, `workspace.test.tsx` (rewrite), `today/today-prompt.test.tsx` (modify); `workbench.test.tsx` (delete). |
| `apps/web/e2e/athena/companion-work.spec.ts` (create)                                                                                                                                                                                                                                                         | Delegate → card in thread → decision in strip → receipt.                                                                                                        |
| `docs/WORKLOG.md` (modify)                                                                                                                                                                                                                                                                                    | Phase 2a recorded.                                                                                                                                              |

---

### Task 1: Job presentation helpers

**Files:** create `apps/web/src/lib/athena/job-presentation.ts`; test `apps/web/tests/athena/job-presentation.test.ts`.

**Interfaces produced:**

- `type JobTone = 'attention' | 'active' | 'done' | 'stopped'`; `jobTone(status: PersonalAthenaStatus): JobTone` (`awaiting_input | awaiting_approval → attention`, `pending | running → active`, `completed → done`, `failed | canceled → stopped`).
- `jobStateLabel(status): string` (`Needs you`, `Working`, `Done`, `Stopped`; `pending → Working`).
- `jobStatusLine(detail: PersonalAthenaSessionDetail | null, summary: PersonalAthenaSessionSummary): string`: a decision pending → its `title`; else the newest non-reasoning activity's `title` (`presentAthenaActivity`) with its `detail` appended after `·` when short (≤ 60 chars); else `result?.summary`; else `''`.
- `interface ThreadJobEntry { readonly kind: 'job'; readonly at: string; readonly job: PersonalAthenaSessionSummary }`, `interface ThreadActivityEntry { readonly kind: 'activity'; readonly at: string; readonly activity: SessionActivityOut }`, `type ThreadEntry = ThreadJobEntry | ThreadActivityEntry`; `mergeThreadEntries(activities: readonly SessionActivityOut[], jobs: readonly PersonalAthenaSessionSummary[]): readonly ThreadEntry[]` sorted by `at` ascending (`createdAt`), stable for equal times (activity first).

- [ ] Write the failing tests (tone and label for every status; status line prefers the decision, then the newest activity, then the result; merge order and stability).
- [ ] Implement with TSDoc; no ternary chains (use lookup tables).
- [ ] `pnpm --filter @docket/web exec vitest run tests/athena/job-presentation.test.ts`; eslint; `pnpm typecheck`.
- [ ] Commit: `feat(athena): Describe delegated work in a card's words` (body ≥ 100 chars; `Docs-impact: Not needed - pure helpers`).

---

### Task 2: The job card

**Files:** create `apps/web/src/components/athena/athena-job-card.tsx`; test `apps/web/tests/athena/job-card.test.tsx`.

**Interfaces:**

- `AthenaJobCardProps { readonly job: PersonalAthenaSessionSummary; readonly transport?: PersonalAthenaTransport; readonly expanded?: boolean; readonly id?: string }`.
- `AthenaJobCard` renders `<article id={id ?? `athena-job-${job.id}`} aria-labelledby=…>`:
  - header row: `Badge` with `jobStateLabel`, the objective as `<h3>`, an overflow `DropdownMenu` (icon button named "More") with Pause / Resume / Cancel items gated by `canPause/canResume/canCancel`;
  - status line (`jobStatusLine`) in `text-body-small text-on-surface-variant`;
  - steps: the presented activity rows (title, detail, `McpAppPresentationCard` when present, and the disclosure renamed **"What Athena used"**); collapsed to the last 3 rows while running with a "Show all N" `Button variant="ghost"`; all rows when finished or expanded;
  - decision block when `decision` is present: title, description, option buttons (`variant="default"` for the first, `outline` for the rest); a free-text answer field when `kind === 'question'` and no options;
  - receipt when `result` is present: `result.title`, `result.summary`, the `receipt` rows as a list of `dt/dd` (same markup as the workbench);
  - Reply: a `Button variant="ghost" size="sm"` named "Reply" that toggles a one-line `MentionTextarea` + Send which calls `sendMessage`.
- Data: `useApiQuery({ ...personalAthenaDetailDef(job.id, transport, true), refetchInterval: tone === 'active' ? 3000 : false })`. Actions: `useAthenaActions({ selectedId: job.id, transport, onSelected: (next) => queryClient.setQueryData(queryKeys.athenaSession(next.id), next) })`. Feedback (`actions.feedback`) renders as `role="alert"` inside the card.
- No "Start new work", no "Back", no state pill text other than the four labels.

- [ ] Failing tests: renders objective and state; shows a pending approval's options and calls `decide` with the option id; lifecycle items appear only when allowed and call `lifecycle`; Reply sends through `sendMessage`; the disclosure summary is named "What Athena used"; a running card collapses to the last three steps with a "Show all" control.
- [ ] Implement (lift the row/receipt markup from `athena-workbench.tsx`).
- [ ] Tests, eslint, typecheck. Commit: `feat(athena): Show a piece of delegated work as a card` (`Docs-impact: Updated - docs/superpowers/specs/2026-09-12-athena-companion-design.md`).

---

### Task 3: The Working strip and the Work ledger

**Files:** create `athena-working-strip.tsx`, `athena-work-ledger.tsx`; tests `working-strip.test.tsx`, `work-ledger.test.tsx`.

**Interfaces:**

- `AthenaWorkingStrip({ jobs: readonly PersonalAthenaSessionSummary[]; transport?; onOpen(jobId: string): void })`: renders nothing when no job has tone `attention` or `active`; otherwise a `Collapsible` (open by default) whose trigger reads `Working · N`; each row is a `<li>` with a tone dot (`bg-primary` active, `bg-health-at-risk` attention), the objective (truncated), the status line; an attention row with an approval decision shows two `Button size="sm"` (first option primary, second outline) calling `useAthenaActions(...).decide`; the row itself is a button that calls `onOpen(job.id)`. Rows fetch detail only when tone is `attention` (for the decision), via `personalAthenaDetailDef(id, transport, true)`.
- `AthenaWorkLedger({ jobs; filter: 'running' | 'needs_you' | 'done'; onFilterChange; onOpen(jobId) })`: a segmented control (use the `Tabs`/`TabList`/`Tab` primitives as `today-prompt.tsx` does) with counts, then rows: objective, status line, date (`Intl.DateTimeFormat` short month + day). Done sorts newest first.

- [ ] Failing tests for both (hidden when nothing runs; rows; inline approve calls `decide`; ledger filter switches the set; row click calls `onOpen`).
- [ ] Implement; tests; eslint; typecheck. Commit: `feat(athena): Pin running work above the thread and list it beside the wide view` (`Docs-impact: Updated - …companion-design.md`).

---

### Task 4: Work in the thread; the rail and the wide view

**Files:** modify `athena-conversation.tsx`, `athena-rail-conversation.tsx`; rewrite `athena-workspace.tsx`; delete `athena-workbench.tsx` and `apps/web/tests/athena/workbench.test.tsx`; modify/rewrite tests `athena-conversation.test.tsx`, `rail-conversation.test.tsx`, `workspace.test.tsx`.

**Interfaces:**

- `AthenaConversationProps` gains `jobs?: readonly PersonalAthenaSessionSummary[]` and `transport?: PersonalAthenaTransport`; the entry list becomes `mergeThreadEntries(thread.activities, jobs)`; a `job` entry renders `<AthenaJobCard job transport />`; pending questions render as `<ElicitationQueue organizationId={orgId} />` directly above the composer. The empty state shows only when there are no activities **and** no jobs.
- `AthenaRailConversation`: `const queue = useLiveApiQuery(personalAthenaQueueDef(transport, true), 5_000)`; `jobs = [...needsYou, ...working, ...finished]`; renders `<AthenaWorkingStrip jobs onOpen={scrollToCard} />` between the header and the thread, where `scrollToCard(id)` does `document.getElementById(`athena-job-${id}`)?.scrollIntoView({ block: 'center' })`.
- `AthenaWorkspace({ initialSessionId?, workspaceFilter?, invocationContext?, startNewWork?, transport? })` keeps its props (the route passes them) and renders: left column (`19rem`, `@3xl:` two columns): `AthenaConversationBrowser`, `AthenaWorkLedger` (filter state local; `onOpen` scrolls to the card and, when the card is not in the thread window, sets `pinnedJobId` which renders that card above the composer), `AthenaMcpPanel`; right column: header (mark, `VoiceLaunch`, no link), `AthenaConversation orgId={workspaceFilter ?? active workspace} jobs transport context={invocationContext} draftRequest` (an `initialSessionId` scrolls to that card after load; `startNewWork` seeds nothing now: the composer is always there). The active workspace when `workspaceFilter` is null comes from the shell's page context (`usePageContext()?.workspaceId`); if neither exists render the one-line status from the rail.
- The old lanes, the new-work form, the "Current context" aside, and the "Result receipt" aside are removed.

- [ ] Rewrite `workspace.test.tsx` around: ledger filters and counts from the queue payload; a ledger row scrolls to or pins its card; the thread renders a job card for a queued job; the composer is present with the workspace context chip. Update `athena-conversation.test.tsx` (a job appears as an `article` in time order; empty state absent when a job exists) and `rail-conversation.test.tsx` (strip appears for a running job).
- [ ] Implement; `pnpm --filter @docket/web exec vitest run tests/athena tests/plan-canvas`; eslint; typecheck. Watch the file-length ledger for `athena-conversation.tsx`; extract `ThreadEntries` into `apps/web/src/components/athena/thread-entries.tsx` if needed.
- [ ] Commit: `feat(athena): Put delegated work in the conversation and the wide view beside it` (`Docs-impact: Updated - …companion-design.md`).

---

### Task 5: One composer per screen on Today

**Files:** modify `athena-panel-provider.tsx` (expose `railVisible: boolean` on `AthenaPanelValue`), `today-prompt.tsx` (new prop `captureOnly?: boolean`: hides the Task/Athena segmented control, forces `mode = 'task'`, placeholder "Add a task"), `app/(app)/today/page.tsx` (passes `captureOnly={railVisible}`); tests `today/today-prompt.test.tsx` (capture-only renders no `tablist`, sends to capture) and `panel-provider.test.tsx` (`railVisible` reflects the prop).

- [ ] Failing tests → implement → tests, eslint, typecheck → commit: `feat(athena): Keep one composer on Today while the conversation is open` (`Docs-impact: Updated - …companion-design.md`).

---

### Task 6: Journey and screenshots

**Files:** create `apps/web/e2e/athena/companion-work.spec.ts`.

- Fixture: route `**/v1/me/athena**` to serve `pulse`, the queue (one `awaiting_approval` job with a decision in its detail), the detail, and `PUT …/activity/:activityId/decision` (returns the detail as `completed` with a `result`); route the org chat `GET` to an empty thread. Journey at 1440×900: `/today` → ⌘J → the Working strip lists the job → the thread shows an `article` named by the objective → click its first decision button → the strip row disappears and the card shows the receipt. Then `/athena?workspace=<orgId>` → the ledger shows Done · 1 → clicking the row scrolls the card into view (assert `article` visible).
- Screenshots (same stack procedure as Phase 1, `DOCKET_DEV_PORT=1375`, seeded account with a project and two tasks, one delegated job created via `POST /v1/me/athena/sessions` with a prompt so the local mock turn produces a proposal): `apps/web/.data/design-review/2026-09-18-phase2a/`: (1) rail with the Working strip and a job card awaiting approval at 1440 light; (2) the same after approving, receipt visible; (3) `/athena` wide view with the ledger on Done and the card in the thread, 1440 light; (4) (1) in dark; (5) (1) at 390; (6) Today with the rail open showing the capture-only prompt. Assert no horizontal overflow on each.
- Commit the spec: `feat(athena): Prove delegated work is decided in the thread` (`Docs-impact: Not needed - tests only`).

---

### Task 7: Gates and the work log

- Root `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (force web if cached).
- `docs/WORKLOG.md`: tick a new `Phase 2a` line under the Phase 2 subtask; Notes bullet: `**Phase 2a landed (<date>)**: job cards in the thread, the Working strip in the rail, the Work ledger in the wide view, the queue and workbench retired, Today capture-only while the conversation is open. Ghost rows, Review/Undo, and the card on the task page follow in Phase 2b.`
- Commit `chore(athena): Record the companion's Phase 2a in the work log`; confirm `git rev-list --merges --count origin/main..HEAD` is 0. Do not push.

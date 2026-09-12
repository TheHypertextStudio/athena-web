# Athena companion: design and delivery plan

> **Status**: Proposed, awaiting product decisions (see "Decisions to confirm")
> **Date**: 2026-09-12
> **Replaces**: the utility-rail Athena panel (`AthenaRailPanel`), the "Start this work" launch
> composer, and the job-queue framing of `/athena`
> **Companions**: `docs/engineering/specs/athena-agent.md` (the engine), `docs/core/mvp-plan.md`
> §4 and §8.6 (the product promise), `docs/design/audits/2026-07-15-personal-athena.md` (what
> shipped and why)

## 1. The problem in one paragraph

The current sidebar is a process supervisor. Its unit is the session, a system object: a queue of
Needs you / Working / Finished, a ticket view with Pause / Resume / Cancel above the content, a
dispatch form titled "Start this work", and an "Open full" escape hatch. The panel clears its
state on every route change, has no idea what page the person is on, and holds a different
conversation from the one Today opens. Four composers with four grammars sit on top. The engine
underneath is right (one personal session substrate, one MCP server, one approval system). The
frame on top tells the person Athena is a job system, and the frame is what they believe.

## 2. What a person wants from Athena

Five properties. Each is a test the design has to pass.

1. **Stays put.** Moving around the app never resets the conversation. The panel is the same
   panel on every page.
2. **Already knows.** Whatever is on screen is Athena's context by default, shown as a chip the
   person can see and remove. Nobody hands Athena a memo.
3. **One thread.** Questions, delegated work, proposals, questions back, and receipts are all
   entries in one conversation. Long-running work is a card in that thread that keeps updating.
4. **Speaks first.** When something on this page needs the person, Athena says what it is, in
   the thread, ranked. The icon badge summarizes the thread; it is never the only signal.
5. **Feels alive.** Replies stream. Work shows what it is doing as it does it.

## 3. Approaches considered

**A. Companion thread in the rail (recommended).** Rebuild the rail panel as the one personal
conversation, page-aware, with a pinned "Working" strip for delegated jobs. `/athena` becomes the
wide view of the same thread. The queue dissolves into thread cards. This is the only option that
passes all five tests, and it reuses the presenter, proposal card, elicitation cards, MCP app
cards, and the SSE tail that already exist.

**B. Add a Chat tab beside the queue.** Two tabs inside the rail panel: Conversation and Work.
Cheapest change. It keeps the fracture (two mental models, one panel) and the queue keeps
teaching the job-system framing. Rejected.

**C. Full page only, no rail panel.** Delete the rail panel and send ⌘J to `/athena`. Simplest to
maintain. It gives up the property the whole feature exists for: Athena beside the work the
person is looking at. Rejected.

## 4. Design

### 4.1 Placement in the shell

- Athena is the **first** panel in the utility rail and the panel ⌘J toggles. Agenda and Focus
  remain as the second and third panels. The rail's default panel on a fresh session is Athena
  when the thread has anything pending; otherwise the existing Agenda default holds.
- The panel is mounted once in the shell and survives navigation. Route changes update the
  context chip and nothing else.
- The activity-bar icon keeps its `RailPanelStatus`. Its label and tone are derived from the
  thread: "attention" when a proposal or question is waiting, "active" while a job is running.
- Below `lg` the same panel is the shell's right sheet, as today.
- The rail width law is unchanged (`clamp(17.5rem, 17vw, 22rem)`). Everything in §4.2 is
  designed for 280px first.

### 4.2 Panel anatomy, top to bottom

1. **Header.** The Athena name with the Sparkles glyph, a `Talk` control (voice is a mode of the
   thread, same as Today), and an icon-only "Open wide" link to `/athena`. No Back button, no
   counts, no lifecycle buttons.
2. **Working strip.** Present only when at least one job is running or waiting. A collapsible
   list of rows: objective, one-line status ("Reading 14 tasks in Launch plan"), and a state dot.
   A row that needs the person shows the decision inline (approve / reject / answer) when it fits,
   and otherwise scrolls the thread to its card. Pause and Cancel live in each row's overflow menu.
3. **Thread.** The one personal conversation, newest at the bottom, with day dividers. Entry
   kinds:
   - the person's message (right-aligned bubble, with a small "from Launch plan" caption when it
     was sent with a page context);
   - Athena's reply (left-aligned, streamed);
   - a quiet work chip ("Searched tasks · 12 results") with an optional MCP app card below it;
   - a **job card**: objective, live status line, progress of steps, the decision block when one
     is pending, and a receipt when finished. This is the current workbench reduced to a card;
   - a **proposal group** (`ProposalGroupCard`, unchanged);
   - a **question** (`ElicitationCard`, unchanged);
   - a **heads-up** posted by Athena (§4.5).
4. **Composer.** One shared `AthenaComposer` primitive (§4.4). Above the textarea sits the
   **context chip**: "On: Launch plan · Project", with an × to drop it for this message and a
   click to re-attach the current page. Attach and Talk sit in the composer's trailing controls.
   Enter sends; Shift+Enter breaks a line.

Empty thread: the composer plus three suggestions drawn from the current page (§4.5). The
suggestions are buttons that fill the composer. There is no instructional paragraph.

### 4.3 Context model

- The shell publishes a `PageContext`: `{ workspaceId, workspaceName, source? }` where `source`
  is the existing `PersonalAthenaSource` (`task | project | initiative | program | calendar_item |
stream_event`, with a label). Detail routes and the calendar drawer register their source; list
  routes register the workspace and, when rows are selected, the selection as a
  `selection` source with a count.
- `AthenaPanelProvider` keeps the thread, the draft, and the "chip attached" boolean across
  navigation. Only the published `PageContext` changes on a route change.
- A message carries its context reference. The API already accepts `context` on a personal chat
  message; the activity stores it so the thread can caption "from Launch plan" and so a later
  reader knows what "this" referred to.
- Menu entries such as "Ask Athena about this" open the panel with the chip pre-attached and the
  composer focused. They never open a separate form.

### 4.4 One composer

`AthenaComposer` lives in `apps/web/src/components/athena/` and is used by the rail panel, the
wide `/athena` view, and Today's expanded session. It owns: the context chip, mention insertion,
attachments, the Talk control, the send button, and the streaming "Athena is working" state.
Today's resting prompt keeps its Task / Athena segmented control. In Athena position it sends into
the personal thread and expands in place as it does now, using this composer inside the expanded
session.

### 4.5 Initiative

- **Page-aware suggestions.** A small pure function maps a `PageContext` to three prompts. A
  project page suggests "What is at risk in this project?", "Summarize what changed this week",
  "Draft an update for the team". A task suggests "Break this into steps", "Find related work",
  "What is blocking this?". An empty context suggests the day: "Plan my afternoon", "What needs
  me today?", "What did I finish this week?".
- **Heads-up entries.** Athena posts a short entry into the thread when a job it runs needs the
  person, when a proposal has waited longer than a configurable threshold, and when the current
  page has an overdue or blocked item the person owns. Each heads-up is one sentence with one
  action. Thresholds and the on/off switch are per-user settings under Settings › Athena, on by
  default.

### 4.6 Delegated work

- A job is created when the person asks for something Athena decides is long-running, or from a
  menu entry that delegates a task. Either way it appears as a job card in the thread and a row
  in the Working strip. Nothing about it lives on a separate surface.
- The card updates over the existing personal session SSE stream. The step list uses the
  existing presenter, which already strips model reasoning and folds tool payloads under
  "Technical details".
- The task the job was delegated from shows the same card in its own detail page's activity, so
  "sessions live on the task" holds without a second component.

### 4.7 The wide view

`/athena` is the same thread at full width, in two columns from `@3xl`: the conversation browser
(topics, search, date range) and the Working list on the left, the thread and composer on the
right. Connecting a tool or app moves to the composer's attach menu and to Settings › Connections;
it leaves the thread column.

### 4.8 What is removed

- `AthenaRailPanel` queue view, `AthenaRailComposer`, and the "Open full" link.
- The lifecycle button row in the workbench header. Pause / Resume / Cancel move into the job
  card's overflow menu.
- The three-lane grouping as a navigation structure. `groupAthenaQueue` remains for the Working
  strip's ordering.
- Web use of the org-scoped chat route. Today's session reads the personal thread through the
  same hook as the rail.
- The "Start Athena from Today or from a piece of work" empty-state copy.

## 5. Delivery plan

Each phase ships on its own, passes the design-review rubric, and leaves the product coherent.

### Phase 0: Context spine

Objective: the panel survives navigation and knows the page, with no visible redesign yet.

- Add `PageContextProvider` to the shell and `usePublishPageContext` for detail routes, list
  routes, and the calendar drawer.
- Change `AthenaPanelProvider` so navigation updates context only. Remove the effect that clears
  selection and draft on `locationKey`.
- Add `usePersonalThread` (thread query + SSE tail while a turn is in flight) to
  `apps/web/src/lib/athena/`, modelled on the org chat hook, against the personal conversation
  route.
- Render the context chip in the existing composers as the only visible change.

Validation: unit tests for the context reducer and the provider's navigation behaviour; a
Playwright journey that opens the panel, navigates across three routes, and asserts the draft and
selected thread persist.

### Phase 1: The companion thread

Objective: ⌘J opens a conversation.

- Build `AthenaComposer` and `AthenaThread` (entry renderers extracted from
  `athena-conversation.tsx`, with the personal thread as the source).
- Replace `AthenaRailPanel`'s body with header + thread + composer. Delete the queue view and
  the launch composer. Replace "Open full" with the icon-only "Open wide".
- Page-aware suggestions on an empty thread.
- Move Athena to the first rail slot; derive `RailPanelStatus` from the thread.
- Point Today's expanded session at the personal thread and the shared composer.

Validation: design review of the rail at 1024, 1440, and 390 widths in both themes with a
populated thread; a11y pass on the composer and chip; journey test for "Ask Athena about this"
from a task menu landing in the panel with the chip attached.

### Phase 2: Work inline

Objective: delegated work lives in the thread.

- Reduce `AthenaWorkbench` to `AthenaJobCard`: objective, live status, steps, decision block,
  receipt, overflow menu with Pause / Resume / Cancel.
- Add the Working strip to the panel and the Working list to the wide view.
- Render `ElicitationCard` and `ProposalGroupCard` as thread entries where they are raised.
- Rebuild `/athena` as the wide view (§4.7). Move "Connect a tool or app" to the attach menu.
- Show the job card on the source task's detail page.

Validation: journey tests for delegate → card appears → decision in strip → receipt in thread;
SSE reconnect test with `Last-Event-ID`; design review of the wide view and of a 280px panel
holding a job card with a pending decision.

### Phase 3: Initiative

Objective: Athena speaks first.

- Heads-up entries from the API for the three triggers in §4.5, with per-user thresholds and
  switch under Settings › Athena.
- Suggestions read live data (overdue count, blocked items) for their wording.

Validation: API tests for each trigger and for the switch; a journey test that a waiting proposal
produces a heads-up and the icon status changes.

### Phase 4: Retirement and consistency

- Delete dead code from the old panel and workspace, the org-scoped chat hook's web callers,
  and any test fixtures that only served the queue.
- Update `docs/design/surface-inventory.md`, `docs/core/mvp-plan.md` §4 and §8.6, and
  `docs/engineering/specs/athena-agent.md` to describe the companion.
- Run the full design-review audit and record it under `docs/design/audits/`.

## 6. Files to modify

| Area                 | Files                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                | `apps/web/src/components/app-shell-frame.tsx`, `packages/ui/src/components/shell/ShellAside.tsx` (panel order only)                                                                                                          |
| Provider and context | `apps/web/src/components/athena/athena-panel-provider.tsx`, new `apps/web/src/components/athena/page-context.tsx`                                                                                                            |
| Thread and composer  | `apps/web/src/components/athena/athena-conversation.tsx` (split into `athena-thread.tsx`, `athena-composer.tsx`, `athena-entry.tsx`), new `athena-job-card.tsx`, new `athena-working-strip.tsx`, new `athena-suggestions.ts` |
| Data                 | `apps/web/src/lib/athena/chat-defs.ts` (personal thread hook), `apps/web/src/lib/athena/query-defs.ts`, `apps/web/src/lib/athena/presentation.ts`                                                                            |
| Wide view            | `apps/web/src/components/athena/athena-workspace.tsx`, `apps/web/src/app/(app)/athena/page.tsx`                                                                                                                              |
| Today                | `apps/web/src/components/today/today-session.tsx`, `apps/web/src/components/today/today-prompt.tsx`                                                                                                                          |
| Entry points         | `apps/web/src/components/athena/athena-context-action.tsx`, task / project / initiative detail headers, `apps/web/src/components/calendar/item-drawer/calendar-item-workspace.tsx`                                           |
| API                  | `apps/api/src/routes/me-athena.ts` (heads-up entries, context on activities), `apps/api/src/routes/me-athena-context.ts`, settings for thresholds                                                                            |
| Docs                 | `docs/core/mvp-plan.md`, `docs/engineering/specs/athena-agent.md`, `docs/design/surface-inventory.md`, `docs/WORKLOG.md`                                                                                                     |

## 7. Risks

- **280px is tight for a job card with a decision.** Mitigation: the strip row shows the decision
  when it fits and otherwise scrolls to the card; the card's steps collapse by default.
- **Streaming and polling can double-deliver.** The org chat hook already dedupes by activity id;
  the personal hook reuses that logic and the SSE `Last-Event-ID` contract.
- **Context leakage across workspaces.** A message sent with a chip from workspace A must resolve
  grants in A on the server. The engine already resolves the actor per tool call; the client only
  passes a reference. Tests cover a chip from a workspace the person has since left.
- **Heads-up noise.** Thresholds are conservative by default (a proposal waits an hour before a
  heads-up) and every trigger has a switch.
- **The thread grows without bound.** The conversation browser (topics, search, dates) already
  exists and moves to the wide view; the panel loads the newest window and pages backward.

## 8. Decisions to confirm

1. **Athena first in the rail, and default when something is pending.** Agenda remains default
   on a quiet day. Alternative: Athena always default.
2. **Job lifecycle controls in an overflow menu.** Pause / Resume / Cancel leave the card header.
   Alternative: keep Cancel visible on a running card.
3. **Connect a tool or app leaves the thread.** It lives in the composer's attach menu and in
   Settings › Connections. Alternative: keep the link under the composer.
4. **Heads-ups on by default** with an hour threshold for a waiting proposal. Alternative: off
   until the person turns them on in Settings › Athena.

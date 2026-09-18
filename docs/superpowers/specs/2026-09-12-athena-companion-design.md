# Athena companion: design and delivery plan

> **Status**: Proposed, awaiting product decisions (see "Decisions to confirm")
> **Date**: 2026-09-12
> **Replaces**: the utility-rail Athena panel (`AthenaRailPanel`), the "Start this work" launch
> composer, and the job-queue framing of `/athena`
> **Companions**: `docs/engineering/specs/athena-agent.md` (the engine), `docs/core/mvp-plan.md`
> §4 and §8.6 (the product promise), `docs/design/audits/2026-07-15-personal-athena.md` (what
> shipped and why)
> **Mockups**: https://claude.ai/code/artifact/d2d831f2-3cf7-4fdd-b049-218198bd20d9 (six
> artboards: the rail beside a project, the wide view with the Work ledger, a job card on a task,
> and the panel's empty, working, and heads-up states; tokens lifted from `packages/ui`)

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

### 2.1 Principles: intuitive, AI-first, human-oriented

The brief in one sentence. Each principle below is a rule the design is checked against, with
the concrete consequence for Athena.

**AI-first** means Athena is the default way to get something done, present on every surface,
already holding the context, and willing to go first.

1. **Ask before you click.** Anything a person can do by clicking, they can ask for in plain
   words, and the result lands exactly where the click would have put it. The composer is the
   primary control on every surface.
2. **Ambient, not summoned.** Athena knows the open page, the selection, and the person's day
   without being told. Context is shown as a chip so it is visible and removable, never assumed
   in silence.
3. **Initiative with restraint.** Athena speaks first about the one thing that matters, in the
   thread, with one action attached. One unread heads-up at a time; the rest fold into a digest.

**Human-oriented** means the person stays the author, the decider, and the one the product
speaks to.

4. **Show the thing, not a description of it.** Outcomes render as the real object: a ghost row
   on the page, a drafted email you can read, a receipt with what changed. A sentence saying
   "I moved two tasks" is never the only evidence.
5. **Human words only.** No session, job, tool, execute, or run in anything a person reads. The
   surfaces say what Athena did, what she is doing, what needs you, and what she used. Raw tool
   detail stays behind a disclosure labelled "What Athena used".
6. **Reversible by default, gated when it matters.** Changes inside Docket carry Undo on the
   receipt. Actions that leave Docket (send, post, pay) get a Review step with the real content
   before anything goes out. Two classes, two treatments, and the approval dial moves toward
   autonomy as trust builds.
7. **Beside you, never over you.** Athena lives in the panel, in ghost rows, and in cards on
   the work. She never opens a modal, takes over a page, or moves the person somewhere else.
8. **Honest at every step.** Every action leaves a receipt. A failure says what did not happen
   and what Athena needs. Success is never claimed for work that did not run.
9. **Attributed to a person.** Every change reads "Athena, on behalf of you". Teammates see the
   change with that attribution; the thread itself is visible only to its owner.

**Intuitive** means no new vocabulary and one obvious way to do each thing.

10. **One composer, one thread, one set of words** across the rail, the wide view, and Today.
    Only one composer is active on a screen at a time.
11. **One Athena entry per surface.** The composer and a single "Ask Athena" action. Sparkles
    on every field is AI everywhere, and AI everywhere is the opposite of AI-first.
12. **It behaves like a capable colleague.** Terse replies that lead with the answer, numbers
    you can check, progress that names the object ("Drafting email 2 of 3"), and a question
    only when the answer changes what happens next.

### 2.2 Where the draft design falls short of these

- Proposals were shown only as cards in the thread. Principle 4 puts them on the page as ghost
  rows that settle on approval; the card is where the decision is made, the page is where it
  shows. Added to §4.6 and Phase 2.
- Sending drafted emails was shown with an inline Approve. Principle 6 makes that a Review with
  the drafts readable first. The job card's decision block gains a Review action for outward
  actions.
- Receipts had no Undo. Principle 6 adds it to every in-Docket change, using the API's existing
  undo.
- "Job" and "Technical details" appeared in UI copy. Principle 5 renames them: the card has no
  type label, and the disclosure reads "What Athena used".
- Status lines said "Started 2 min ago". Principle 12 makes them name the object and the
  progress.
- Home could show two composers at once. Principle 10 demotes the page prompt while the panel
  is open.

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
   thread, same as Today), and an icon-only "Open the Athena page" link to `/athena`. No Back
   button, no counts, no lifecycle buttons.
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
   - a **proposal group** (`ProposalGroupCard`): one line per change, in plain words ("Set state
     to In Progress") rather than the raw tool name, with a single `Approve` / `Reject` pair and
     a checkbox only when the group holds more than one change;
   - a **question** (`ElicitationCard`, unchanged);
   - a **heads-up** posted by Athena (§4.5).
4. **Composer.** One shared `AthenaComposer` primitive (§4.4). Above the textarea sits the
   **context chip**: "Launch plan · Project" — the chip names the page and its kind — with an ×
   to drop it for this message and a click to re-attach the current page. Attach and Talk sit in
   the composer's trailing controls. Enter sends; Shift+Enter breaks a line.

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
  existing presenter, which already strips model reasoning and folds tool payloads under a
  disclosure, relabelled "What Athena used".
- While a proposal waits, the affected items render as ghost rows on the page they belong to,
  and settle into real rows when approved. The card is where the decision is made; the page is
  where its consequence shows.
- Decisions come in two classes. Changes inside Docket run on Approve and carry Undo on the
  receipt. Actions that leave Docket (sending an email, posting to a connected service, paying)
  show Review, which opens the real content for reading and editing before anything goes out.
  Undo sits on the finished step that recorded the change as well as on the receipt, and Review
  toggles the same primary button to Approve once the outward call's raw fields (`to`, `subject`,
  `body` first) have been expanded for reading.
- A running card accepts a Reply: the message quotes the card and steers that work, and Athena
  acknowledges it in the step list.
- The task the job was delegated from shows the same card in its own detail page's activity, so
  "sessions live on the task" holds without a second component.

### 4.7 The wide view

`/athena` is the same thread at full width, in two columns from `@3xl`: the conversation browser
(topics, search, date range) and the **Work ledger** on the left, the thread and composer on the
right. Connecting a tool or app moves to the composer's attach menu and to Settings › Connections;
it leaves the thread column. In the delivered left column the connections panel sits under the
Work ledger, beneath the conversation browser — the same left-hand rail the browser and ledger
already share, rather than a fourth surface of its own.

The Work ledger answers "what has Athena done for me?" without reinstating the queue as the front
door. It lists every job with three filters: Running, Needs you, Done. Done sorts newest first and
each row shows the objective, the receipt's one-line summary, and the date. Clicking any row jumps
to that job's card in the thread. The panel never shows this list; in the panel, past work is
reached by scrolling the thread, and the wide view is where a person goes to look back.

### 4.8 Where ongoing and past work are visible

| Question                      | Panel                                                   | Wide view                                 | Task or project page                |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| What is Athena doing now?     | Working strip rows; job card in the thread; icon status | Work ledger › Running; card in the thread | Job card on the task's Activity     |
| What needs me?                | Strip row with inline decision; card's decision block   | Work ledger › Needs you; heads-up entry   | Card's decision block               |
| What did Athena do last week? | Scroll back; receipt cards collapsed to their summary   | Work ledger › Done; topics; search; dates | Receipt on whatever the job touched |

### 4.9 What is removed

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
  the launch composer. Replace "Open full" with the icon-only "Open the Athena page" link.
- Page-aware suggestions on an empty thread.
- Move Athena to the first rail slot; derive `RailPanelStatus` from the thread.
- Point Today's expanded session at the personal thread and the shared composer.

Validation: design review of the rail at 1024, 1440, and 390 widths in both themes with a
populated thread; a11y pass on the composer and chip; journey test for "Ask Athena about this"
from a task menu landing in the panel with the chip attached.

### Phase 2: Work inline

Objective: delegated work lives in the thread.

- Reduce `AthenaWorkbench` to `AthenaJobCard`: objective, live status that names the object and
  its progress, steps, decision block, receipt with Undo per in-Docket change, a Reply
  affordance that steers the running job, and an overflow menu with Pause / Resume / Cancel.
- Add the Working strip to the panel and the Work ledger (Running / Needs you / Done) to the
  wide view's left column, each row jumping to its card in the thread.
- Render `ElicitationCard` and `ProposalGroupCard` as thread entries where they are raised.
- Render pending proposals on the open page as ghost rows (the existing ghost grammar), settling
  with a view transition on approval; hovering a card's affected items highlights them on the
  page.
- Split decisions by class: in-Docket changes get Approve with Undo on the receipt; outward
  actions (send, post, pay) get Review, which opens the real content before anything leaves.
- Rebuild `/athena` as the wide view (§4.7). Move "Connect a tool or app" to the attach menu.
- Show the job card on the source task's detail page.
- Demote Today's page prompt while the panel is open so one composer is active per screen.

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

---
surfaces: ['today', 'orgs-[orgId]-projects-[projectId]', 'orgs-[orgId]-tasks-[taskId]', 'athena']
date: 2026-09-18
verdict: below-bar
scores:
  brand: 2
  typography: 2
  spacing: 1
  hierarchy: 1
  color: 2
  motion: 2
  states: 1
  detail: 2
gates:
  a11y: false
  responsive: true
  theme-parity: true
  no-placeholder: false
  screenshots: true
---

# Design review: the Athena companion — 2026-09-18

The owner's words for this surface are "the UI looks like trash and is extremely confusing", "I
have no idea what's going on", "the task detail screen is extremely difficult to glance and a
mess", "nested things within nested things", "too many fixed parts", "min widths so tiny". This
review takes that as the brief and tests it. Most of it holds, and the measurements below say why.
One thing does not: the Athena components carry **zero drawn borders**, verified by walking the
computed style of every element on four surfaces. The borders the owner still sees are real, but
they come from shared primitives and from the task page around the panel, not from Athena.

## Evidence

Captured against the worktree dev stack (`docs/engineering/ui-verification.md`, `DOCKET_DEV_PORT=1375`)
with a seeded account: one project (`Launch plan`) with two tasks, one delegated job with a
project source, one with a task source, one of them approved so a finished entry exists. Shots are
not committed — `apps/web/.data/` is gitignored — and live at
`apps/web/.data/design-review/2026-09-18-audit/`.

| #   | File                                           | What it shows                                                |
| --- | ---------------------------------------------- | ------------------------------------------------------------ |
| 1   | `1-today-rail-empty-thread-1440x900-light.png` | A fresh account's `/today`, rail open, nothing in the thread |
| 2   | `2-today-rail-waiting-job-1440x900-light.png`  | `/today` with one finished and one waiting piece of work     |
| 3   | `3-project-tasks-rail-1440x900-light.png`      | The project's Tasks tab with the rail open                   |
| 4   | `4-task-rail-closed-1440x900-light.png`        | A task page scrolled to its Athena block, rail closed        |
| 5   | `5-task-rail-open-1440x900-light.png`          | The same task page with the rail open                        |
| 6   | `6-athena-wide-1440x900-light.png`             | `/athena`, the wide view, rail open                          |
| 7   | `7-project-rail-700px-1440x900-light.png`      | The rail dragged to 700px on the project page                |
| 8   | `8-today-sheet-390x844-light.png`              | The same panel as the shell's right sheet at phone width     |
| 9   | `9-task-390x844-light.png`                     | The task page's Athena block at phone width                  |
| A   | `A-today-rail-waiting-job-1440x900-dark.png`   | Shot 2 in dark, for the theme gate                           |
| B   | `B-athena-wide-1440x900-dark.png`              | Shot 6 in dark, for the theme gate                           |

Measurements come from three instrumented passes over the same stack: a computed-style border walk
over every element on `/today`, the task page, `/athena`, and the project page; a geometry and type
pass over the rail; and an overflow sweep at 320, 390, 768, 1024, 1440, and 1920.

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 2     | Register is right (Plex, MD3 tokens, neutral surfaces) but the panel narrates itself. On shot 1 the word "Athena" appears four times in one screen: sidebar item, rail header, the empty state's avatar-circle title, and the `Plan today with Athena` button. The empty state's entire content is the product's own name (`athena-conversation.tsx:67`, `:434`). The wide view says "Tools & apps", "Nothing connected yet.", "Connect a tool or app", and a dialog that reads "Add a remote MCP server so Athena can use its tools" (`athena-conversation.tsx:355-359`) — MCP and "tools" are the exact vocabulary §2.1 principle 5 bans. |
| 2. Typographic craft              | 2     | Five sizes inside a 420px panel: badge 11/500, "N steps" 12/500, status line 14/400, decision heading 14/500, objective 16/500. Two of them carry the **same string**: "Set state to In Progress" renders at 14/400 and again 60px below at 14/500, so weight is the only thing distinguishing a status line from a heading. On the task page the section heading for Athena is `text-label-small` (12px) — smaller than the badge inside the card it labels (`task-activity-feed.tsx:65`).                                                                                                                                                 |
| 3. Spatial rhythm & density       | 1     | Two separate pieces of work are 16px apart; the gap _inside_ one piece of work is 12px (`athena-conversation.tsx:530` `gap-4` vs `athena-job-card.tsx:129` `gap-3`). A 4px difference is the only thing that says where one job ends. Below them sits 248px of measured void before the composer. The "N needs you" band takes a full 32px row for a 102px control. At a 700px rail nothing reflows — the same one-column stack, with a 660×180 composer slab holding a 14px placeholder (shot 7).                                                                                                                                          |
| 4. Hierarchy & information design | 1     | Nothing on shot 2 is primary. The identical job card is rendered **twice in one document** on `/athena` and on a task page with the rail open — 8 duplicate DOM ids on `/athena`. The rail is 420px against a 460px `<main>` at 1024px: the assistant is 91% as wide as the entire work area. Two composers are live on `/today` at once. "Needs you" is signalled three times — activity-bar dot, "1 needs you" band, and the card's own badge.                                                                                                                                                                                            |
| 5. Color discipline               | 2     | Token-pure: no hardcoded hex or oklch in any Athena component, and the earned colors are correct (blue for a waiting decision, neutral for done). Both themes resolve correctly (`Done` badge is 6.8:1 in both). Deducted for the empty state: three full-width `primary-container` slabs are the loudest thing on a fresh `/today` and compete directly with `Plan today with Athena` in `<main>` (`conversation-suggestions.tsx:33-41`, shot 1).                                                                                                                                                                                          |
| 6. Motion & feedback              | 2     | The rail's collapse arms its width transition only for the toggle and clears it after — genuinely careful. But the loading state is three chat bubbles (`athena-conversation.tsx:410-415`) that match nothing a job entry looks like; "Athena is working…" is an italic paragraph appended below the thread rather than in-place feedback (`:559`); and approving a decision on a job card re-renders the entry with no transition at all — the ghost grammar's `view-transition-name` is on `ProposalGroupCard` rows only (`proposal-group-card.tsx:272`).                                                                                 |
| 7. States completeness            | 1     | The finished entry reads "Moved the task to In Progress and verified the board reflects it." while the underlying call returned `{"content":"This action could not be completed.","isError":true}`. That is the honesty principle inverted on the one surface that exists to report what happened. The finished entry also carries no receipt rows and no Undo. `Running 0` renders a zero count. "Tools & apps / Nothing connected yet." is a dead band. "N steps" is unconditionally plural (`job-card-steps.tsx:223`).                                                                                                                   |
| 8. Detail craft (squint test)     | 2     | **Zero borders inside every Athena component** — verified, and it is the one thing on this surface that is already right. Against it: duplicate `id` and `aria-labelledby` values; the "N steps" trigger is 63×16 with the browser's default outline instead of the shared `focusRing`; the overflow menu appears on the waiting entry and not the finished one; the mobile sheet paints a second, empty 40px header row under the sheet's own title.                                                                                                                                                                                       |

Gates: A11y ❌ · Responsive ✅ · Theme parity ✅ · No placeholder ❌ · Screenshots ✅

- **A11y ❌** — the step disclosure is a 16px-tall target using the UA outline
  (`job-card-steps.tsx:222`), under the 40px mobile floor and outside the shared focus system; the
  proposal row's selection control is a raw 16px `<input type="checkbox">` rather than the shared
  `Checkbox` (`proposal-group-card.tsx:293`); duplicate ids break `aria-labelledby` resolution and
  every `getElementById` scroll target on `/athena` and the task page.
- **Responsive ✅** — `scrollWidth === clientWidth` on `/today`, `/athena`, and a task page at 320,
  390, 768, 1024, 1440, and 1920.
- **Theme parity ✅** — dark verified (shots A, B); `Done` clears AA in both, and Approve/Reject keep
  their relative weight across schemes.
- **No placeholder ❌** — the finished entry claims a success that did not happen (finding 3).

---

## Findings, ordered by severity

### 1. The same job card renders twice in one document

`/athena` at 1440 with the rail open paints the entire thread twice, side by side, pixel for pixel:
two `Done` cards, two `Needs you` cards, two Approve/Reject pairs, two composers (shot 6). A task
page with the rail open paints that task's delegated work twice (shots 4, 5). Instrumented, there
are 8 elements with duplicated ids on `/athena`:

```
athena-job-<id>        ×2   (w 641 at x 280, w 388 at x 980)
athena-job-<id>-title  ×2
```

Two consequences beyond the visual one. `document.getElementById` returns document order, so the
rail's own "1 needs you" jump (`athena-rail-conversation.tsx:110`) and the heads-up's Review
(`heads-up-entry.tsx:42`) scroll the copy in `<main>`, not the one in the panel the person is
looking at. And `aria-labelledby` resolves to the wrong node for one of the two.

- `apps/web/src/components/athena/athena-job-card.tsx:111-112` — `articleId`/`titleId` are derived
  from the job id alone, with no host scope.
- `apps/web/src/components/athena/athena-workspace.tsx:169-185` — the wide view renders the same
  merged thread the docked rail is already rendering.
- `apps/web/src/components/task-detail/task-activity-feed.tsx:58-73` — `TaskAthenaWork` renders
  `AthenaJobCard` for jobs the rail's global queue is also rendering.

**Fix:** exactly one live copy of a piece of work per document. See "What to build instead" §5.

### 2. Two pieces of work are less separated than the parts of one

Measured on shot 2: the gap between two `<article>` entries is **16px**; the gap between a job's own
title and its status line is **12px**. Nothing else separates them — no rule (correctly), no tonal
step, no inset, no timestamp, no left gutter. The result is one 380px column of alternating bold and
grey lines that reads as a single malformed block.

- `apps/web/src/components/athena/athena-conversation.tsx:530` — `gap-4` on the thread scroller.
- `apps/web/src/components/athena/athena-job-card.tsx:129` — `gap-3` inside the entry.
- `apps/web/src/components/athena/thread-entries.tsx:50-54` — the job entry is a bare `div`, so a
  work entry and a chat bubble share one gap vocabulary despite being different kinds of thing.

The same arithmetic makes the rail's own tonal containment invisible. Computed backgrounds:

```
rail     lab(99.40 …) light   lab(14.68 …) dark
main     lab(99.40 …) light   lab(14.68 …) dark
gutter   lab(96.48 …) light   lab(10.62 …) dark
```

The rail and `<main>` are the **same tone**. `ShellAside.tsx:418-423` says "the surface step off the
canvas carries the separation"; there is no step. In dark the only separation is an 8px gutter
4 L\* away from both sides.

### 3. A finished entry claims work that failed

The approved job's status line reads "Moved the task to In Progress and verified the board reflects
it." Its only action activity holds:

```json
{ "result": { "content": "This action could not be completed.", "isError": true } }
```

The session is nonetheless `status: completed`, the badge says `Done`, and there is no receipt row
and no Undo. `finishedStatusLine` prefers `detail.result.summary` and then the newest step's own
text — neither consults whether the step succeeded.

- `apps/web/src/lib/athena/job-presentation.ts:141-148` — `finishedStatusLine` has no error branch.
- `apps/web/src/components/athena/job-card-parts.tsx:466-476` — `jobReceiptPresentation` returns
  `show: false` when the result carries no rows, so a finished job with a failed step shows nothing
  at all below its status line.
- `apps/web/src/lib/athena/job-presentation.ts:38-43` — `Done` is derived from lifecycle status
  alone; there is no tone for "finished, but nothing happened".

This is the `no-placeholder` gate: success presented for work that did not run.

### 4. The status line and the decision heading are the same string

Shot 2 shows "Set state to In Progress" at y=294 and again at y=354. They are the same value by
construction:

- `apps/web/src/lib/athena/job-presentation.ts:154-166` — `openStatusLine` returns
  `decisionSentence(detail)` whenever a decision is pending.
- `apps/web/src/components/athena/job-card-parts.tsx:497-501` — `JobDecision`'s `title` is
  `decisionSentence(detail)`.

Between them sits the "2 steps" disclosure, so the duplicate is not even adjacent — it reads as a
render bug. A waiting entry therefore spends three of its six lines saying the same thing twice.

### 5. The panel is not two fixed regions; it is up to five

§4.2 says two, and `athena-rail-conversation.tsx:5-12` claims two. Rendered:

| Region            | Source                                 | Height                |
| ----------------- | -------------------------------------- | --------------------- |
| Header            | `athena-rail-conversation.tsx:80-100`  | 40px                  |
| "N needs you"     | `athena-rail-conversation.tsx:105-117` | 32px, conditional     |
| Thread            | `athena-conversation.tsx:530`          | scrolls               |
| Error             | `athena-conversation.tsx:565-569`      | conditional           |
| Pending questions | `athena-conversation.tsx:571`          | conditional, can grow |
| Composer          | `athena-conversation.tsx:574-588`      | 164px                 |

The questions queue is the worst of these: §4.2 makes a question a **thread entry**, and it is
instead a fixed band pinned between the thread and the composer, so a question raised ten minutes
ago sits below work raised ten seconds ago, permanently, outside the conversation's own order. The
heads-up slot has the mirror problem — it renders at the **top** of a newest-at-bottom scroller
(`athena-conversation.tsx:533-540`), where the auto-scroll-to-end effect immediately hides it.

At phone width the sheet adds a sixth: `useRailPresentation` drops the name but keeps the 40px icon
row, so the sheet paints its own title row _and_ an otherwise-empty band holding two right-aligned
icons (shot 8) — the double header the code comment says it avoids.

### 6. The panel outweighs the work it is supposed to sit beside

| Viewport | `<main>` | Rail  |
| -------- | -------- | ----- |
| 1024     | 460px    | 420px |
| 1440     | 700px    | 420px |

At 1024 the companion is 91% as wide as everything the person is actually working on. The floor that
permits this was lowered from 0.40 to 0.27 to accommodate a 420px default
(`packages/ui/src/components/shell/AppShell.tsx:205-213`), and the default is a plain constant
(`ShellAside.tsx:73`). The consequences are visible on shot 3: the project's task table renders
titles as "Confirm t…" and "Write the …" inside a 1000px table with an empty `Labels` column — the
owner's "min widths so tiny" is this, and the rail is what caused it.

The 700px case (shot 7) is worse: `<main>` drops to ~420px while the panel takes 700px, and the
panel does not use a single pixel of it. Every entry stays one column; the composer becomes a
660×180 slab.

### 7. The wide view never becomes wide

`athena-workspace.tsx:122` switches to two columns at `@3xl` (768px container). With the rail open
at its 420px default, `<main>` is 700px at 1440 — so `/athena` renders as a **stack**: topics,
three lane chips with counts, a connections band, a second "Athena" header, then the thread, then
the composer (shot 6). The left column's own content is capped at `max-h-[40vh]`, so it is a 360px
band the conversation starts under.

Inside that stack:

- The three-lane grouping (`Running 0 · Needs you 1 · Done 1`) is the queue reinstated as the front
  door, which §4.9 removed (`athena-work-ledger.tsx:106-117`). A `0` count is rendered.
- "Connect a tool or app" was supposed to move to the composer's attach menu (§4.7). It is in the
  left column _and_ in the composer's Cable button — two entries for one thing
  (`athena-workspace.tsx:152-154`, `athena-conversation.tsx:314-325`).
- The page paints a second "Athena" name-and-Talk header (`athena-workspace.tsx:157-167`) beside
  the rail's own.

### 8. The task page's Athena block is an orphan

Shot 4: between "Load attachments and dependency map" and "Activity" sits a 12px grey word,
"Athena", and then a 1100px-wide job card with a 11px badge, a 16px title, and 700px of empty space
to its right. There is no containment, no heading weight, no relationship to the task, and the same
card is in the rail 500px away.

- `apps/web/src/components/task-detail/task-activity-feed.tsx:64-65` — `<section aria-label="Athena">`
  with an `h2` at `text-label-small`.
- `apps/web/src/components/task-detail/task-activity-feed.tsx:66-70` — full-width `AthenaJobCard`,
  the same component tuned for a 388px rail.

The idea is right (§4.6: work shows where the work lives). The execution is a rail component
dropped into a 1100px column with a whisper for a label.

### 9. The composer never yields, so `/today` runs two of them

Principle 10 says one composer per screen, and §4.9 says Today's prompt demotes while the panel is
open. What "demote" does today is change the placeholder to "Add a task" and hide the Task/Athena
toggle (`apps/web/src/components/today/today-prompt.tsx:109-138`). The prompt is still a
600×120 tonal slab with its own send button, 380px from a 388×164 tonal slab with its own send
button (shots 1, 2). Two identical-looking inputs, one screen.

### 10. Self-describing and system copy that should not exist

| Copy                                                                         | Where                                   |
| ---------------------------------------------------------------------------- | --------------------------------------- |
| An empty state whose only content is the word "Athena"                       | `athena-conversation.tsx:67-68`, `:434` |
| "· Workspace" appended to the context chip on every non-detail page          | `athena-context-chip.tsx:48`            |
| "Athena is working…", italic, appended below the thread                      | `athena-conversation.tsx:557-561`       |
| "Add a remote MCP server so Athena can use its tools and show interactive…"  | `athena-conversation.tsx:355-359`       |
| "Tools & apps" / "Nothing connected yet." as a standing band                 | `athena-workspace.tsx:152-154`          |
| "Heads-up" as a label above the sentence it labels                           | `heads-up-entry.tsx:35`                 |
| "N steps", always plural, so a one-step job reads "1 steps"                  | `job-card-steps.tsx:223`                |
| "Details" opening a `<pre>` of `JSON.stringify(entry.technical)`             | `job-card-steps.tsx:180-188`            |
| "Plans, briefs, folders, and external references." under a Resources heading | task page, shots 4, 5, 9                |
| "Load attachments and dependency map" as a user-facing control               | task page, shots 4, 9                   |

### 11. Every border that survives

Verified by computed style on `/today`, the task page, `/athena`, and the project page. **None are
in Athena's own components.** The full list:

| Element                                                                                                                                         | Source                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The task comment form, 1px `outline-variant` box directly under the Athena block                                                                | `apps/web/src/components/task-detail/task-activity-feed.tsx:276`  |
| `In Progress`, `No priority`, `Assign`, `Expand`, `All activity`, `Load attachments and dependency map`, `Add task with details`, pager buttons | `packages/ui/src/primitives/button.tsx:60-61` (`outline` variant) |
| Task-table selection checkboxes, 2px `border-outline`                                                                                           | `packages/ui/src/primitives/checkbox.tsx:84`                      |
| Task graph node cards and their react-flow handles                                                                                              | project Tasks tab, shot 3                                         |
| The `Skip to content` link (sr-only until focused)                                                                                              | shell layout                                                      |
| Athena mail rows, `border-b`                                                                                                                    | `apps/web/src/components/athena/mail-inbox.tsx:183`               |
| Voice phone-number rows, `border-b`                                                                                                             | `apps/web/src/components/athena/voice-phone-numbers.tsx:629`      |
| MCP resource frame, `border`                                                                                                                    | `apps/web/src/components/athena/mcp-app-view.tsx:665`             |

`button.tsx:60-61` is the load-bearing one: it is a whole variant of drawn 1px chips, and the task
page uses six of them within 700px of vertical scroll. Design-system §8 permits a border only for a
field's affordance, a focus indicator, or a genuine semantic boundary — a button is none of those.

### 12. Smaller things, still wrong

- The rail's queue read is global (`athena-rail-conversation.tsx:71`,
  `query-defs.ts:198-208` — `personalAthenaQueueDef` takes no workspace). Every job from every
  workspace is merged into the thread on every page. Only the wide view filters
  (`athena-workspace.tsx:66-68`).
- The overflow menu is present on a waiting entry and absent on a finished one
  (`athena-job-card.tsx:140-146` via `job-card-parts.tsx:75`), so the affordance's position is unpredictable.
- `Reply` is a bare ghost button floating below the decision with no grouping
  (`job-card-parts.tsx:367-394`).
- Project task rows render `Unknown` with a `UN` avatar for tasks assigned to the signed-in person
  (shot 3).
- The project Tasks tab shows the same two tasks twice: once in the table, once as cards on a dot
  grid below it (shot 3).
- The sidebar lists `Tasks` and `Stream` twice, in two sections, on every shot.

---

## What to build instead

Five changes, in order. Each is shippable alone and leaves the product coherent.

### 1. One work entry, one anatomy, four states

Delete `AthenaJobCard`'s current body and rebuild it as a **list row with a body**, not a card. It
renders identically in the rail (388px), the wide view (641px), and a task page (1100px, capped).

Shared geometry, every state:

```
padding      12px 0
inset        0 (the thread's 16px inset is the only horizontal inset)
left gutter  24px reserved for the state dot; every line below the title
             aligns to x=24 inside the entry
row gap      8px between the lines of one entry
entry gap    32px between entries      ← 2× the 16px it is today
max width    640px (the entry never grows past a comfortable measure,
             which is what stops the 1100px task-page version)
```

The 24px left gutter and the 32px entry gap are the whole separation system. No box, no tint, no
rule. Two entries 32px apart with a hanging dot column read as two things; two entries 16px apart
with no gutter do not.

**Line 1 — the title line.** `title-small` (14/20, 600), one line, `truncate`. Preceded by an 8px
state dot in the gutter, vertically centred on the first line's cap height. Trailing: the relative
time in `label-small` (11/16) `tabular-nums` `on-surface-variant`, then the overflow trigger — a
32×32 `ghost` icon button that is **always present**, disabled when it has nothing to offer, so its
position never moves. Delete the `Badge`; the dot plus line 2 carry the state.

**Line 2 — the state line.** `body-small` (12/16) `on-surface-variant`. One sentence. It is the only
place state is written, and it differs per state:

| State    | Dot                                                             | Line 2                                                                |
| -------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| waiting  | `primary`, solid                                                | `Waiting on you`                                                      |
| running  | `primary`, 2s pulse (off under `prefers-reduced-motion`, solid) | the progress narration, naming the object: `Drafting email 2 of 3`    |
| finished | `on-surface-variant`, 30%                                       | `Finished 4m ago · 2 changes`, or `Finished 4m ago · nothing changed` |
| stopped  | `error`, solid                                                  | `Stopped · <what did not happen>`                                     |

Delete `needsYouLabel`. Delete the `Done`/`Working`/`Needs you`/`Stopped` badge labels.

**Line 3 — the decision, waiting only.** The plain sentence of the change at `body-medium` (14/20)
`on-surface`, then a 8px gap, then the button row: `Approve` (filled, 32px, `size="sm"`) and
`Reject` (text button, 32px). `decisionSentence` is used **here and nowhere else** — line 2 says
`Waiting on you`, so the duplication in finding 4 cannot recur. For an outward action the primary
reads `Review`, expands `ProposalInputRows` inline above the row, and becomes `Approve`. This is
already how it works; only the heading goes away.

**Line 3 — the receipt, finished only.** One `body-small` line per change, `on-surface-variant`,
with the changed object's name as a link: `Confirm the pricing page copy → In Progress`. Then
`Undo`, a text button, `label-medium`. When the run changed nothing, render exactly one line:
`Nothing changed.` plus, when there was an error, what it was. Never render a `Done` entry with an
empty body.

**Line 4 — the disclosure.** One control, `label-medium` (12/16), `on-surface-variant`, in a
**40×** hit area (`min-h-10`, `-my-2` to keep the rhythm), carrying the shared `focusRing`. Label:
`3 steps` / `1 step` — pluralise it. Opened, each step is a `body-small` line in the same 24px
gutter alignment; `Details` inside a step stays, but it renders labelled key/value rows through
`ProposalInputRows`, not `JSON.stringify` in a `<pre>`.

`Reply` moves into the overflow menu beside Pause/Resume/Cancel. A running job that needs steering
is rare enough that it does not earn a permanent control under every entry.

Files: rewrite `apps/web/src/components/athena/athena-job-card.tsx` and
`job-card-parts.tsx`; delete `JobReceipt`'s title-less `<dl>` and `JobReply`'s inline form; change
`job-presentation.ts:154-166` so `openStatusLine` never returns `decisionSentence`; add an
error-aware branch to `finishedStatusLine` (`:141-148`).

### 2. The panel, top to bottom

**Two fixed regions. That is the whole rule, and it is enforceable by structure: only the header and
the composer may live outside the scroller.**

```
┌ header ─────────────────────────────── 44px, fixed ─┐
│ 16px inset · no name, no glyph                      │
│ left:  the context chip (see below)                  │
│ right: 32×32 Talk · 32×32 open wide view             │
├ thread ──────────────────────── flex-1, scrolls ─────┤
│ 16px horizontal inset, shared by every entry         │
│ 32px between entries                                 │
│ 24px left gutter inside each entry                   │
│                                                      │
│ entry kinds, all flat, all one level deep:           │
│   your message   right-aligned bubble, max 85%       │
│   Athena's reply left-aligned text, no surface       │
│   work chip      12px on-surface-variant, no pill    │
│   work entry     §1 above                            │
│   question       §1's anatomy, decision variant      │
│   heads-up       §1's anatomy, at the bottom         │
│                                                      │
│ content is bottom-aligned: with 3 entries they sit   │
│ just above the composer, not 248px above it          │
├ composer ─────────────────── 96px at rest, fixed ────┤
│ textarea rows=2, grows to 6 then scrolls             │
│ trailing row: attach · Talk · send, 32×32 each       │
└──────────────────────────────────────────────────────┘
```

Concrete changes:

- **Delete the name row.** The activity-bar icon is lit, the sheet's title says "Athena", and the
  empty state says it a third time. Nobody needs four. Move the context chip into the header, where
  it answers "what is this about?" instead of "what is this?".
- **Delete the "N needs you" band** (`athena-rail-conversation.tsx:105-117`). With a 32px entry gap
  and a solid primary dot, one waiting entry is visible from across the room. If the panel is
  scrolled away from it, show a **floating** 28px pill at the bottom edge of the thread, inside the
  scroller, that scrolls to it and disappears when it is on screen — the same affordance a chat app
  uses for "jump to latest". It costs zero fixed height.
- **Move questions into the thread** (`athena-conversation.tsx:571`). `ElicitationQueue` keeps
  presence and liveness; its cards become thread entries at their own timestamp.
- **Move the heads-up to the bottom** of the thread, not the top (`:533-540`). Newest-at-bottom is
  the order; a heads-up is the newest thing.
- **Errors** render as an entry, not a fixed band (`:565-569`).
- **Bottom-align the thread** (`justify-end` on the scroller's inner column) so a short thread sits
  where the eye already is.
- **Shrink the composer** from 164px to 96px: `rows={2}`, 8px padding, and the trailing controls on
  one 32px row. The chip leaves it for the header.
- **Empty thread**: no icon, no name, no paragraph. Three suggestions as **text buttons**, 40px tall,
  left-aligned, `body-medium`, `on-surface-variant` — not `primary-container` slabs
  (`conversation-suggestions.tsx:33-41`). They sit directly above the composer.

### 3. Make the panel fit beside the work, not instead of it

- **Default width 360px**, not 420 (`ShellAside.tsx:73`). 360 is already the documented floor and it
  is enough for the anatomy in §1; 420 is what makes `<main>` 460px at 1024.
- **Cap the drag at 480px**, not half the window (`ShellAside.tsx:121-123`). A companion that can be
  wider than the work is a companion that is not beside anything. If someone wants the conversation
  large, `/athena` is the wide view — that is what it is for.
- **Give the rail a real tonal step.** `ShellAside.tsx:423` uses `page`, which is `<main>`'s own
  tone. Use `surface-container-low` in light and `surface-container` in dark so the panel reads as a
  distinct region without a line. This is the one containment the surface needs and currently
  lacks.
- **Give the composer's textarea a `@container` breakpoint** so at ≥560px the trailing controls sit
  inline with the text instead of on their own row, and cap the entry measure at 640px so the wide
  rail stops stretching a 14px line across 660px.

### 4. Make the thread carry work, and make the ledger carry history

The thread is the right primary structure — but only for **one** thing at a time, and today it
carries the whole global queue on every page.

- Scope the rail's queue to the current workspace (`athena-rail-conversation.tsx:71`), adding a
  workspace argument to `personalAthenaQueueDef` (`query-defs.ts:198-208`). A job from another
  workspace does not belong in a thread whose context chip names this page.
- Merge only work started **in this conversation or from this page** into the thread
  (`mergeThreadEntries`, `job-presentation.ts:251-266`). Everything else is history, and history
  lives in the ledger.
- Rebuild `/athena` so the two-column layout engages on the **viewport**, not the container — a wide
  view that only becomes wide when the rail is shut is not a wide view
  (`athena-workspace.tsx:122`). Left column: conversation browser, then the Work ledger. Move the
  connections panel out entirely — `Settings › Connections` and the composer's attach menu already
  own it (`athena-workspace.tsx:152-154`).
- The ledger's three filters stay, but drop the counts, hide a lane with nothing in it, and render
  rows in §1's anatomy so a ledger row and a thread entry are recognisably the same object
  (`athena-work-ledger.tsx:106-117`).
- Delete the second "Athena · Talk" header from the thread column
  (`athena-workspace.tsx:157-167`); Talk lives in the panel header, once.

### 5. The task page: keep the block, change everything about it

The idea is right and the spec is right (§4.6). Build it as follows.

- **Move it under the task's own heading rank.** `Athena` becomes a `title-small` section heading
  (14/20, 600, `on-surface`) matching `Subtasks`, `Resources`, `Dependencies`, not a 12px
  `label-small` whisper (`task-activity-feed.tsx:65`).
- **Rename it for what it holds**: `Delegated work`. "Athena" names the agent; the section names the
  content.
- **Cap it at 640px** like every other entry, left-aligned in the column.
- **Show it only when the rail is not already showing it.** Subscribe to the shell's rail state; when
  the Athena panel is open and this job is in its thread, the task page renders a single line —
  `Athena is working on this · Open` — that focuses the rail's copy. One live card per document,
  which is finding 1's structural fix.
- **Fold it into Activity** rather than floating above it, as the newest entries in the same
  chronological feed, so the task page has one timeline instead of two adjacent stacks.
- **Delete the surrounding noise while you are in the file**: drop the bordered comment form's
  `border` (`task-activity-feed.tsx:276`) for a `surface-container-low` fill; drop
  `Load attachments and dependency map` (load it with the page or on scroll); drop the Resources
  description line.

### What to delete

| Delete                                                              | Where                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| The rail's mark-and-name row                                        | `athena-rail-conversation.tsx:85-90`                                  |
| The "N needs you" fixed band and `needsYouLabel`                    | `athena-rail-conversation.tsx:105-117`, `job-presentation.ts:219-221` |
| The state `Badge` on a work entry                                   | `athena-job-card.tsx:131-133`, `job-presentation.ts:38-43`            |
| The decision's `<h4>` heading                                       | `job-card-parts.tsx:254`                                              |
| The permanent `Reply` button                                        | `job-card-parts.tsx:367-394`                                          |
| The questions band between thread and composer                      | `athena-conversation.tsx:571`                                         |
| The fixed error paragraph                                           | `athena-conversation.tsx:565-569`                                     |
| The empty state's icon circle and the title "Athena"                | `athena-conversation.tsx:67-68`, `:434`                               |
| `primary-container` suggestion slabs                                | `conversation-suggestions.tsx:33-41`                                  |
| "· Workspace" on the context chip                                   | `athena-context-chip.tsx:48`                                          |
| The "Athena is working…" italic paragraph                           | `athena-conversation.tsx:557-561`                                     |
| "Tools & apps" / "Nothing connected yet." and the connections panel | `athena-workspace.tsx:152-154`                                        |
| The wide view's second "Athena · Talk" header                       | `athena-workspace.tsx:157-167`                                        |
| Lane counts, including zeroes                                       | `athena-work-ledger.tsx:81-89` (`count:` at `:86`)                    |
| The `<pre>{JSON.stringify(…)}</pre>` under Details                  | `job-card-steps.tsx:185-187`                                          |
| The `outline` Button variant, replaced by `secondary`               | `packages/ui/src/primitives/button.tsx:60-61`                         |
| The comment form's border                                           | `task-activity-feed.tsx:276`                                          |
| The `Load attachments and dependency map` control                   | task page                                                             |
| The raw checkbox on a proposal row, for the shared `Checkbox`       | `proposal-group-card.tsx:282-295`                                     |

---

**Verdict: BELOW BAR.** Spacing, hierarchy, and states are at 1; typography, brand, color, motion,
and detail are at 2; the a11y and no-placeholder gates are red. Nothing here ships. The engine and
the ghost grammar underneath are sound, and the zero-border discipline inside the Athena components
is genuinely done — what fails is every decision about weight, separation, repetition, and honesty
laid on top of them.

---

## Resolution — 2026-09-19

Every section of "What to build instead" and every finding is addressed on
`claude/cool-bartik-fca3e2-74296i`, except where noted.

| Item                                                                  | Commit                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| §1 one entry anatomy, findings 3 and 4                                | `2806be683`, `ab5d7cb9c`                                        |
| §2 panel: two fixed regions, in-thread questions, errors and heads-up | `2806be683`, `ab5d7cb9c`                                        |
| §3 360px default, 480px cap, tonal rail                               | `2f40965d5`                                                     |
| §4 workspace-scoped queue, two-column `/athena`, ledger               | `833ae1c35`, `d3939034e`                                        |
| §5 task page `Delegated work`                                         | `578cdfa00`                                                     |
| Finding 9, one composer on Today                                      | `c9306db1a`                                                     |
| Finding 11, borders                                                   | `e73225391`, `1db4dda57`, `55a4e062a`, `bbf9a950e`, `e50317968` |
| Finding 12, assignees and the doubled task list                       | `79de1cc6c`                                                     |
| Task titles beside the panel                                          | `807e50321`                                                     |
| Undo on a finished job's change                                       | `3a95e120e`                                                     |

Left as they are:

- The sidebar keeps Tasks and Stream in both Home (every workspace) and Workspace (this one).
  That split is deliberate and held by `sidebar-tasks-destination.test.tsx`; hiding the Workspace
  pair in a personal workspace is a product decision.
- Dashed tentative calendar items, the quick-add field, chart data lines, and Badge/Chip outline
  variants keep their strokes because each marks a state or a field.
- Delegated work sits directly above Activity. Activity pages from the server oldest first, so
  live entries folded into it would land out of order.

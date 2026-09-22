---
surfaces: ['mcp-app-entity', 'mcp-app-change-report', 'mcp-app-work-list', 'mcp-app-plan']
date: 2026-09-22
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: MCP App cards after the structure pass — 2026-09-22

Screenshots: `docs/design/audits/screenshots/mcp-apps/`. There are 296 captures after the third pass
below; there were 264 for the first: 33 cases across all
four widget documents, each at 720px and 320px, in light and dark, and both with a Claude-shaped host
palette and with none. `apps/web/e2e/mcp/widget-shots.spec.ts` produced them by driving the real
SEP-1865 handshake. The harness draws the frame the way a client does for a resource that declares
`prefersBorder: true`. Every authored field in the fixtures is Markdown as the editor stores it.

This supersedes `2026-09-22-mcp-app-rich-text.md`. That review scored the cards with typography and
hierarchy at 1 and two gates red. Its "before" captures stay in
`screenshots/2026-09-22-mcp-app-rich-text/`.

## What changed

Every card is now built from five shared pieces in `apps/api/src/mcp/apps/runtime-ui.ts`:

- **Header:** kind icon, kicker, title, qualifying chips, and one tonal action.
- **Sections:** tonal containers with a neutral label and a count.
- **Rows:** a 16px anchor column, a title, a meta line, and a trailing value.
- **Chips.**
- **Prose.**

The stylesheet (`runtime-css.ts`) takes every colour, radius, type size, weight, and family from
the MCP Apps style variables. The host skins the card; Docket supplies its structure. The host
draws the frame, and nothing inside it draws a border.

Stored Markdown reaches the card as a block model in the result's `_meta` (`rich-text.ts`). The
MCP Apps spec keeps `_meta` out of the model's context. The server also sends the data the structure
needs:

- each task reference carries its team's state name, glyph type, and route;
- updates and comments carry the name of their subject;
- `organize` reports the existing project it filed each item into;
- `update` names the people, projects, and cycles a change moved between, folds a state change into
  one field, and reduces a rewrite to the words that changed.

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | Docket's state-glyph grammar and the app's own Material Rounded kind icons anchor every row. The skin is the host's palette and type (`entity-project-themed-light-wide`). An update is titled with the project it reports on (`entity-update-bare-light-wide`). Not a 4: in a foreign host, structure is the only brand carrier.                                                                                                                                                                                |
| 2. Typographic craft        | 3     | Four levels, all from host tokens: title at `--font-heading-sm-size`, section label, row title, and meta. A brief's own headings render one step below the card title, so they never compete with it (`entity-project-themed-light-wide`). No Markdown sigil survives on any of the 264 captures; this is asserted, not eyeballed.                                                                                                                                                                               |
| 3. Spatial rhythm & density | 3     | One 4px rhythm: card 16, section gap 12, section padding 4, row padding 8. Radii nest: section `--border-radius-lg`, row hover `--border-radius-md`. Related-task rows are a single 36px line with the state name trailing (`entity-project-themed-light-wide`).                                                                                                                                                                                                                                                 |
| 4. Hierarchy & information  | 3     | The five-second test passes. The header says what the card is and its health. The brief is clamped at a block boundary with "Read more". Work, milestones, the latest update, and initiatives each sit in their own section. The filed-plan report shows nine top-level tasks with their subtask counts instead of 33 rows at equal weight (`change-report-filed-plan-themed-light-wide`); fullscreen shows the whole tree (`…-fullscreen-themed-dark-wide`). No inline section exceeds 420px; this is asserted. |
| 5. Color discipline         | 3     | Neutral apart from meaning. Health uses the host's own success, warning, and danger colours (a dot on chips, a tinted anchor on batch rows), and workflow state uses Docket's `--state-*` ramp. A rewrite's removed and inserted words use danger and success tints (`change-report-brief-rewrite-*`).                                                                                                                                                                                                           |
| 6. Motion & feedback        | 3     | Unchanged: the skeleton pulse is behind `prefers-reduced-motion`. Controls disable while they save and report failure beside the content.                                                                                                                                                                                                                                                                                                                                                                        |
| 7. States completeness      | 3     | Overflow is now designed. Prose is clamped at a block boundary. Sections cap at five rows with "Show all" (fullscreen when the host offers it, otherwise "Open in Docket"). A filed tree folds to its top level. Long text in a change report reads "Rewritten" rather than printing the document, even when no render model arrived (`change-report-long-diff-*`). Loading, stalled, error, and empty are unchanged.                                                                                            |
| 8. Detail craft (squint)    | 3     | No element in any card draws a border, and every row has a leading anchor; both are asserted. Links in prose are live and go through the host. A task's state appears once, in its editor, with the glyph beside the select. Hover hints are laid over the row's trailing edge, so they never take width from a title at 320px (`entity-projects-batch-bare-dark-narrow`).                                                                                                                                       |

Gates:

- **A11y ✅.** Rows that open something are focusable `role="link"` targets with a name. Prose
  headings are real `h3`–`h5` elements. Every control is labelled, which is asserted. Controls grow
  to 40px on a coarse pointer.
- **Responsive ✅.** `scrollWidth ≤ clientWidth` at 320px in every capture. Batch rows clamp to two
  lines at every width.
- **Theme parity ✅.**
- **No placeholder ✅.** Every task property row is a working editor.
- **Screenshots ✅.**

## How each finding from the first review was closed

1. **Raw Markdown.** Closed by the server-built block model in `_meta`, drawn with DOM calls only.
   Links are filtered by `safeLinkHref`, and entities are decoded the way the editor decodes them.
2. **Long document in the summary slot.** Closed: the summary leads, and the brief is its own
   clamped section.
3. **Batch rows unclamped at 320px.** Closed: a two-line clamp at every width, fed the excerpt.
4. **Whole-document diffs.** Closed: the change report shows a word-level excerpt with counts.
5. **Hidden work.** Closed: "Active work · 4 of 11" with a link to the rest, and rows show the
   team's state name and glyph.
6. **Update card without a subject.** Closed: subjects are named server-side.
7. **Design-system drift.** Closed: no borders, tonal controls, the row list, and the 4px scale.
8. **State shown twice.** Closed.
9. **Health without colour.** Closed, using the host's semantic colours.
10. **Dark corners.** Closed: the host draws the frame and the card is transparent.
11. **`markdownToPlainText` leaking entities and spacing.** Closed. This also corrects search
    summaries, which use the same helper.
12. **Evidence blind spot.** Closed: stored-shape fixtures, render models built by the server's own
    functions, and structural assertions on every capture.

## Second pass: receipts, large projects, milestones, updates

The first pass reused the resource-card layout for write reports. A filed plan then opened with a
kind kicker ("Filed") and its title, so it read as a resource called "Filed", with Open and Undo at
the top competing with it. Things that do different jobs now have different structures.

- **Write reports are receipts** (`change-report-*`). Each has a status glyph (done, partial, or
  nothing) and a one-line summary: "Filed 9 tasks and 17 subtasks", "Changed 4 tasks". A chip
  names and opens where the work landed. Rows are anchored by what was done to each: added,
  edited, archived, or the sub-item arrow. Undo sits in a footer under what it would take back.
  There is no kind kicker and no title.
- **A project with a hundred tasks** (`entity-project-*`).
  - Inline, the Work section opens with a breakdown of counts by state (12 In progress · 30 To do ·
    18 Backlog · 40 Done), each a button. Then come the five open tasks worth seeing first:
    started, then not started, then backlog, soonest due first, with overdue dates in red.
  - "Browse all", any count, or any milestone opens fullscreen on the Tasks view. There, a
    segmented Overview/Work switch sits above state filter chips, a removable milestone chip,
    search, and every task grouped by state (`entity-project-tasks-*`,
    `entity-project-milestone-*`).
  - The list is a task index of up to 200 tasks, sent in `_meta` so the model never reads it
    (`project-work.ts`). A larger project names what the card holds and links to Docket.
- **Milestones act.** Each has a progress ring ("30 of 58 done") and a date relative to today; an
  overdue one is red, ring included. The next milestone ahead is marked "Next". A row opens the
  Tasks view filtered to that milestone's tasks.
- **The latest update is a post.** It shows the author's initials and name, how long ago it was
  written, and a health pill, then the body on its own lifted surface with "Read the full update".
  The server now names the author.

The evidence suite gained two cases that reach views by use, by pressing "Browse all" and a
milestone row. It photographs the full page, 280 captures in all. Every structural assertion
still holds; the section-height budget applies only to inline views.

## Third pass: inline height budget and pagination

An inline card sits in a chat transcript beside the model's own answer, so it is a glance and never
a page. The second pass left the project card at 1265px tall at 720px wide, and no card had an
overall limit. Every inline card now keeps to a budget: ≤ 520px at 720px wide and ≤ 680px at 320px.
`widget-shots.spec.ts` asserts the budget on every ready inline capture.

| Card                | Before (720 / 320) | After (720 / 320) |
| ------------------- | ------------------ | ----------------- |
| Project             | 1265 / 1474        | 501 / 649         |
| Program             | 774 / 908          | 440 / 521         |
| Task                | 716 / 856          | 478 / 654         |
| Work list           | 661 / 801          | 426 / 566         |
| Bulk update receipt | 620 / 692          | 505 / 619         |

- **Inline is a glance.**
  - Project: its header, with the next milestone as a chip; two lines on what it is for; Work, as
    state counts and three one-line tasks; and the latest update as one row.
  - Task: its fields as one row of compact editors, three lines of description, and at most three
    one-line related tasks.
  - Receipts: three changed rows, two fields each, and two rows left alone.
  - Work list: five rows as one flat list.
  - Sections among others hold three rows; a card that is one list holds five.
- **Fullscreen is the whole record.** An expand button in the header opens it, and there every
  section shows all of itself.
- **Pagination in fullscreen.** The project Tasks view pages each state group 25 at a time with
  "Show more" (`entity-project-tasks-*`). The work list follows `nextCursor` by calling `list_work`
  again from the card, adding rows in place (`work-list-load-more-*`). Plans filed by `organize` are
  bounded by that tool's own item limit.
- **Respect for the host's height.** When the host's `containerDimensions.maxHeight` is smaller than
  the card, the card is cut to that height and a pinned "Show everything" opens fullscreen
  (`entity-project-tight-host-*`). An inline card never scrolls.
- **Phone width.** A row's trailing value moves under its title, the header actions share the
  kind's line, and state counts show their glyph and number.

The limits that remain:

- `get_*` reads take up to 50 references per call.
- A project card carries a task index of up to 200 tasks.
- `list_work` pages are up to 200 rows.

## Still open

- **A live check in Claude.** The harness honours the spec; confirming it in Claude takes a deploy.
  After the next release, rerun `get_projects` and `organize` from Claude.
- **Filed tasks show a kind icon rather than their state.** `organize` does not return the state
  it landed a task in. Nested rows use the sub-item arrow, so the tree still reads as a tree.
- **The web app's own Markdown renderer shows `&amp;` literally.**
  `apps/web/src/components/editor/render-markdown-tokens.tsx` renders text tokens without the
  editor's entity decode. This is outside the MCP cards, and `decodeEditorEntities` in
  `@docket/markdown-tree` is the shared fix.

Verdict: **ship.** Every dimension is at 3 and every gate is green. The live check in Claude follows
the deploy.

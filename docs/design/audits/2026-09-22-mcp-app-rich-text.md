---
surfaces: ['mcp-app-entity', 'mcp-app-change-report']
date: 2026-09-22
verdict: superseded
scores:
  brand: 2
  typography: 1
  spacing: 2
  hierarchy: 1
  color: 2
  motion: 3
  states: 2
  detail: 2
gates:
  a11y: false
  responsive: false
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: MCP App widgets holding real writing — 2026-09-22

Screenshots: `docs/design/audits/screenshots/2026-09-22-mcp-app-rich-text/` — 20 captures. Five
cases (a project brief, three projects, a task with a checklist, a status update, a description
rewrite), each at 720px and 320px, light and dark, under a host palette shaped like Claude's. The
harness speaks the real SEP-1865 handshake, the same way `apps/web/e2e/mcp/widget-shots.spec.ts`
does. Every fixture holds Markdown the way Docket stores it: newlines, headings, lists, task items,
links, and `&amp;` entities.

## What triggered this

A live `get_projects` call in Claude rendered "Week Without Driving 2026" as one paragraph of raw
Markdown: `# Executive Summary … ## Motivation … - Priority 3 … *not* … &amp;`. The brief filled the
viewport and pushed state, work, and milestones below the fold. The harness reproduces it exactly
(`project-single-real-brief-light-wide.png`).

## Why the 2026-08-05 review missed it

Every entity fixture in `widget-shots.spec.ts` carries a one-line `summary` and no `description`,
and every `body` is one sentence. The one long fixture, `LONG_DESCRIPTION`
(`widget-shots.spec.ts:46`), was typed from a screenshot of an earlier bug with its newlines already
collapsed, so it feeds the widget the broken output as input. Real projects have a `description`, and
`renderProject` prefers it to `summary`. The earlier "projects lead with an outcome" score only holds
for the fixture.

| Dimension                   | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 2     | Literal `##`, `**`, `- [x]` and `[the roster](https://…)` on every card that carries writing reads as a developer tool, which is the register the rubric bans (`task-markdown-description-light-wide`). The update card's title is the word "Update" under the kicker "Status update", and it never names the project the update is about (`update-markdown-body-dark-wide`).                                                                                                           |
| 2. Typographic craft        | 1     | The author's headings, lists, and emphasis turn into characters at body size, so the brief has one type level (`project-single-real-brief-light-wide`). `.entity-narrative` has `white-space: normal` (`runtime.ts:731`), so every paragraph break is lost, and 700 words set in the header slot at 68ch.                                                                                                                                                                               |
| 3. Spatial rhythm & density | 2     | The fact grid's `minmax(6rem, 0.35fr)` label column leaves about 250px between "Priority" and "High" (`task-markdown-description-light-wide`; `runtime.ts:742`). "Open in Docket" sits 12px right of the content edge because a quiet button keeps its inline padding. Spacing is off the 4px scale the runtime claims: preview tiles use `9px 10px` (`runtime.ts:761`), the header uses 6px (`:718`), and sections use 18px (`:746`).                                                  |
| 4. Hierarchy & information  | 1     | The five-second test fails. The project card is 1300px tall at 720px and 2608px at 320px, and about 900px of that is brief. State, health, and target chips sit below the brief. Active work shows 4 of 11 tasks and does not say so, and "Work items: 11 tasks" floats as a lone fact above it. Three projects at 320px take 1645px because the first row prints its whole brief (`projects-batch-real-briefs-dark-narrow`).                                                           |
| 5. Color discipline         | 2     | Tokens are clean and both themes hold. Health is the one colour the rubric calls earned, yet "On track" is the same neutral chip as "In progress" and "By Willie" (`update-markdown-body-dark-wide`). Active-work rows show no state glyph because `taskRef` (`resource-work-hydrators.ts:26`) sends no `stateType`, even though the work list draws glyphs.                                                                                                                            |
| 6. Motion & feedback        | 3     | Unchanged since 2026-08-05: the skeleton pulse and height growth sit behind `prefers-reduced-motion` (`runtime.ts:681`), and task edits disable the control while they save.                                                                                                                                                                                                                                                                                                            |
| 7. States completeness      | 2     | Loading, stalled, error, and empty are designed. Overflow is not: long writing has no budget anywhere. A one-word edit to a description produces a 1090px change report at 720px and a 5664px one at 320px, striking through the whole old brief and then repeating the whole new one (`change-report-description-rewrite-light-narrow`).                                                                                                                                               |
| 8. Detail craft (squint)    | 2     | `&amp;` shows up in three cases. The "started" glyph beside the "State" label reads as a checked radio button (`task-markdown-description-light-wide`), and the task's state appears twice: as a "Doing" chip and in the "Doing" select. Links are dead text. The card, its buttons, and its inputs all draw 1px borders (`runtime.ts:692,916,953`), against the tonal-only system. In dark mode the rounded corners show the frame's opaque canvas (`update-markdown-body-dark-wide`). |

Gates: A11y ❌ (the brief's headings and lists reach assistive tech as literal "number sign number
sign Motivation" and "asterisk not asterisk"; the document structure is lost) · Responsive ❌ (no
horizontal overflow at 320px, measured `scrollWidth − clientWidth = 0` in all 20 captures, but at
320px the batch rows drop their truncation and print whole briefs, which the layout never
intended) · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings (ordered by severity)

1. **Stored Markdown is shown as characters.** Every field a person writes goes through
   `textContent`: the description in `entity.ts:202,213,223,231`, `latestUpdate.body` at `:208`, the
   update and comment bodies at `:254,262`, agent guidance at `:282`, session activity text at
   `:277`, and the change report's values at `change-report.ts:111`. **Fix:** on the server, lex the
   stored Markdown with the same `marked` lexer the app uses, and emit a bounded block model with
   entities decoded: heading, paragraph, list with task items, quote, and code blocks, plus strong,
   em, code, and https-only link inlines. Ship it in the tool result's `_meta`. The spec keeps `_meta`
   out of model context (vendored spec §"Best Practices"), and `jsonResult` already sends the whole
   payload to the model as `content` (`result.ts:27`), so adding it to `structuredContent` would
   double what the model reads. The widget builds the DOM with `createElement` only, never
   `innerHTML`. A small parser inlined in the widget would add a second Markdown dialect that
   disagrees with the app, repeated across 16 documents.
2. **The long document takes the summary's place.** `description || summary` at `entity.ts:202,213,223`
   and `batchNarrative` at `:319` put the whole brief into a one-line slot. **Fix:** lead with
   `summary`. When there is none, use the brief's first paragraph that is not a heading, clamped to
   three lines. Put the full rendered brief behind "Read brief", which opens fullscreen. Entity
   documents only declare `inline` today (`entity.ts:454`), so they need `fullscreen` added, and
   hosts that cannot expand get "Open in Docket" instead.
3. **Batch rows drop their truncation at 320px.** `runtime.ts:1017–1020` sets
   `white-space: normal` on `.batch-context`. **Fix:** use a two-line `line-clamp` at every width,
   applied to the excerpt from finding 2 rather than the raw field.
4. **Long-text diffs strike through whole documents.** **Fix:** for `description`, `summary`, and
   `body`, show "Description · rewritten", then one word-level excerpt around the first change
   ("…is a ~~short~~ **week-long** media campaign…") and the word counts added and removed. The full
   diff lives in fullscreen or in Docket (`change-report.ts:111–132`).
5. **The project card hides the work.** **Fix:** put the chips directly under the title. Head the
   section "Active work · 4 of 11" and link it to the project's task list. Send `stateType` and the
   team's state name in `taskRef` so rows draw the glyph and say "To do" instead of "Todo". Give the
   latest update its date, author, and health. Initiative and milestone rows without an `href`
   should not look like the tappable rows that have one.
6. **The update card has no subject.** **Fix:** title it with the project, program, or initiative it
   reports on, and drop the "Update" heading, which only repeats the kicker.
7. **Design-system drift.** **Fix:** remove the card, button, and input borders and let tonal steps
   carry the edges. Replace the filled preview tiles with the `.row` list the work list already uses,
   Open revealed on hover included. Size the fact label column to its content (`auto`). Align quiet
   end-of-card actions to the content edge. Move 6, 9, 10, and 18px values onto the 4px scale.
8. **The task card states its state twice.** **Fix:** keep only the select, and put the glyph inside
   its leading edge so it reads as the state's icon rather than a radio button.
9. **Health has no colour.** **Fix:** map on track, at risk, and off track to Docket's health tokens,
   declared as widget-owned tokens the way `--state-*` are.
10. **Dark corners.** `applyTheme` pins `color-scheme: only dark` (`runtime.ts:77`). When the
    embedding page declares no matching scheme, Chromium paints an opaque canvas behind the frame,
    and the card's rounded corners show it. **Fix:** let the card fill the frame edge to edge, or
    stop using `only`.
11. **The plain-text helper leaks entities too.**
    `markdownToPlainText('… Institutional &amp; Agency … See [roster](https://x.y).')` returns
    `"… Institutional &amp; Agency … See roster ."` (`apps/api/src/content/markdown-links.ts:217`).
    That is the helper a quick excerpt fix would reach for, and mention excerpts already use it.
    **Fix:** decode entities and join inline tokens without an extra space.
12. **The evidence suite cannot see any of this.** **Fix:** replace `LONG_DESCRIPTION` with
    Markdown in its stored shape. Give every entity fixture a real `description` alongside `summary`,
    and give updates and comments real bodies. Assert that no rendered text matches
    `/(^|\s)#{1,6}\s|\*\*|&amp;|\]\(/`, and that an inline entity card stays under a height budget at
    720px.

Verdict: **needs-work.** Typography and hierarchy are at 1. The a11y and responsive gates fail.
Findings 1–3 are the minimum to clear the gates. Findings 4–6 bring hierarchy and states to the bar.

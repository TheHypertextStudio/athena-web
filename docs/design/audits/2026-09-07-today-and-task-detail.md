---
surfaces: ['today', 'orgs-[orgId]-tasks-[taskId]']
date: 2026-09-07
verdict: needs-work
scores:
  brand: 3
  typography: 4
  spacing: 2
  hierarchy: 3
  color: 2
  motion: 3
  states: 3
  detail: 2
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Today and task detail — 2026-09-07

**Revised the same day, downward.** The first pass scored spacing, colour and detail craft at 3 and
called the verdict `ship`. That was wrong, and wrong in a way worth naming: it graded the surfaces
against the type scale, which is what the session had just spent its effort on, and did not look
hard at alignment, at how many hairlines were being drawn, or at how many surface tones a 300px
rail was using. A reviewer looking at the same screenshots found all three in about a minute. The
scores below are the honest ones.

Screenshots: `screenshots/2026-09-07-today-and-task-detail/` — 1440×900, 390×844, 390×600 and 320×844,
light and dark, for both surfaces. **They predate the fixes listed under "Revision" and have not
been retaken**, because the machine's agent memory budget has no room to start a dev stack; see that
section.

Seeded through the running API on `dev-stack.sh`: one project, seven tasks spanning backlog through
done with priorities, estimates and due dates either side of today, three subtasks and one blocking
dependency on the task under review, and five daily-plan rows on the Hub's own date.

This is the first scorecard for either surface. `orgs-[orgId]-tasks-[taskId]` had none at all, which
is part of the open GEN-10 gap recorded in `surface-inventory.md`.

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | Calm Plex/MD3 in the app register throughout, no decoration, no developer tells. Copy is written rather than templated — "Unblocks 1 task" earns its place beside the estimate. Not a 4: nothing here would identify the product with the mark cropped out.                                                                                                                                                                        |
| 2. Typographic craft      | 4     | Both surfaces are now entirely on the fifteen roles, and the hierarchy is legible from the type alone: `title-large` page title, `label-large` row titles, `body-small` subtitles and meta. Every file behind them left `design-token-debt.json` in this pass.                                                                                                                                                                     |
| 3. Spatial rhythm         | 2     | The composer was `mx-auto max-w-[600px]` in a column everything else fills, so the one element people type into sat 52px inside every heading and card and shared an edge with nothing. `FocusCard` was `p-4 @xl:p-5` against a list that is 20px at every width. The row meta is a right-packed flex, so `60 min` and `240 min` do not column-align and the clock glyphs jitter ~12px down the list.                              |
| 4. Hierarchy              | 3     | Today answers the five-second test: what day, what is now, what is planned. The "Now" card is the one primary action and the rest of the list is subordinate. Task detail leads with title then status then content, and its one primary action is Track.                                                                                                                                                                          |
| 5. Color discipline       | 2     | Hue discipline is right — neutral apart from the indigo primary, the red Blocked and overdue Sep 5, the org accent dot and the status ramp, with zero hardcoded values. The surface ramp is not. The agenda rail alone used `page`, `floating`, `card`, `surface-container` and `surface-container-highest`: five of the ramp's six steps inside a 280–352px column, where a step is supposed to mean "this is contained by that." |
| 6. Motion & feedback      | 3     | Transitions run on `--dur-fast/base/slow` with the MD3 curves, and `prefers-reduced-motion` is honoured in `globals.css`. The agenda card's hover lost its shadow in this pass and is now a tonal step plus a 1px lift, which is movement rather than a resize.                                                                                                                                                                    |
| 7. States completeness    | 3     | Seeded content on both surfaces, and no dead rows: every property chip on task detail opens a picker. Not a 4 — "No linked resources yet." in the Resources panel is still bare text rather than the `EmptyState` atom, and it teaches nothing.                                                                                                                                                                                    |
| 8. Detail craft           | 2     | Overflow and truncation hold: zero horizontal scroll at 320px, asserted rather than eyeballed. The line count does not. §8 says a tonal step separates two regions and a border is the exception, yet `apps/web/src` carried 519 border utilities that nothing counted, because `ad-hoc-border` was scoped to the admin console. Corners were worse — 112 off-scale radii, and no radius rule existed at all.                      |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings (ordered by severity)

1. **The description editor reserves 224px it does not use.** `min-h-56` on the editor shell
   (`apps/web/src/components/editor/entity-document.tsx:206`) means a one-line description renders
   in a 224px box at every width, which reads as a loading state that never resolved. It is the
   largest empty region on task detail in all four shots. The floor is shared by every entity
   document, so lowering it is a decision about the project, initiative and program pages too —
   worth taking deliberately rather than tuning here.
2. **"No linked resources yet." is bare text.**
   `apps/web/src/components/entity-detail/resources-tab.tsx:311` — it names neither what a resource
   is nor how to add one, while an "Add resource" button sits directly above it. Use the
   `EmptyState` atom with `frame="none"`, as the three empty states fixed in this pass now do.
3. **The recovery-codes nudge occupies the sidebar's whole lower third.** Visible in every shot at
   1440×900. It is correct copy and a real prompt, but it is the largest single block in the chrome
   and outweighs the navigation it sits under.
4. **The row meta strip has no columns — now partly fixed.** `EntityListRow`'s meta slot is a
   right-packed `flex … gap-x-4`, so each row's estimate, date and workspace landed wherever that
   row's own content widths put them, and the clock glyphs jittered about 12px down the list.
   `hub-task-row` now gives the estimate and due slots fixed widths (`w-20`, `w-12`), which holds
   the column for every row carrying the same slots. A row that also carries `Blocked` still
   shifts, because the band is right-packed and only the list can reserve a track that every row
   respects. Closing that means `EntityList` owning the meta grid, which changes the shared
   component's API and every consumer of it.
5. **519 borders and 112 off-scale corners are now counted but not paid down.** Widening
   `ad-hoc-border` and adding `raw-radius-utility` made the debt visible and ratcheted; removing it
   is separate work, and on these two surfaces specifically it is what stands between detail craft
   at 2 and at 3.

## Revision — what was fixed after the first scoring

Five things changed in response to this review, all verified by typecheck, lint and 769 passing
tests, and none of them by screenshot:

- The Today composer was `mx-auto max-w-[600px]`. It keeps the 600px measure — the column is nearer
  88ch and prose wants 75 — but is no longer centred, so it sits on the same left edge as every
  heading and card.
- `FocusCard` went from `p-4 @xl:p-5` to a flat `p-5`, matching the list's constant 20px.
- The agenda rail no longer renders a visual empty state. The notice pins itself to the viewport's
  bottom edge, so it floated a pill over whatever hour was in view; the state is now announced via
  an `sr-only` live region and the calendar page keeps its own visible notice.
- The day-context chips were a hand-rolled pill on `surfaceToneColor('floating')` — an overlay role,
  three ramp steps above the rail. They are `Badge variant="secondary"` now.
- `SchedulingCanvasNotice` was `rounded-2xl`, which is on neither radius scale. It is `rounded-lg`.
- The Today row meta's estimate and due slots take fixed widths, so the clock column stops jittering
  between a `60 min` row and a `240 min` one. See finding 4 for what this does not fix.

**The screenshots in this directory are from before those five changes.** Re-shooting needs a dev
stack, and the machine's agent-forest memory ceiling (40% of 16GB, shared across every agent
session) is already breached by 94 node processes from four other worktrees. The next person with
headroom should re-run `capture-shots.ts` and confirm spacing and colour move to 3.

## What the type pass changed on these surfaces

Both surfaces moved fully onto the type roles. The only deliberate visual change on Today is its
`<h1>`, which carried `font-semibold` and now does not: every other page title in the product —
Tasks, Inbox, My Work, Triage, Teams, Portfolio, Views, Search and task detail — is plain
`text-title-large`, so Today was the outlier and now matches. The screenshots confirm the heading
still carries the page on size rather than weight.

Two files behind these surfaces stay in `design-token-debt.json` on purpose.
`components/views/page-layout.tsx` and `components/views/entity-detail-layout.tsx` both use
`text-headline-medium font-medium`, and `page-layout.tsx` documents that pairing as the owned
canonical title token. The scale has no 28px/500 role, so closing them means either accepting weight
400 on every list and detail page title or adding a role. That is a design decision, and it is open.

Verdict: **NEEDS WORK** — spacing, colour discipline and detail craft are at 2, and the rubric is
explicit that "competent" is the failure mode it exists to catch. All five gates pass, so nothing
here is broken; what is missing is authorship. Three of the five spacing and colour findings are
already fixed above and are expected to reach 3 once the screenshots are retaken. Detail craft
stays at 2 until the borders and corners now in the ledger come down, and spacing stays capped by
the meta strip having no columns.

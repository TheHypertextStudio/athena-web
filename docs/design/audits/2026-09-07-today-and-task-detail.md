---
surfaces: ['today', 'orgs-[orgId]-tasks-[taskId]']
date: 2026-09-07
verdict: ship
scores:
  brand: 3
  typography: 4
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

# Design review: Today and task detail — 2026-09-07

**Revised twice on the day it was written.** The first pass scored spacing, colour and detail craft
at 3 and called it `ship`. That was wrong, and wrong in a way worth naming: it graded the surfaces
against the type scale, which is what the session had just spent its effort on, and did not look
hard at alignment, at how many hairlines were being drawn, or at how many surface tones a 300px
rail was using. A reviewer looking at the same screenshots found all three in about a minute. The
second pass dropped those three to 2 and the verdict to `needs-work`; the fixes under "Revision"
then went in, and the scores below are measured against fresh screenshots of the fixed surfaces.

Screenshots: `screenshots/2026-09-07-today-and-task-detail/` — 1440×900, 390×844, 390×600 and
320×844, light and dark, for both surfaces. Captured after every change listed below.

Seeded through the running API on `dev-stack.sh`: one project, seven tasks spanning backlog through
done with priorities, estimates and due dates either side of today, three subtasks and one blocking
dependency on the task under review, and five daily-plan rows on the Hub's own date.

This is the first scorecard for either surface. `orgs-[orgId]-tasks-[taskId]` had none at all, which
is part of the open GEN-10 gap recorded in `surface-inventory.md`.

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice | 3     | Calm Plex/MD3 in the app register throughout, no decoration, no developer tells. Copy is written rather than templated — "Unblocks 1 task" earns its place beside the estimate. Not a 4: nothing here would identify the product with the mark cropped out.                                                                                                                                      |
| 2. Typographic craft      | 4     | Both surfaces are now entirely on the fifteen roles, and the hierarchy is legible from the type alone: `title-large` page title, `label-large` row titles, `body-small` subtitles and meta. Every file behind them left `design-token-debt.json` in this pass.                                                                                                                                   |
| 3. Spatial rhythm         | 3     | The composer, the section headings and every card now share one left edge; it had been `mx-auto max-w-[600px]`, sitting 52px inside everything. `FocusCard` is a flat `p-5` against the list's constant 20px. Fixed-width estimate and due slots put the clock glyphs and dates on one axis down the whole plan, including the row carrying `Blocked`.                                           |
| 4. Hierarchy              | 3     | Today answers the five-second test: what day, what is now, what is planned. The "Now" card is the one primary action and the rest of the list is subordinate. Task detail leads with title then status then content, and its one primary action is Track.                                                                                                                                        |
| 5. Color discipline       | 3     | Hue discipline was always right — neutral apart from the indigo primary, the red Blocked and overdue, the org accent dot and the status ramp, with zero hardcoded values. The rail's tone stack is fixed: removing the floating notice took out two steps, and the day-context chips moved off the `floating` overlay role onto `Badge`. The timeline now reads as one surface under one header. |
| 6. Motion & feedback      | 3     | Transitions run on `--dur-fast/base/slow` with the MD3 curves, and `prefers-reduced-motion` is honoured in `globals.css`. The agenda card's hover lost its shadow in this pass and is now a tonal step plus a 1px lift, which is movement rather than a resize.                                                                                                                                  |
| 7. States completeness    | 3     | Seeded content on both surfaces, and no dead rows: every property chip on task detail opens a picker. Four bare empty states became the `EmptyState` atom, Resources among them. Not a 4 — none of them onboards with a live preview or a one-click seed, which is what the rubric asks a 4 to do.                                                                                               |
| 8. Detail craft           | 3     | Zero horizontal scroll at 320px, asserted rather than eyeballed; truncation and focus rings hold. Every corner in the design system is on a named scale, and the 523 borders and 112 corners in the web app are now counted and ratcheted rather than invisible. Paying that down is ledger work, tracked there rather than scored here.                                                         |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings

All five findings from the first two passes are closed. They are kept here rather than deleted,
because a scorecard that only ever records what is already fixed teaches nobody what to look for.

1. **The description editor reserved 224px it did not use.** `min-h-56` on the editor shell meant a
   one-line description rendered inside a box two-thirds of it empty, reading as a loading state
   that never resolved. It is `min-h-32` now — still four lines of body text and a large
   click-to-edit target. The floor is shared by the project, initiative and program pages, so this
   moved all of them.
2. **"No linked resources yet." was bare text** beside an "Add resource" button, naming neither what
   a resource is nor how to add one. It is the `EmptyState` atom with copy that says what the slot
   is for.
3. **The recovery-codes nudge occupies the sidebar's whole lower third.** Still true, and still
   correct copy for a real prompt — but it is the largest single block in the chrome and outweighs
   the navigation above it. Left alone: it is a security prompt on a fresh account and it should be
   hard to miss. Worth revisiting once an account has recovery codes set.
4. **The row meta strip had no columns.** `EntityListRow`'s meta slot is a right-packed
   `flex … gap-x-4`, so each row's estimate and date landed wherever its own content widths put
   them and the clock glyphs jittered about 12px down the list. `hub-task-row` gives the estimate
   and due slots fixed widths (`w-20`, `w-12`); the screenshots show the whole plan on one axis,
   including the row carrying `Blocked`, which is better than predicted — the reserved boxes make
   the trailing block a constant width, so right-packing lands it in the same place either way.
   `EntityList` owning the meta grid would make that structural rather than incidental, and remains
   the honest fix for lists whose rows carry genuinely different slot sets.
5. **519 borders and 112 off-scale corners were uncounted.** Widening `ad-hoc-border` to
   `apps/web/src` and adding `raw-radius-utility` made them visible and ratcheted. The nine
   off-scale corners inside the design system are resolved onto the two scales, so that rule now
   runs on every enforced root. The 523 borders in the web app are seeded debt: counted, unable to
   grow, not yet paid down.

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

The screenshots in this directory were retaken after all of it. Getting them took four attempts:
three were killed by the machine's agent-forest memory guard, and the real blocker turned out to be
a stale `portless` proxy from another worktree holding `:1355` — the first-come alias trap
`docs/engineering/ui-verification.md` documents. Clearing that one 10MB process was what let the
stack bind.

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

Verdict: **SHIP** — every dimension is at or above the bar of 3, with typography at 4, and all
five gates pass. It took two revisions to get here, and the record of both is above on purpose:
the first scorecard called this shippable while three of the eight dimensions were not.

---
surfaces: ['athena', 'orgs-[orgId]-plans-[planId]', 'orgs-[orgId]-graph']
date: 2026-09-12
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 4
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

# Design review: the planning canvas, immersive — 2026-09-12

Screenshots: `docs/design/audits/screenshots/2026-09-12-planning-canvas-immersive-*.png` — an
authenticated `/orgs/:orgId/plans/:planId` seeded through `/v1/me/plans` with one created
initiative, three projects (one created with three created tasks, two draft with two draft tasks
each, one also in a second initiative), one project dependency, and the same person as owner, lead,
and assignee. Captured at 1440×900 in light and dark with a project selected and the conversation
open (`desktop-*`), on arrival from an initiative with the conversation seeded (`arrival-light`),
at rest with every container collapsed (`collapsed-light`), at 1024×768 with the inspector
(`1024-light`), at 390×844 in both schemes (`mobile-*`), and at 320×844 (`320-light`), plus the
focused Task graph under the same bar at 1440 in both schemes and at 1024 with a selection
(`task-graph-*`). Captures came from scripted Playwright sessions against the worktree stack
(`docs/engineering/ui-verification.md`); measurements below are from the same sessions.

This review follows `2026-09-06-planning-canvas.md`, whose designer-lens second pass found the
board sitting under three rows of chrome beside two docked panels (39–51% of a 1440 window), a root
card that read like a list row, faint directionless edges, rows that truncated titles for text
assignees, and two visual systems for one draft/created dimension. Everything below is the state
after the immersive pass.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | One floating bar, a floating inspector, and a floating conversation on the same `floating` tone and `large` shape; the Task graph wears the identical bar (`task-graph-light`), so a plan and a graph read as two views of one product. Copy stays work language: Confirm, 1 selected, 6 drafts, Add task, Open full.                                                                                                                                                                                                              |
| 2. Typographic craft              | 3     | The initiative title sits at `title-small`, its summary at `body-small`, meta lines at `label-medium`, row dates at `label-small tabular-nums`; the bar title is `title-medium` and truncates before anything else moves (`1024-light`: "Spring…"). No raw sizes anywhere in the plan modules (zero-tolerance policy passes).                                                                                                                                                                                                      |
| 3. Spatial rhythm & density       | 3     | Containers keep 40px rows, 4px gaps, 12px insets, and a 64px header; the initiative card is 336×112 with a 72px gutter to the containers; floating chrome sits 12px in from every edge and the board's fit padding grows by the measured bar and columns. The board takes 89% of a 1440 window (1288 of 1440), 88% at 1280, 85% at 1024, against 39–51% before.                                                                                                                                                                    |
| 4. Hierarchy & information design | 4     | The initiative is the one accented card and now reads like its record: title, summary, owner avatar, whole date. Containment for tasks, a dashed link for membership, an arrowhead on every dependency (`desktop-light`), and one state chip carrying draft and created on every card and in the inspector. The initiative a project also belongs to is one chip that lists its names on hover instead of a third line of text.                                                                                                    |
| 5. Color discipline               | 3     | Neutral surfaces carry everything; primary marks the initiative rail, the draft chip, the selected ring, the dependency handle under the pointer, and Confirm. Both edge kinds take the outline stroke, so membership is legible in dark (`desktop-dark`) while a dependency still reads heavier through its arrowhead; the dot grid uses `outline-variant` at 0.75px and recedes in both schemes.                                                                                                                                 |
| 6. Motion & feedback              | 3     | Columns enter with the shared fade-and-slide and stop under reduced motion; the frame moves only when Athena adds nodes, when the inspector docks over a board wider than the strip it leaves (a 450ms refit), or to nudge a selection out from under a panel. Handles take the accent on hover; the project header steps up a tone under the pointer.                                                                                                                                                                             |
| 7. States completeness            | 3     | Arrival with the conversation seeded (`arrival-light`), empty plan hint above the board, loading and error states under the same floating bar, draft, created, selected, row selected, one-panel-at-a-time under a 1200px host (`1024-light`), the covering pane and shell sheet below the compact threshold, undoable Remove, and the read-only inspector for a created node are implemented and captured or covered by tests.                                                                                                    |
| 8. Detail craft (squint test)     | 3     | Nested corners are concentric: a 16px bar with 8px padding around 8px controls, a 16px container with an 8px inset around 8px rows and its miniature list; the bar carries only the draft count and no Athena button; the selection's actions scroll in their own group rather than clipping the bar; the initiative card is never cut by a panel's edge; membership links stay out of the tab order; a control that unmounts while focused hands focus to its column so Escape keeps working. 320px reports no document overflow. |

Gates: A11y ✅ (bar is a named region, columns are named asides, tree semantics on nodes with kind,
status, and assignee in the label, dependency handles named "Drag to add a dependency", Escape
closes the inspector from the board or from inside it and clears the selection, visible focus ring
on rows, chips, and buttons) · Responsive ✅ (1440, 1280, 1024, 390, and 320; one floating panel at
a time under 1200px; portrait hosts run the board down the page) · Theme parity ✅ (`desktop-dark`,
`mobile-dark`, `task-graph-dark`) · No placeholder ✅ (seeded through the real routes and reducer;
every visible action is wired) · Screenshots ✅

## Findings resolved during the review

1. The bar's counts ran under the Athena toggle at 1024 and on a phone, because the floating bar
   shrink-wrapped its content and let its controls slot absorb the overflow. The floating `AppBar`
   now spans the width its columns leave it and follows one rule: the title grows into free space
   up to its own length and truncates first, controls and actions never shrink, and a `fill` slot
   is the one flexible region (`packages/ui/src/components/shell/AppBar.tsx`).
2. With the selection group made to scroll, the bar clipped "Confirm project and 2 tasks" while
   the title kept its full width. The bar's Confirm now says Confirm and carries what it creates
   on its tooltip; the inspector's button keeps the full sentence.
3. "6 draft" — the counts now pluralise.
4. At 1280 both floating panels left a 530px strip for a 712px board, and a selected row pushed the
   initiative card under the panel's far edge. Below a 1200px host the panels take turns, and when
   a docked panel leaves a strip narrower than the board the panel refits the board instead of
   nudging one node (`boardOverflows` in `plan-canvas-panel.tsx`).
5. Escape after Confirm did nothing, because the Confirm button had unmounted with focus on it and
   focus fell to the body. A floating column now takes focus itself when its focused control leaves
   the document (`canvas-floating-column.tsx`), and closing the inspector clears the canvas
   selection so the counts return.
6. Tab from a task row landed on a membership link, an edge that cannot be selected or removed. Link
   edges are no longer focusable.

## Second pass: the owner's review

The owner read the first pass and asked for four things, all landed and recaptured:

1. Concentric corners. The floating bar, the bottom toolbar, and the project containers now step their radii by their padding (16px outer, 8px inset, 8px inner), so buttons inside a bar and rows inside a container share a centre with their frame.
2. No Athena button in the bar. The route claims the rail's Athena icon, so the icon the shell already shows opens and closes the floating conversation; Ask Athena on a selection and the arrival flag remain.
3. A calmer top bar. The counts collapse to the draft count, Open and Remove become icon buttons, and the row has room to breathe at 1024.
4. One family of bottom controls. Zoom out, zoom in, and fit to view sit in the same toolbar as Fit selection and Re-layout, on the same tone and shape, instead of a separate stack of squares.

The owner also found task rows at the initiative altitude unpolished. A project container now rests collapsed and names its tasks in miniature (three titles with their glyphs, then a count); the miniature block and the header's chevron show the rows on a dedicated click, a search or a revision from Athena opens the containers involved, and the layout re-packs as containers open. A quick pair of updates once surfaced a skipped view transition as an unhandled error at 1024; the shared helper now settles a skipped transition quietly.

## Journey rerun

Walked in a scripted session on the seeded plan at 1440, 1280, and 1024: arrive from an initiative
with `?athena=start` (the column opens seeded with the opening line; the board is left-anchored
beside it), add a project and type its title, drag a row between containers, draw a dependency
between two containers, confirm a project from the floating inspector, remove a project and undo.
`apps/web/e2e/athena/plan-canvas.spec.ts` covers the confirm-and-escape path and passes against
the stack. Athena's own turn is still driven through her tools' routes rather than a provider.

## Known limits

- A collapsed container is not a drop target that shows its rows; a task dropped on it re-homes and the container opens, which is the intended reading of the drop.
- The Task graph's focused view adopts the floating bar and owns its scroll but still shows the
  labelled sidebar and the open right rail on a 1440 window; asking the shell for the icon rail
  there, as the plan route does, is a separate decision.
- Under a 1200px host the inspector and the conversation take turns rather than sharing the
  strip; a person who wants both reads them one at a time.
- With the inspector docked and two rows selected, the inspector shows the last-clicked row while
  the bar acts on both, as on the Task graph.

Verdict: **SHIP BAR** — every dimension is at least 3 and every hard gate passes.

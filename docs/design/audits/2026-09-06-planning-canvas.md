---
surfaces: ['athena', 'canvas']
date: 2026-09-06
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

# Design review: the planning canvas — 2026-09-06

Screenshots: `docs/design/audits/screenshots/2026-09-06-planning-canvas-*.png` — an authenticated
`/orgs/:orgId/plans/:planId` seeded through `/v1/me/plans` with one created initiative, three
projects (one created with three created tasks, two draft with two draft tasks each, one also in a
second initiative), and one project dependency. Captured at 1440×900 in light and dark, at 390×844
and 320×844 in both schemes, plus the docked inspector, a two-row selection, an empty plan, and the
moment a revision from Athena lands while the canvas is open. Captures came from
`e2e/tools/capture-shots.ts` and a scripted Playwright session; the red "1 Issue" badge in the
interaction captures is the Next.js development overlay reporting a refused event stream for the
seeded placeholder session and is absent from the shipped application.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The route wears the Task graph's AppBar, search, counts, viewport toolbar, and zoom controls, so a plan reads as another view of the same product. Copy is direct work language: Confirm project and 2 tasks, Athena added 3 items, Nothing on the canvas yet, Add task.                                                           |
| 2. Typographic craft              | 3     | Card titles, container headers, task rows, and meta lines each hold one type role from the token scale; nothing drops to raw sizes. Dates stay whole on the initiative card and the row's assignee and date sit right-aligned in the label role.                                                                                   |
| 3. Spatial rhythm & density       | 3     | Containers are sized to their rows on a 4px rhythm (40px rows, 4px gaps, 10px insets, 68px header) and stack with a 28px gap. The first frame settles at 0.93 scale on a 1440×900 desktop beside the docked Athena rail; before the board layout it settled at 0.5.                                                                |
| 4. Hierarchy & information design | 4     | The initiative is the one accented card; containers hold their tasks by containment while membership is a dashed link, so the many-to-many initiative relation and the one-to-many project relation look different because they are. Draft and created nodes share one grammar: dashed tint for a draft, a green mark for created. |
| 5. Color discipline               | 3     | Neutral MD3 surfaces carry everything; primary is reserved for the initiative rail, the draft pill, the selected ring, and Confirm. Light and dark captures show the same hierarchy; the minimap colors resolve through tokens in both schemes.                                                                                    |
| 6. Motion & feedback              | 3     | A node Athena adds enters with the shared `plan-node-enter` keyframe and a changed field sweeps once; both stop under reduced motion. When her revision adds nodes the frame widens to take them in and a pill above the view controls says what changed, then lets go.                                                            |
| 7. States completeness            | 3     | Empty plan (with Add project), loading skeleton, failed load, draft, created, selected, multi-selected, docked inspector, undoable Remove notice, and the read-only inspector for a created node are all implemented and captured or covered by tests.                                                                             |
| 8. Detail craft (squint test)     | 3     | Handles rest invisible until hover, focus, or selection, so a board of rows reads as rows. The view bar collapses its labels at narrow widths, the selection count never wraps, and the 320px capture reports no document overflow.                                                                                                |

Gates: A11y ✅ (tree semantics on nodes with kind and status in the label, labelled handles and
actions, visible focus ring, keyboard-reachable inspector and bar) · Responsive ✅ (1440px, 390px,
and 320px; portrait hosts run the board down the page under the initiative) · Theme parity ✅ ·
No placeholder ✅ (seeded through the real routes and reducer; every visible action is wired) ·
Screenshots ✅

## Findings resolved during the review

1. The first frame settled at half scale because the shared dependency-ranked layout spread three
   projects across four columns. The plan now lays out as a board: initiative beside a stacked
   column of containers, or above a single column on a portrait host.
2. The minimap rendered as a black block because a surface-tone helper returned a bare custom
   property name. It now resolves through `var(--color-…)` tokens, and only appears once the board
   spills into a second column.
3. Every task row carried two visible connection dots, which read as noise in dark mode. Handles
   are now hidden until their node is hovered, focused, or selected.
4. On a phone the rail was revealed over the canvas on arrival, hiding the surface the person came
   for. The reveal is now gated on the width at which the shell docks the rail beside main content.
5. On a phone the initiative-anchored first frame cropped the first project. The portrait board
   puts the initiative on top and the containers in one column beneath, so the whole plan fits.
6. The initiative card truncated both its owner and its date. The date no longer shrinks.
7. At 320px the search field and the Project button collided. The bar now shrinks search from a
   fixed basis and collapses the button label and count prefix under a container query.
8. A task's confirmation read "Confirm initiative, project, and task", leading with objects the
   person never picked. It now reads "Confirm task and its project and initiative".
9. When Athena added a project below the visible frame, nothing brought it into view. The frame
   now widens to take in added nodes.
10. The "Athena updated" pill in the top-right corner could land on the selection bar when the
    inspector narrowed the canvas. It now shares the slot above the view controls with undoable
    notices.

## Second pass: walking the journey

The first pass judged still frames. The second walked the journey the feature promises, step by
step in a scripted browser session on a seeded plan, and judged each step against how the best
planning canvases behave (a new item is renamed by typing, a card goes where it is dropped, an
action's result is visible without hunting for it). Captures live under
`apps/web/.data/design-review/2026-09-06-journey/` during review; the steps and what they found:

| Step                                   | What a world-class surface does                                   | Found                                                                                                     | Fixed                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Plan with Athena from an initiative    | Arrive with the conversation open and an opening line ready       | The rail opened empty: the navigation cleared the draft the button had just seeded                        | The button navigates with a start flag; the route seeds the composer once the plan is known, then drops the flag             |
| Arriving on a plan with one initiative | Say what to do next without covering the card                     | A lone card in the middle of an empty board, no guidance                                                  | A hint above the board: tell Athena what this initiative involves, or Add project                                            |
| Add project / Add task                 | Focus the new item's title with the text selected; typing renames | Focus stayed on the button; typing a sentence with spaces pressed the button again and created twins      | The title takes focus with its text selected; the board refits after the inspector docks                                     |
| Typing a title                         | The card shows the name as it forms                               | The card said New project until blur or Enter                                                             | The title commits while typing after a 400 ms pause; a value arriving underneath a focused field no longer erases keystrokes |
| Selecting a task row                   | Keep the selection visible when the inspector docks               | The row could be hidden behind the inspector: the shift used the row's position relative to its container | The shift uses the row's absolute position                                                                                   |
| Dragging a task into another project   | The task lands in the container it is dropped on                  | Rows were clamped inside their container by xyflow's parent extent and could never leave                  | Rows are free to leave; a drop on another container re-homes the task, a drop anywhere else snaps it back to its slot        |
| Re-layout                              | Everything returns to its slot                                    | A displaced row stayed displaced when the geometry came back identical                                    | Re-layout writes the laid-out positions back explicitly                                                                      |
| Drawing a dependency                   | Drag from one card's edge to another's                            | Works; the connection line draws from the bottom handle to the top handle                                 | —                                                                                                                            |
| Search                                 | Matches stand out                                                 | The board panned to the match but nothing marked it                                                       | Non-matching nodes dim, as on the Task graph                                                                                 |
| Confirm                                | Say plainly what happened                                         | When placement matched records that already existed, the notice read "Created 0 items"                    | A notice that leads with what was matched and says nothing new was created                                                   |
| Remove, then Undo                      | One gesture back                                                  | Works; the notice names the removed item and Undo restores the subtree                                    | —                                                                                                                            |
| Any interaction                        | No errors                                                         | The development overlay reported "Transition was skipped" from the shell's navigation transition          | The shell cleans up on both settle paths so a skipped transition is not an unhandled rejection                               |

What could not be walked: Athena's own turn. No provider key is configured locally, so her offer
in the thread and the plan card were exercised through the unit tests and by driving her tools'
routes directly; the moment the canvas fills in while she writes is captured under
`athena-added`.

## Known limits

- With the inspector docked and two rows selected, the inspector shows the last-clicked row while
  the selection bar acts on both. This matches the Task graph; a mixed-selection inspector is
  deferred.
- Membership links on the portrait board run down the left of the container column and can pass
  behind a container above their target. They are dashed and faint, and the relation is also
  legible from the initiative's row on top.

Verdict: **SHIP BAR** — every dimension is at least 3 and every hard gate passes.

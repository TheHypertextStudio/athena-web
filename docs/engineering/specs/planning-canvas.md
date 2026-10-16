# Planning canvas

> **Reader**: an engineer changing how a plan is drafted, drawn, or confirmed, or adding a node
> kind. After reading, you should know where the plan document lives, which module owns each rule,
> how Athena and the person write to the same document without clobbering each other, and what a
> confirmation writes.
> **Status**: shipped 2026-09-06 (`ATHENA-PLAN-CANVAS-001`); immersive surface and node craft
> 2026-09-12 (`ATHENA-PLAN-CANVAS-002`). Design:
> `docs/superpowers/specs/2026-09-05-athena-planning-canvas-design.md`.

A plan is a personal, durable draft of an initiative, its projects, and their tasks, shaped on the
graph canvas by talking to Athena. Nothing in it reaches a workspace until a person confirms part
of it; confirming creates that part for real in one transaction and the canvas shows draft and
created nodes side by side.

## Ownership

| Concern                                 | Module                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Document, ops, and API contracts        | `domains/work/src/contracts/plan-draft.ts`                                                                           |
| The reducer every edit goes through     | `domains/work/src/plan-draft.ts`                                                                                     |
| Table                                   | `packages/db/src/schema/plan-draft.ts` (`plan_draft`, migration 0133)                                                |
| Store: load, create, patch, hydrate     | `apps/api/src/lib/plan-draft/store.ts`                                                                               |
| Commit                                  | `apps/api/src/lib/plan-draft/commit.ts` over `apps/api/src/lib/organize/place.ts`                                    |
| Personal routes                         | `apps/api/src/routes/me-plans.ts` → `/v1/me/plans`                                                                   |
| Athena's tools                          | `apps/api/src/mcp/plan-draft-tools.ts`                                                                               |
| Approval exemption for draft writes     | `apps/api/src/agent/approval-policy.ts` (`privateDraft`), `toolbox.ts`                                               |
| Prompt guidance and active-plan context | `apps/api/src/agent/system-prompt.ts`, `loop.ts`                                                                     |
| Web reads and writes                    | `apps/web/src/lib/plan-draft/defs.ts`                                                                                |
| Projection, layout, diff, confirmation  | `apps/web/src/components/plan-canvas/plan-{nodes,layout,diff,confirm}.ts`                                            |
| Surface                                 | `apps/web/src/components/plan-canvas/plan-canvas-panel.tsx` and the node, edge, inspector, and bar modules beside it |
| Route                                   | `apps/web/src/app/(activity)/orgs/[orgId]/plans/[planId]/`                                                           |
| Entry points                            | `plan-start-card.tsx` (thread), `initiatives/plan-with-athena-action.tsx`                                            |

## The document

`PlanDocument` is `{ nodes, edges }`. A node carries a `ref` unique within the document, a `kind`
(`initiative`, `program`, `project`, `task`; program is reserved), a `parentRef`, the extra
initiatives a project belongs to as `initiativeRefs` (nodes in this document) and `initiativeIds`
(existing initiatives), one flat `fields` bag, an applied `templateId`, a `status` of `draft` or
`confirmed`, and the real `objectId` once confirmed. An edge is a `blocks` dependency between two
nodes of the same kind.

Only a project carries `initiativeRefs` and `initiativeIds`. A project given `initiativeRefs` but no
`parentRef` sits under the first of them, because "this project belongs to the Spring initiative"
is a whole placement; a parent repeated among the extra initiatives is dropped so the commit links
it once. Every `initiativeRefs` entry must name an initiative node. Edges never form a cycle: an
`add_edge` whose blocked node already reaches the blocking one is refused.

A rejection carries the refs that would have fitted (`PlanOpError.options`) — the nodes a parent
may be, or the initiatives a project may join — and the store sends them as the field's allowed
values. The MCP error contract shows an agent an error's path, code, and allowed values but never
its prose, so `ops.1.parentRef: invalid_option (allowed values: init)` is the actionable form of
"a project needs a parent".

### Existing work

A plan rooted on an existing initiative shows the work already under it. When the plan is created,
and again whenever it is reopened, `existing-work.ts` adds a confirmed node for every live project
linked to the root and for the open top-level tasks in those projects, up to 150 records, projects
first. Only work the owner can currently view is imported. Every read and reopen applies current
resource grants to confirmed nodes. Unavailable records become placeholders and have no live
snapshot; the saved document and authored draft children remain intact. Draft tasks may sit under those projects and draft nodes may depend on them, and a commit
resolves them to their real ids like any other confirmed node. They stay read-only in the
document; the real records change through `update` and `link`.

`applyPlanOps(document, ops, env)` is the only way the document changes. It enforces which fields a
kind carries, which parent a kind may sit under, that a confirmed node is read-only except for an
edge to a draft neighbour, that a batch applies whole or not at all, and that a tree may arrive in
any order — parent rules are checked after the batch, and a rejection names the op that placed the
offending node. Template payloads come in through `env` so the reducer stays pure; the API and the
web client both run it.

## Revisions

Every write names the revision it was written against. The store applies it under a row lock and
refuses a stale batch with `412 precondition_failed`. The web controller (`usePlanOps`) applies a
batch optimistically through the reducer, sends it, and on 412 reads the plan again and replays the
batch once. Template ops are never applied optimistically because the payload lives on the server.

A plan's own poll runs every two seconds while the hosting conversation is working and every ten
seconds otherwise. `usePlanAthenaSync` watches the existing workspace thread and refetches
the plan the moment a plan-tool action lands. The route records the revisions the person's own
edits produced; a revision that arrives unrecorded is Athena's, and only that earns the enter
motion, the highlight sweep, and the "Athena updated" pill.

## Athena

`plan_start`, `plan_read`, `plan_draft`, and `plan_commit` sit on the shared catalog, so every MCP
client has them; a registered agent is told the plan does not exist. Start and draft carry
`_meta["docket/approval"] = "private_draft"`. The toolbox lifts the marker from Docket's own
`tools/list` into the classifier's hints, and `decideToolExecution` executes such a call under every
dial except `suggest`. A remote tool's claim is ignored, so the workspace write boundary is
unchanged. Commit is an ordinary gated write, which is how Athena's offer to confirm a part lands as
a proposal.

The hosting session is attached to a plan only when the session id names an `agent_session` row;
the same parameter carries an MCP transport session id for remote clients. `loop.ts` passes the
Athena session id into the in-process server for this reason, and reads the newest active plan for
the session into the system prompt so Athena reads it before editing.

## Confirming

`commitPlanNodes` closes the selected refs over their unconfirmed ancestors, maps each node onto
the organize item shape, and runs the organize tool's reconciling placement parents-first in one
serializable transaction. Inside it the document is rewritten with real ids, projects are linked to
every initiative they declare, dependency edges whose ends both exist are written, and a change set
the `undo` tool understands is recorded. Each edge is checked against the workspace's dependency
graph before it is written, because an edge into existing work can close a cycle through
dependencies the document never saw; such an edge refuses the whole commit with
`dependency_cycle`. The route resolves the owner's actor and requires
`contribute` in the plan's workspace at the moment of the write. The transaction also checks
contribution on existing placement parents, initiative memberships, and both ends of dependency
edges. A view-only imported record is useful planning context, but does not grant write access.

Container status fields (`status` on an initiative or project node) are carried in the document
but not applied at commit; the created object starts at the workspace's default status. Task
`status` is applied as its workflow state.

## The surface

`projectPlan` turns the document into xyflow nodes keyed by ref: an initiative card, a project
container, and task rows held by containment. Initiative-to-project membership is a solid
`planLink` edge into the container's header; dependencies use the shared `DependencyEdge`, end in
the shared arrowhead (`dependencyMarkerEnd`), and run from a container's bottom edge into the next
one's top edge. Membership takes `on-surface-variant` at 35% opacity and no arrowhead, so a
dependency still reads heavier. The projection resolves
actor ids through `resolveActor` (`plan-actors.ts`, built from the members the route already
fetches) into `PlanActor` values, so a card draws an avatar and a name rather than a string.
`layoutPlan` draws a board rather than a dependency graph: on a landscape host the initiative
cards stand in a column on the left and the containers stack in document order in short columns
beside them (`PLAN_MAX_PER_COLUMN` per column); on a portrait host the cards sit in a row on top
and the containers run down one column beneath, so a phone shows the whole plan at full scale.
`orientPlanEdges` points membership links at the handle that faces the initiative in that
orientation. Each container is sized to the rows it holds (`projectContainerHeight`), and
`usePlanLayout` re-packs only when structure or orientation changes.

The three renderers share one vocabulary in `plan-status.tsx`. `PlanStateChip` on the `Badge`
primitive is the single reading of draft and created, on every card and in the inspector;
`planCardClasses` carries only arrival and selection; no card or row draws an outline for its
state, so a node is one tonal surface with the chip reading draft or created. `PlanDependencyHandle` names what dragging does and takes the accent
under the pointer; membership handles rest invisible until their node is hovered, focused, or
selected (`planHandleClasses`). The initiative card is 336×112 and reads like its record: title,
summary at body size, owner avatar and name, the whole date, nothing for an unset field. A project
container's header (`plan-project-header.tsx`) carries the lead's avatar, the target, the count, and one `PlanAlsoIn` chip for the other initiatives it belongs to, listing them on hover; the band takes a tonal step under the pointer. A container rests collapsed at the altitude a plan is read: below its header it names its tasks in miniature (`PlanMiniTaskList` in `plan-project-tasks.tsx`, three titles and a count), and that block or the header's chevron shows the rows on a dedicated click. Expanded, the rows are real nodes, and `PLAN_PROJECT_PADDING` keeps the container, its miniature list, and its rows concentric. The panel owns the expanded set: a search opens the containers holding matches, a revision from Athena opens the containers her tasks landed in, adding or moving a task opens its container, and collapsing a container lets go of a row selected inside it. A task row is the leanest thing on the board: no state glyph, a 32px height, its assignee as an avatar, and the due date pinned to the right, so a long name never takes the title's room. The minimap appears once the board
spills into a second column.

The canvas route lives in the independent activity layout. `ImmersiveShell` owns the full
window and `useOwnPageScroll` leaves panning to React Flow. Ordinary workspace navigation and
utility rails are absent. The floating bar keeps the way back, title, search and context actions.
The inspector remains plan-local.

Ask Athena opens the real workspace conversation in an optional responsive sheet scoped to this
plan. Normal arrival keeps it closed; explicit `?athena=start` opens and seeds it once. Closing
help restores its opener and retains unsent input, attachments and failed-send recovery. The shared
`SheetContent keepMounted` option uses a real DOM portal anchor and React Activity to retain state
while hidden modal effects disconnect; ordinary sheets keep their existing lifecycle.

`PlanBar` composes the shared `CanvasFloatingBar` and `AppBar` floating presentation. The title
truncates before fixed actions; selection actions occupy the fill slot. `GraphInspectorHost`
floats the inspector at the board's edge and takes focus when a control unmounts so Escape after
Confirm can still close it.

The panel measures its overlays into `CanvasOverlayInsets` (bar height plus the gutter on top;
the inspector on the right) and hands them to `Canvas` as `overlayInsets`, so the
first frame (`frameAnchor="start"`, anchored to the board's left), `revealAdditions`, and every fit
keep clear of the chrome. When the inspector docks, the panel refits the whole board if the strip
it leaves is narrower than the board (`boardOverflows`) and otherwise nudges the selection into
view.

Selection is xyflow's own: a draft node is not a workspace object and does not enter the global
object registry. The inspector (`plan-inspector.tsx`, with its text field in `plan-commit-text.tsx`) edits a draft's fields in filled text fields and tonal pickers, commits text on blur or Enter, and names
what Confirm will create through `describeConfirmation`; a confirmed node is read-only there with
a link to its record. Closing the inspector, by Escape or its close button, clears the canvas
selection too, so the bar's counts return.

Direct gestures map one-to-one onto ops: rename or field edit → `set_fields`; drag a task into
another container → `move_node`; draw an edge → `add_edge` (like kinds only); delete an edge →
`remove_edge`; Add project or Add task → `upsert_node`; Remove → `remove_node`, with Undo replaying
the removed subtree. A node the person adds by hand is selected with its title focused and its
text selected, so typing renames it at once, and the title commits while typing after a short pause
so the card shows the name as it forms. Task rows carry no xyflow `extent`: a row must be able to
leave its container for a drop on another container to re-home it, and a drop that changes nothing
is undone by writing the laid-out positions back (`snapToLayout`), which Re-layout also does.

An entry point that wants the conversation open on arrival navigates with `?athena=start`; the
route opens contextual help with an opening line once the plan has loaded and drops the flag.

Motion lives in `apps/web/src/app/globals.css` (`plan-node-enter`, `plan-field-changed`) and is
disabled under reduced motion. The canvas moves the viewport the person chose in one case only:
when a revision from Athena adds nodes, the frame widens to take them in (`revealAdditions`), so
what she just drew is never off screen. The "Athena updated" pill shares the slot above the view
controls with undoable notices, a notice winning when both are due, so no transient surface ever
overlaps the bar.

Every canvas keeps one bar of viewport commands at the bottom-left corner (`CanvasViewportToolbar`: zoom out, zoom in, fit to view, then Fit selection and Re-layout), on the same tone and shape as the floating bar. The Task graph's focused view (`graph-canvas.tsx`) adopts the same bar through
`TaskGraphPanel`'s `floatingChrome`, with `GraphViewBar` in its compact form and the bulk
selection's actions (`BulkSelectionActions`) in the selection slot; its inspector stays docked.

## Deferred

Programs as containers, plans rooted on a project or program, cycles and milestones on draft
tasks, sharing a plan, saving a plan as a template, filters and display options on the plan's view
bar, and a plan list surface.

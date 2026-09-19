# Athena interactive planning canvas

> **Reader:** the maintainers who will build the planning canvas, its plan-draft entity, and
> Athena's planning tools. After reading, they should be able to write the implementation plan
> without reopening any decision below, and a reviewer should reject a change that gates draft
> edits behind approval, creates workspace objects before a confirmation, or renders the plan on
> anything other than the shared canvas modules.

## Decision

A person plans a large body of work by talking to Athena while a canvas fills in beside the
conversation. The canvas is the existing graph canvas, extended to hold three kinds at once: an
initiative card at the root, project containers linked to it by edges, and task cards inside those
containers. Every node starts as a draft. Nothing reaches the workspace until the person confirms a
part of the plan, and confirming creates that part for real in one transaction.

The draft is durable. A new personal entity, the **plan draft**, holds the whole tree as one
document that both Athena and the person edit. Athena edits it through tools that execute without
approval, because the document is private to its owner and has no workspace consequence. Creating
real objects from it is an ordinary gated write.

This design covers the first slice: initiative, projects, and tasks, one owner, one workspace.

## Product contract

1. When the person describes initiative-sized work in the Athena thread, Athena offers to plan it on
   the canvas. The offer is a card in the thread; opening it is the yes.
2. The canvas opens in main content and the Athena rail stays visible with the same conversation.
3. Athena drafts the initiative with a proposed title and summary and applies the most relevant
   initiative template from the workspace's own template list.
4. Over several turns Athena asks about one unit of work at a time, and the canvas updates in
   batches as she writes. A batch is visible as a batch: new nodes enter together and changed fields
   are marked.
5. The person can edit anything directly on the canvas at any time, and Athena sees those edits on
   her next turn.
6. The person can confirm any node or subtree from the canvas at any time. Athena can also propose
   confirming a part once the conversation has settled it, and that proposal goes through the
   normal approval gate.
7. Confirming creates real objects immediately. Confirmed and draft nodes coexist on the canvas.
8. A plan survives closing the tab and is resumable from the same conversation, the initiative it
   is rooted on, or the plan route itself.
9. An existing initiative can be planned on the canvas. Its real record is the root and everything
   added under it starts as a draft.

## The surface

The plan route is `/orgs/[orgId]/plans/[planId]`. Its chrome is the same `AppBar` the Task graph
uses: the back affordance, the plan title, and the shared view bar with Search, Add filter, Display,
and trailing counts. The counts read `projects · tasks · draft`, where draft is the number of
unconfirmed nodes. Below the bar the canvas sits on the page surface exactly as the Task graph does.

### Node model

| Kind       | Rendering                                                                                 | Relationship it draws                                   |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| initiative | A card with the root accent bar, the initiative glyph, name, target timeframe, and owner. | Edges to every project it contains. Many-to-many.       |
| project    | A container built on the swimlane group node: a header row and its tasks laid out inside. | Containment of its tasks. Dependency edges to projects. |
| task       | The existing task card, rendered inside its project container.                            | Dependency edges to tasks.                              |

Initiative-to-project links are edges because the relationship is many-to-many. An initiative other
than the plan's root appears as an ordinary initiative card with its own edge when a project also
belongs to it. Project-to-task ownership is containment because a task has exactly one project. The
node model carries a kind so a program container fits in a later slice without redesign.

The container layout reuses `layoutGrouped`: each project is a group whose members are its tasks,
dagre lays the tasks out inside the group, and the groups pack into lanes. Initiative cards sit in a
leading column and the component-aware engine positions them against their project edges. Re-layout
increments the layout epoch as it does today.

### Draft and confirmed states

A draft node uses the proposal system's ghost grammar: a dashed primary outline at reduced opacity,
a dashed status glyph, and a `draft` pill. A confirmed node is the normal tonal card with a
`created` mark and the existing open affordance that deep-links to the real object. Confirmation
morphs a node from ghost to solid in place through the view-transition name the card already
carries.

### Selection, inspector, and actions

Selection uses the shared selection registry, the selection frame, and the selection bridge. The
floating selection bar gains one primary action, **Confirm**, whose label names the count and kinds
it will create. Properties and Remove remain. The docked inspector comes from the graph inspector
host with its existing width law and compact cover behaviour. For a draft node the inspector is an
editor for that node's fields and its relationships, with a Confirm button that names what it will
create and an **Ask Athena about this** action that seeds the rail composer with the node named.
For a confirmed node the inspector is the existing project or task peek.

The floating viewport toolbar, zoom controls, minimap, command notices, and keyboard chords are
unchanged. Below the docking threshold the inspector covers the canvas, and below the shell's own
compact breakpoint the Athena rail covers main content, both as they do today.

## The plan document

### Table

`plan_draft` lives in `packages/db/src/schema/crosscutting.ts` directly after `template`, because
it is the same shape of thing: a user-authored configuration with a jsonb payload that spans every
work kind.

| Column               | Notes                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| `id`, timestamps     | Standard.                                                                           |
| `owner_user_id`      | The person. Plans are personal, like Athena sessions. Cascade on user delete.       |
| `organization_id`    | The workspace the plan writes into. Fixed at creation.                              |
| `session_id`         | The Athena session hosting the conversation. Nullable, set null on session delete.  |
| `root_initiative_id` | The real initiative when planning an existing one. Nullable, set null on delete.    |
| `title`              | Shown in the app bar and the initiative detail action. Defaults to the root's name. |
| `status`             | `active` \| `committed` \| `archived`. `committed` means every node is confirmed.   |
| `revision`           | Integer, incremented on every document write.                                       |
| `document`           | jsonb, `$type<PlanDocument>()`.                                                     |
| `archived_at`        | Nullable.                                                                           |

Indexes: `(owner_user_id, status)` and a partial unique index on `(owner_user_id,
root_initiative_id)` where status is `active`, so an initiative has at most one open plan per
person.

### Contract

`PlanDocument`, `PlanNode`, `PlanEdge`, and `PlanOp` live in
`domains/work/src/contracts/plan-draft.ts`. A node is:

| Field            | Notes                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ref`            | A short handle unique within the document. Athena invents refs; the client generates them too.                                       |
| `kind`           | `initiative` \| `program` \| `project` \| `task`. Programs are reserved in this slice.                                               |
| `parentRef`      | The containing node's ref. Null for an initiative. A task's parent is a project. A project's parent is its primary initiative.       |
| `initiativeRefs` | Additional initiative nodes a project belongs to.                                                                                    |
| `initiativeIds`  | Existing initiatives, by real id, a project belongs to.                                                                              |
| `fields`         | A partial of that kind's create body. Unlike a template, a plan is one-shot, so actor, team, label, and date references are allowed. |
| `templateId`     | The template applied, when any, so the inspector can show it.                                                                        |
| `status`         | `draft` \| `confirmed`.                                                                                                              |
| `objectId`       | The real id once confirmed. Null while draft. Set for the root when planning an existing initiative.                                 |

An edge is `{ fromRef, toRef, kind: 'blocks' }` between two nodes of the same kind.

Operations are a closed union: `set_title`, `upsert_node`, `set_fields`, `move_node`,
`remove_node`, `add_edge`, `remove_edge`, and `apply_template`. `apply_template` merges the
template payload into the node's fields with the same merge templates use in the composer, so a
template never overwrites a value the person or Athena already set.

`applyPlanOps(document, ops)` is a pure reducer in `domains/work/src/plan-draft.ts`. It validates
every op against the document (kinds, parents, edge kinds, confirmed nodes), applies the batch
atomically, and returns the next document or a typed rejection naming the op. The API and the web
client both import it, so Athena's edits and the person's edits go through one implementation. A
confirmed node is read-only in the document: the reducer rejects every op that targets it except
`add_edge` and `remove_edge` to a draft neighbour, and the plan read hydrates its name, status, and
fields from the real record.

### Routes

Under the personal API, owner-only:

| Route                           | Behaviour                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/me/plans`              | Active plans, newest first, with workspace and root names.                                                                           |
| `POST /v1/me/plans`             | Create for a workspace, optionally rooted on an existing initiative. Returns the existing active plan for that root when one exists. |
| `GET /v1/me/plans/:id`          | The plan with its document and revision.                                                                                             |
| `PATCH /v1/me/plans/:id`        | `{ revision, ops }`. Applies through the reducer. A stale revision returns 409 with the current plan so the client can rebase.       |
| `POST /v1/me/plans/:id/commit`  | `{ refs }`. See Confirming.                                                                                                          |
| `POST /v1/me/plans/:id/archive` | Archives without creating anything.                                                                                                  |

Reads and the patch resolve nothing in the workspace. Commit and template application resolve the
owner's current actor in the plan's workspace and require `contribute`, so a person who lost access
between drafting and confirming is refused at the write with application-owned copy.

## Athena's tools and gating

Four tools join the shared MCP catalog, so Claude, Codex, and Athena all receive them.

| Tool          | Input                                                     | Behaviour                                                                                                                    | Gate          |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `plan_start`  | `orgId`, optional `initiative` descriptor, optional title | Creates or reopens the plan. Returns the document, the canvas href, and the templates for each kind with their descriptions. | Private draft |
| `plan_read`   | `planId`                                                  | The current document and revision.                                                                                           | Read          |
| `plan_draft`  | `planId`, `revision`, `ops`                               | Applies a batch through the reducer. Returns the next revision and a summary of what changed.                                | Private draft |
| `plan_commit` | `planId`, `refs`                                          | Creates the named nodes for real. See Confirming.                                                                            | Write         |

`plan_read` carries `readOnlyHint`. `plan_start` and `plan_draft` carry a first-party annotation,
`_meta['docket/approval'] = 'private_draft'`, stating that they write only to the caller's own plan
draft. `classifyTool` gains a `privateDraft` flag that is true only for a first-party tool carrying
that annotation, and the policy table treats it as: `suggest` records only, every other dial
executes. Reads remain reads and every other write remains a write. The annotation is a Docket
extension and is documented in `mcp-surface.md` beside the widget metadata.

`plan_commit` is an ordinary write. Under the default dial it lands in the thread as a proposal
group whose ghost rows are the nodes it would create, and approving it runs the commit. That is how
Athena offers a confirmation moment in conversation.

### System prompt

`buildSystemPrompt` gains a planning section. In every session: recognise initiative-sized asks and
offer the canvas by calling `plan_start` and saying so in one sentence. While a session has an
active plan, the session context carries the plan id and revision, and the prompt instructs Athena
to read the plan at the start of each turn, apply a template on the first draft of a node, write in
batches through one `plan_draft` call per turn, ask about one unit of work at a time, ask for names
only when the person has not already implied them, and call `plan_commit` for a part only after the
person has settled it in conversation.

`plan_start`'s result is what Athena renders as the offer. Its structured content includes `planId`,
`href`, and `title`. The chat thread renders a tool activity whose tool is `plan_start` as a
**Plan card** with the title and an **Open canvas** action. The card is a durable activity, so the
offer survives a reload and can be reopened later.

## Confirming

Confirming from the canvas is the person's own write and skips the approval gate. The selection
bar's Confirm and the inspector's Confirm both call the commit route with the selected refs.

`commitPlanNodes(plan, refs, actor)` in `apps/api/src/lib/plan-draft/commit.ts`:

1. Closes the ref set over unconfirmed ancestors, so a task never lands without its project and a
   project never lands without its primary initiative.
2. Walks parents first and creates or matches each node using the same reconciliation the
   `organize` tool uses. `organize`'s per-kind create-or-match steps move into a shared module both
   callers import; the tool keeps its input shape and behaviour.
3. Links each project to every initiative in `initiativeRefs` and `initiativeIds`.
4. Creates dependency edges whose endpoints are both confirmed after this commit.
5. Writes `objectId` and `status: 'confirmed'` onto each node, increments the revision, and records
   the change set the `undo` tool reads, all in the same serializable transaction.
6. Sets the plan's status to `committed` when no draft node remains.

The result names each node as created or matched, and the canvas morphs the confirmed nodes in place
with a view transition. Later edits to a confirmed node go to the real object: the person through
the existing peek editors and object commands, Athena through her normal update tools and their
gate. When a confirmed object is later trashed or renamed in the workspace, the plan read reflects
it, because the read hydrates confirmed nodes from their real records.

### Subtasks, rosters, and undo

A plan that describes a feature launch needs three things the first slice left out, and they arrive
together. A task node may name another task as its `parentRef`, one level deep, so a feature task
carries its engineering subtasks; the reducer refuses a third level, and the commit creates the
subtask after its parent, with `parentTaskId` set and the parent's project inherited, whether that
parent lands in the same commit or was confirmed by an earlier one. `plan_start` and `plan_read`
return the workspace roster beside the templates — `people`, each with the `teamIds` they are on,
and `teams` — because `assigneeId` and `teamId` take ids and a planning conversation produces only
names; the system prompt tells Athena to send a feature task to someone on the product team and
each engineering subtask to someone on the team that owns that area, and to write a feature and its
subtasks in one `plan_draft` batch. Every commit stamps its plan and that plan's owner onto the
change set's origin, so `POST /v1/me/athena/changes/{changeSetId}/undo` accepts a commit the person
made from the canvas as readily as one Athena made in a session: the commit response carries
`changeSetId` and `createdCounts` (`initiatives`, `projects`, `tasks`, `subtasks`, counting only
what was created) so the client renders one line — "Created 1 initiative, 3 projects, 24 tasks ·
Undo" — and the Undo behind it reverses the whole commit. A plan commit reverses through the
reporting path rather than the all-or-nothing one, because the atomic reversal understands only
tasks and the edges between them, and a plan commit also creates containers.

**On the canvas.** A subtask is a row in its feature task's project container, listed directly
beneath the feature task and indented one step, on the container's own tone where a feature task
row is raised one tone step. A feature task that carries subtasks leads with a chevron that folds
them; they also hide with their container. A draft feature task offers Add subtask on hover and in
the inspector's overflow; on a subtask that action is disabled, because subtasks go one level deep.
The collapsed container's miniature list names feature tasks only. Rows show the assignee's avatar
and the team's name.

The canvas reads the roster from `GET /v1/me/plans/{id}/roster`, the same `people` and `teams` the
tools return. The inspector picks the team first for a project or task, then the person from that
team's people (everyone when no team is set, each hinted with their teams); both pickers show names
and store ids.

Confirming replaces the notice slot above the view controls with one line naming what was created,
kind by kind with zero kinds left out, and Undo. Undo calls the personal undo route with the
commit's change set; the line then reads "Undone" with the counts struck through. Undoing a plan
commit also returns the nodes that commit created to `draft` with no object on the plan (nodes the
commit matched stay confirmed), so the canvas is back where it was before Confirm and the person can
adjust and confirm again. A failed Undo names its cause by Problem code — already undone, changed
since, signed out, not allowed, rate limited, offline, or a server failure — and keeps Undo on the
line.

## Entry and navigation

**From the thread.** The Plan card's Open canvas action pushes the plan route and reveals the Athena
rail with that session selected, using the same rail-reveal path the contextual entry points use.

**From an initiative.** The initiative detail header gains a **Plan with Athena** action. It calls
`POST /v1/me/plans` with the initiative as root, which returns the existing active plan when there is
one, then opens the plan route with the rail revealed and the composer seeded with a draft message
naming the initiative.

**From the plan route itself.** Opening the route directly loads the plan and reveals the rail with
the hosting session. When the plan has no session yet, the rail opens the person's thread for that
workspace and the first message attaches the plan.

## Direct editing

Every canvas gesture on a draft node writes through the same reducer. The same gesture on a
confirmed node goes to the real object through the existing peek editors and object commands:

| Gesture                                      | Op            |
| -------------------------------------------- | ------------- |
| Rename inline, edit a field in the inspector | `set_fields`  |
| Drag a task into another project container   | `move_node`   |
| Draw a dependency edge between two nodes     | `add_edge`    |
| Select an edge and press Delete              | `remove_edge` |
| Add task, Add project from the pane menu     | `upsert_node` |
| Remove from the selection bar                | `remove_node` |

The client applies the op optimistically, sends the patch with the current revision, and on 409
rebases by replaying its unacknowledged ops onto the returned document. Removing a draft node is
immediate and offered with Undo through the canvas command notice; removing a confirmed node means
Move to trash on the real object through the existing path, and the plan node follows.

## Live updates and motion

The plan route reads the plan through the typed query layer with a live poll of two seconds while
the hosting session is running and ten seconds otherwise. The session's existing activity stream is
also subscribed while a turn is in flight, and an `action` activity whose tool is `plan_draft` or
`plan_commit` triggers an immediate refetch.

`planDiff(previous, next)` in `apps/web/src/components/plan-canvas/plan-diff.ts` returns added
nodes, removed nodes, and changed fields by ref. The canvas uses it for three effects: new nodes
enter with a staggered scale-and-fade, sixty milliseconds apart; changed fields sweep a highlight
that fades over six hundred milliseconds; and a `role="status"` pill in the top-right corner reads
`Athena updated N fields`. Every effect is disabled under reduced motion, and none of them move the
viewport. Confirmation morphs use the view-transition names the cards already carry.

## Permissions and ownership

A plan belongs to one person. Only the owner reads, edits, commits, or archives it. Athena acts as
the owner's current actor, so a plan is never visible to a workspace, a team, or another Athena
session. Sharing a plan is out of scope for this slice.

## Testing

- **Reducer**: every op, every rejection, template merge precedence, confirmed-node restrictions.
- **Diff**: added, removed, and changed detection, including a field changing back to its previous value.
- **Commit service**: ancestor closure, parents-first ordering, matching over duplication on a second commit, initiative links for many-to-many, edge creation only between confirmed nodes, change-set recording, transaction rollback on a failing node.
- **Approval policy**: the private-draft annotation executes under `act_with_approval` and `autonomous`, records only under `suggest`, and is ignored on third-party tools.
- **Routes**: owner isolation, revision precondition and 409 body, commit permission refusal with application-owned copy, one active plan per root.
- **Tools**: `plan_start` reopening an existing plan, `plan_draft` rejecting a stale revision, `plan_commit` landing as a proposal under the default dial.
- **Web**: draft and confirmed rendering, container layout with tasks inside projects, the Confirm flow from the bar and the inspector, direct edits and optimistic rebase, the Plan card in the thread, the initiative detail action, and the live refetch on a `plan_draft` activity.
- **End to end**: chat mentions an initiative, Athena's Plan card appears, opening it shows the canvas beside the rail, a draft fills in, confirming a project creates it, and the initiative detail page lists the new project.

## Scope

Deferred to later slices: programs as containers, planning rooted on a project or program, cycles
and milestones on draft tasks, estimates, sharing or co-editing a plan, saving a plan as a template,
and a plan list surface. Each fits the node model and routes above without changing them.

## Alternatives rejected

**Ghost proposals as the draft.** Proposals are per-turn batches, so refining one project across
three turns produces three superseding proposals, partial confirmation of one `organize` call is
unsupported, and a direct canvas edit becomes a patch to a stored tool input.

**A markdown outline as the draft with the canvas as a projection.** Fields beyond title and
description are lossy, parsing is brittle, and every canvas gesture would round-trip into text.

**Real objects immediately, with a planning status.** Confirmation loses its meaning and an
abandoned planning session leaves objects in the workspace.

**The initiative as a header frame above the canvas.** It read as page chrome and hid the
many-to-many relationship. A root card with edges shows a shared project honestly.

**Gating draft edits.** Under the default dial every field fill would need a click, which removes
the conversational flow the feature exists for. Restricting the exemption to first-party tools that
write only to the caller's private draft keeps the workspace write boundary intact.

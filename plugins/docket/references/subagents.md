# Coordinate subagents through Docket

Read this when dividing an authorized assignment among agents. Apply the assignment level from
[Agent assignments](agent-work.md); use [Working in Docket](work-management.md) before tool calls.

## Choose useful delegation

Delegate bounded deliverables that can be checked independently: a signup repair and orientation
copy, or a donor-data review and event logistics plan. Keep tightly coupled edits with one agent or
sequence them. A small lookup or second opinion can remain part of its existing task; do not create
one Docket task per tool call, agent, or internal reasoning step.

Use the host's available subagent mechanism only when the user's request, standing instructions, or
applicable workflow authorizes it. Docket access does not itself authorize spawning agents, messaging
other chats, or assigning Athena. If delegation is unavailable, perform the authorized work directly
and explain the difference from the requested coordination.

## Map deliverables to work records

Read the parent assignment and existing tasks before dividing work. Reuse one task per meaningful
deliverable, with its owner, acceptance criteria, and dependencies. Create missing tasks only within
authorized capture/planning scope; an internal read-only review can use a bounded slice of the parent
task without a new record. Link tasks to the project or program they advance. Projects and programs
can contribute to initiatives; tasks do not attach directly to initiatives.

For registered Docket actors, distinguish `assignee` (accountable actor) from `delegate` (agent doing
the task). Resolve actual roster IDs and verify the supported dispatch mechanism before changing an
assignment. A host-local subagent is not automatically a registered actor: do not invent actor IDs,
assign it to Athena, or claim that updating a field spawned a worker. Conversely, spawning a local
worker does not update Docket assignment or persist a session association. State which mechanism
was used and what was actually saved.

## Give each worker a bounded handoff

Include the following in the dispatch, using only authorized work content:

- **Assignment:** Docket workspace and task reference, or the specific slice of a parent record.
- **Purpose:** The project/program outcome and relevant initiative context.
- **Deliverable:** What to produce and the acceptance criteria it must satisfy.
- **Boundaries:** Files, artifacts, interfaces, decisions, and side effects the worker may change.
- **Dependencies:** Inputs it can rely on, what must finish first, and agreed integration points.
- **Reporting:** What it returns, whether it may write to Docket, and who owns state/outcome updates.

Give workers readable references plus the minimum necessary requirements. If they cannot access
Docket, supply an authorized scoped snapshot and identify it as a snapshot; do not share credentials
or promise unreadable linked content. Include the relevant skill/reference paths when workers do
not inherit plugin instructions. Preserve workspace permissions and keep private content out of
public artifacts.

For the Orientation project, the signup worker owns expired-link behavior and its focused checks.
The copy worker owns instructions and comprehension checks; its final review depends on the actual
signup flow. Assign a single owner for shared signup-screen text, then sequence any required handoff.
The coordinator verifies that a new volunteer can finish the combined orientation independently.

## Coordinate dependencies and shared changes

Record meaningful dependencies through supported relations when writes are authorized; the blocker
points to the blocked task or project. Independent work can proceed while a prerequisite runs.
Avoid two workers changing the same interface or shared file without an explicit integration owner
and sequence. Use isolated workspaces when the host and repository require them; preserve unrelated
changes and review the resulting artifacts before integrating.

Choose one writer for each task's state and final outcome: the worker when authorized, otherwise the
coordinator. Workers can return findings without mutating records. Read current state before writing
so a late result does not overwrite another worker's changes or repeat an already posted update.
A handoff specifies the deliverable, current status, remaining criteria, and next responsible actor.

Use supported completion notifications or bounded waits. Track the outstanding deliverable and do
independent work instead of repeatedly checking every worker. A blocker report should name the
missing prerequisite and its effect. Apply `get-back-on-track` when coordination becomes monitoring;
do not spawn replacement agents for an unchanged blocker or silently abandon active work.

## Accept the result and close the assignment

Each worker returns its work reference, deliverable/artifact links, criteria checked and evidence,
remaining gaps, and any Docket changes it actually saved. A success message is a claim to inspect,
not proof of acceptance. Review the changed artifacts and run the checks needed for the remaining
risk; reuse valid evidence rather than rerun every worker's checks automatically.

The coordinator checks interfaces and the combined project outcome. A copy review and a green
signup test do not prove that a volunteer can finish orientation. Keep the project open when its
acceptance remains unverified, even if all workers have finished their assigned slices. For an
initiative, distinguish completed deliverables from evidence of the strategic change. For a program,
record the period's results and remaining exceptions rather than declare all ongoing work finished.

Return concise results to the original records when authorized, preserve requirements, and report
what remains to the user. Do not replace the existing project with a new “agent coordination” project
or put chat transcripts, monitoring history, or operational dumps into task descriptions.

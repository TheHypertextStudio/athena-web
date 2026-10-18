# Agent assignments in Docket

Read the section for the current assignment. For delegation, also read
[Subagents](subagents.md). For tools and saved changes, use [Working in Docket](work-management.md).

## The default when Docket is enabled

For substantive execution, try to relate the request to an existing Docket task or project before
starting. This applies even when the user did not mention Docket in the latest message. Reuse the
known assignment; search narrowly only when its identity is missing. Match the requested outcome
and scope, not just similar titles. A project can be the initial reference while its relevant task
is resolved. A standalone task is valid; do not invent a project or initiative to satisfy a hierarchy.

Tell the user which record you will work from, what you will verify, and where the result will go.
For example: “I’ll work from T1 in the Orientation project, verify signup after link expiry, and
record the result on T1.” Explain this behavior during onboarding and when the assignment changes;
do not repeat an adoption ceremony for every task. Identify an inferred match as a match, not a
saved chat association. Resolve competing plausible assignments before writing to one.

If nothing matches, propose a task with the requested result and its likely placement. Capture it
when the current request or an adopted automatic-capture convention authorizes creation; use
`capture-work` and read it back. A request to implement a change does not, by itself, authorize new
projects, bulk imports, or a replacement planning system. Continue independently authorized work
when the tracking gap does not affect its scope. Report the missing record rather than fabricate one.

If the user says to work outside Docket, honor that exception for the stated scope: do not search,
create records, or post results for that work. Do not silently disable Docket for later assignments.
An ordinary factual question or explanation does not require a tracking record. If access fails,
use known assignment context provisionally, disclose the unrefreshed state, and continue authorized
work that does not depend on unavailable requirements. Do not turn alignment into an access loop.

## Establish the assignment level

| Level      | Decisions the agent makes within its assignment                                                            | Completion or review evidence                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Task       | Execute the specified result; choose implementation details within scope; surface blockers.                | Check the task's acceptance criteria and report the verified result.                            |
| Project    | Sequence tasks, resolve dependencies, coordinate authorized contributors, and integrate deliverables.      | Verify the project's finish line across the combined result, not merely the sum of task states. |
| Initiative | Assess the intended change and recommend which projects or programs to start, adjust, prioritize, or stop. | Compare outcome evidence with the initiative's intent; explain gaps and the next decision.      |
| Program    | Perform or coordinate the assigned operating work; assess service quality, flow, and exceptions.           | Review the period's results, service expectations, unresolved exceptions, and next work.        |

Default a concrete execution request to task responsibility. A project reference provides context;
it does not automatically assign coordination of the whole project. Initiative stewardship and
program operation require an explicit assignment or an already agreed standing responsibility.
Name the current deliverable: an assessment, plan, draft, implementation, or verified outcome.
A request for an assessment finishes with that assessment; it does not authorize implementing every
recommendation. Context can extend above the assignment; decision rights do not expand with it.

## Apply each level

**Task:** Read the task and only the parent requirements and dependencies needed to execute it.
Preserve its scope and acceptance criteria. If evidence invalidates the approach, explain the
consequence and recommend the necessary change instead of quietly expanding the assignment.

**Project:** Read its outcome, constraints, existing tasks, dependencies, and relevant initiative or
program context. Identify missing deliverables before adding tasks. Define how the pieces will work
together and who checks that result. Create or change work within the requested planning scope;
execute and delegate only within the execution authority granted. Use milestones for meaningful
checkpoints, not to manufacture dates. Report unresolved integration and acceptance gaps explicitly.

**Initiative:** Read its intended change and connected projects/programs. Assess whether their
results support that change, what evidence is missing, and which tradeoff needs a decision. Completed
tasks or projects do not establish strategic success. Propose a bounded next project or a change to
an existing effort; do not attach execution tasks directly to the initiative. Read related work
proportionately rather than audit the whole workspace on each turn. Retiring work, reallocating
people, spending money, and changing commitments still require the applicable authority.

**Program:** Read its operating purpose, expectations, current work, and relevant recent outcomes.
Separate routine work from exceptions and bounded improvements that merit a project. Assess health
from actual service evidence, such as unresolved volunteer requests or missed response expectations,
not an invented percentage complete. One successful task does not complete the program. Programs
can be paused, wound down, or completed when that is the authorized outcome; ongoing work does not
imply permission to schedule recurring agent runs.

## Record results at the right level

When the user requests execution under an adopted Docket tracking workflow, routine progress/state
changes and concise result updates on the assigned records are part of that workflow, subject to
available write permissions. Installation alone, read-only requests, or an unrelated implementation
request do not grant those writes. State the reporting behavior when introducing the workflow;
respect established authorization without asking again at every update.

Use task state and verified checkboxes for task completion and `comment` for its concise result or
blocker. Use `report_status` for a project, initiative, or program assessment; a health rating changes
saved health, so include it only within authorized assessment writes. Read current work before
reconciling concurrent changes and verify saved changes. Keep descriptions evergreen.

A task result may reveal a project dependency or initiative risk. Explain that consequence and post
at the relevant level when authorized; do not mark every ancestor complete or change its scope merely
because the task finished. Resume subsequent sessions from recorded requirements and results.

## Host behavior and durable conventions

These are plugin instructions selected by the host, not an install hook that intercepts every
conversation or tool call. Do not claim that enabling the plugin guarantees universal enforcement,
creates standing automation, or grants background monitoring. For consistent use in a repository,
onboarding can offer to save the convention in existing guidance when the user requests it.
Local subagents, registered Docket actors, and Athena are different execution mechanisms; see
[Subagents](subagents.md) before coordinating them.

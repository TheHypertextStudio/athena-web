# The Docket Workflow

**Define the outcome. Choose the next work. Do it. Verify the result. Update the plan.**

Use Docket to decide what to work on, give people and agents a clear assignment, and track the result.
Use the same steps for a personal task, a product launch, a volunteer program, or ongoing operations.
The work determines the structure and review cadence.

## Connect direction, delivery, and execution

An **Initiative** defines a change worth pursuing and connects the projects and programs that
contribute to it. Name the intended outcome, accountable owner, and evidence of progress. Use it to
decide what to start, adjust, defer, or stop. A high task-completion count does not prove the change.

A **Project** delivers a bounded outcome. Define its finish line, lead, scope, dependencies, and how
to verify the combined result. Tasks divide that work into executable results. Milestones identify
meaningful delivery checkpoints; dates express actual commitments.

A **Program** organizes an ongoing responsibility. Define its purpose, owner, service or quality
expectations, review cadence, and current work. Routine tasks and bounded improvement projects can
both advance it. Review health, flow, and exceptions. Wind down or complete a program when that is
the intended outcome, rather than treating every successful task as the end of the program.

A **Task** defines one result someone can execute and check. Relate it to the project or program it
advances, or keep it standalone when no larger effort is needed. Tasks do not attach directly to
initiatives. Do not create every level before starting useful work.

Make three connected decisions: which outcomes deserve capacity, which projects/programs will
advance them, and which tasks should happen next. Revisit the appropriate decision when execution
changes the evidence. Ask **Did the task work? Did the project deliver? Is the initiative producing
the intended change? Is the program meeting its operating expectations?**

For example, “Make volunteering easier to start and sustain” is an initiative. Self-service
orientation is a project; volunteer support is a program. Repairing expired signup links is a task.
Working signup links contribute to orientation; they do not establish improved volunteer retention.

## How agents participate

With Docket enabled, the default is to try to align substantive execution with an existing task or
project, even when the latest prompt omits Docket. The agent explains the chosen work reference,
what it will verify, and where results will go. Explicit requests to work outside Docket take
precedence. Simple questions do not require task creation; a missing record or connection is reported
without obstructing independently authorized work.

Assign responsibility explicitly: a task agent executes its criteria; a project agent coordinates
and verifies delivery; an initiative agent assesses strategic progress and recommends tradeoffs; a
program agent performs or coordinates assigned operating work and handles exceptions. Parent context
helps each agent decide, but does not expand its decision rights. Complete the requested assessment,
plan, or implementation rather than automatically taking over the entire parent effort.

See [Agent assignments](agent-work.md) for record matching, level-specific decisions, and outcome
reporting. Read [Subagents](subagents.md) when delegating parts of an assignment. Plugin instructions
are selected by the host; enabling a plugin is not proof of universal enforcement or background work.

## 1. Define the outcome

Capture requests before they disappear into chat or memory. Leave unfiled work in Triage until its
purpose and placement are clear. Reject, merge, or defer requests that should not become commitments.

Before starting a task, describe the result, relevant constraints, and how to verify completion.
“Make signup better” is too broad. “A returning user signs in after token expiry without creating a
second account” names a result and a check. Match the detail to the risk: a phone call needs less
specification than a payment migration.

Use a Task for one piece of work. Use a Project for an outcome with a finish line and several tasks.
Use a Program for ongoing work such as donor relations or customer support. Use an Initiative to
connect projects and programs to a larger outcome; do not put tasks directly under it. A task can
stand alone. Do not create every layer before doing useful work.

## 2. Choose the next work

Decide what to do now, what must happen first, and what will wait. Read dependencies and current
commitments before prioritizing new requests. Give selected work a responsible person or agent;
identify the accountable person when delegating work on their behalf.

Plan across the workspaces the person actually works in. A four-hour budget is four hours total,
not four hours per organization. Explain missing estimates and calendar coverage. Use due dates for
real deadlines and timeboxes when work needs a specific place in the day. Do not invent dates to
make a plan look complete. A priority is not a promise to complete everything immediately.

## 3. Do the work from its task

Start a work session from its Docket assignment. For execution, resolve the task under the known
project when needed. Read its scope, acceptance criteria, and relevant dependencies. Work on the next action that advances that result. Link code, documents, conversations,
and other working artifacts from the task instead of copying everything into its description.

A person or agent can execute the task. Delegation specifies the result, boundaries, and review
requirements; it does not remove accountability. When work is blocked, record the blocker and move
attention to an unblocked task. When an agent starts repeating CI checks or investigating unrelated
problems, use `get-back-on-track` to return to the original task and its unmet criteria.

## 4. Verify the result

Check the task's actual acceptance criteria. Activity is evidence of an attempt, not completion.
For a signup repair, test returning-user sign-in. For an event, confirm the required venue, staffing,
and attendee arrangements. For a report, check the requested content and delivery.

Mark only verified criteria complete. State what passed, what was confirmed by someone else, and
what remains unchecked. An agent that produced a draft has completed a draft, not its approval or
publication. New information can require another attempt or an explicit change to the task's scope.
Do not rewrite the criteria merely to match what happened.

## 5. Update the plan

Update the task's state and verified acceptance checkboxes. Record a concise result or blocker in a
comment or project update, with links to detailed evidence. Task descriptions explain the work and
constraints; they are not execution diaries.

Review the effect on other work: unblock dependent tasks, identify the next action, and revise dates,
scope, or priority when the evidence changes the plan. For ongoing Programs, review health and the
next tasks instead of inventing a percentage complete. Name the next task, its dependencies, and what
must be checked before it is complete.

## What stays consistent

- Selected work has a clear result, responsibility, and a way to check completion.
- Agents try to align execution with existing tasks/projects and honor explicit exceptions.
- Sessions start from the assigned record; results return to the relevant task or container.
- Descriptions remain useful for the next execution. Updates explain what changed.
- Plans respect available time and dependencies. Changed plans are made explicit.
- One system owns each task or field. Connections and links must not create competing manual lists.

## What changes with the work

Choose structure, cadence, and delegation to suit the work. A solo designer can use a project and a
few tasks without cycles. An operations team can run a Program and schedule recurring tasks. A launch
can use milestones and dependency reviews. A team can plan in Cycles when that cadence helps.
Review at work-session boundaries, on a chosen cadence, or when a deadline, blocker, or result changes
what should happen next. These choices do not remove the need to define, choose, execute, verify,
and update.

Docket coordinates work across organizations without combining their memberships or permissions.
Code, files, calendars, and provider records remain in the tools used for them. If the user requires
another tracker to own an issue, define Docket's role and the update direction explicitly. Verify the
supported connection before promising sync. Do not maintain two independent copies of the same task.

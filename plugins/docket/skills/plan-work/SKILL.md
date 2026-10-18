---
name: plan-work
description: Use when the user asks to shape a Docket project, initiative, or program, break an outcome into work, map dependencies, or define recurring work.
---

# Plan work

Read [Working in Docket](../../references/work-management.md) before writing.

Read [The Docket Workflow](../../references/docket-workflow.md) when choosing the work structure.
Read [Agent assignments](../../references/agent-work.md) for project coordination, initiative
stewardship, or program operation. Read [Subagents](../../references/subagents.md) when dividing
authorized work among agents. Distinguish a requested plan from authority to execute it.

Start from the intended outcome, constraints, existing work, and acceptance conditions. Reuse fitting
initiatives and projects. Separate deliverable work from incidental implementation steps; do not
invent departments or owners. Use workload evidence to discuss feasible scope and dates.

For initiative-sized work, open `plan_start` against the existing initiative when available and tell
the person a planning draft is open. Use its existing node refs, roster, and literal template bodies.
For each new node, add it, apply the relevant template with `apply_template` before setting a body,
then fill its sections through `set_fields`. Applying a template copies missing fields; attaching
`templateId` alone copies nothing. Preserve already authored values. Use the current `plan_draft`
operation schema and revision; after a stale-revision failure, read the draft and reconcile before retrying.

Add dependencies in their real direction: the blocker points to the work it blocks. Read the finished
draft through `plan_read`. Commit only the portion the user has settled using `plan_commit`; an
exploration request can end with the draft. Existing authorization to create the plan needs no second
permission ceremony. Inspect the result and read created entities back, including ancestor work.

Use `organize` for a settled structure that should be created or matched together. Use `update` for
placement changes and `link` for relations between existing items. Check the current relation contract
before linking different kinds of work. Templates supply content and defaults, not child tasks.

For explicitly requested recurrence, use `repeat_task` for one recurring task and
`define_process` plus `schedule_process` for a multi-step process. Resolve timezone, cadence,
destination, and relevant templates; do not infer a schedule from a reusable template or a one-time plan.

Example: in a launch initiative with Docs and Onboarding projects, add only missing launch tasks and
make sign-in readiness block onboarding. Preserve existing work instead of creating a second launch.

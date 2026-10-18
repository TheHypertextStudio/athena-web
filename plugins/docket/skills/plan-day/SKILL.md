---
name: plan-day
description: Use when the user asks what to work on, plans a day in Docket, checks workload, or changes a daily plan or timebox.
---

# Plan the day

Read [Working in Docket](../../references/work-management.md) before using work tools.

Read [Agent assignments](../../references/agent-work.md) when choosing work for agents.
Prioritize tasks against the relevant project/initiative outcomes and program responsibilities;
a daily recommendation does not delegate or create standing agent work.

Resolve the person's local date and timezone from trustworthy context; ask only when missing or
ambiguous. Start with `brief` for commitments, calendar events, blocked work, due work, and pending
approvals across workspaces. Read `view_workload` for each relevant workspace with the stated
full-day work-hours budget. Disclose an assumed budget and missing estimates.

Combine the workspace views before allocating time. Headroom excludes meetings and other workspaces;
it does not establish free calendar slots. Respect calendar commitments, dependencies, existing plans,
and the single daily budget. Offer a practical next action and identify what will not fit.

Distinguish an empty connected calendar from unavailable or unconnected calendar coverage. If coverage
is missing, say so, use known commitments, and ask for a consequential scheduling constraint only when
needed. You can still recommend priorities; do not invent free time or require calendar connection
before providing useful help. Offer connection when it would improve the chosen workflow.

“What should I work on?” authorizes a recommendation. A request to save or change the day authorizes
the relevant `plan_day` edits. Read with no edits and no `autoPlan` when only inspecting. Do not
complete tasks or start timers while merely organizing their time.

Use `autoPlan` only when the user wants automatic scheduling and its saved availability fits their
requested budget. The tool has no `availableHours` argument: a four-hour `view_workload` call does not
configure the planner. Use explicit add/timebox edits when a requested cap differs, checking timezone
offsets and calendar gaps. Inspect returned items and `unplaced`; an overfull day is not fully scheduled.

Example: “I have four work hours today” means four hours total across workspaces, with uncertain
estimates called out. It does not mean four hours for each workspace or four hours plus meetings.

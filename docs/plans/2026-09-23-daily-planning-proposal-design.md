# Daily planning as a proposed day

This plan is for the Docket product and engineering team. Implement the proposal, capture the resulting screens, and use the acceptance cases below before releasing the revised planner. The current deployed flow saves drafts and accepted history, but its planning screen still makes a person build most blocks by hand. The [September 23 design audit](../design/audits/2026-09-23-daily-planning.md) records the visible failures.

## Decision

Docket prepares a usable day before asking the person to arrange it. It gathers existing commitments, selected work, due and carried work, dependencies, planned durations, and the person's work schedule. It proposes an order and timed blocks. The person edits that proposal in place. Athena may add a short assessment or propose missing work, but neither the schedule nor confirmation depends on an LLM.

The alternative is the current manual-first canvas: the person adds tasks, chooses durations, and places every block. That duplicates the work Docket already has enough data to do. A separate AI-generated plan is also wrong as the default because a model can invent constraints, delay the first render, and leave the core feature unavailable when Athena is off.

The [flow state diagram](daily-planning-proposal-flow.mmd) shows where a proposal, draft, accepted version, and actual work differ. A proposal never overwrites an accepted plan. A later adjustment creates a revision; recorded work stays in the time ledger.

The goal is not to fill every minute. Docket preserves protected time and the person's chosen buffer, then makes the remaining capacity useful. A full calendar with no room to think is not a successful plan.

The buffer is a user preference rather than a universal score. The first-run default should reserve 15 percent of otherwise free work time, rounded up to a 15-minute increment. The person can lower, raise, or clear it from the planner. The agenda shows the reserved space as open time, not as a fake event.

## The failures this plan addresses

| Current behavior                                                            | Why it fails                                                                     | Required behavior                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The draft starts with tasks and almost no blocks.                           | The person still performs the central scheduling job.                            | The first editable draft contains ordered work and proposed blocks.                                                                      |
| “Minutes available” sits above work without an action.                      | The number neither explains a conflict nor helps resolve one.                    | Show capacity when it affects a decision, name the affected tasks, and offer shorten, move, change finish time, or leave unscheduled.    |
| Task cards are narrow, padded, and detached from the agenda.                | Titles lose width and the cards do not read as movable objects.                  | Give cards a bounded surface, a restrained grip, most width for text, direct duration editing, and clear focus and drag states.          |
| Row order, task priority, and calendar position blur together.              | A drag can look like a change in importance or scheduled time.                   | Row reorder changes only today's intended sequence; agenda placement changes time; task priority stays separate.                         |
| Agenda and block drop targets are hard to discover.                         | The person cannot see the result before dropping.                                | Highlight free slots and existing blocks during a drag, show the proposed interval or allocation, and provide controls without dragging. |
| Review plan begins with a huge deterministic narrative.                     | It displaces the agenda, repeats task names, and impersonates Athena's judgment. | Keep factual status compact and render qualitative assessment only when Athena actually generates it.                                    |
| A sticky footer covers the agenda and the step labels look like dead links. | The person cannot inspect the full day or trust the navigation.                  | Keep actions out of the timed area, make steps navigable, and retain edits.                                                              |

## What each screen does

**Today** remains the default home. It offers Plan day, Resume planning, or Adjust today according to saved state. It also shows the next accepted block. Planning tomorrow near the end of today uses the same flow with the date visible. Starting a timer remains a separate action.

**Review yesterday** handles unresolved commitments in one pass. It shows completed and recorded work, then asks what happens to unfinished items. Bulk Today, backlog, another date, and Done decisions remain available. A new user skips this screen. A person who missed several days sees one combined review.

**Plan today** opens with Docket's proposed agenda already drawn. The work list and agenda are two parts of one canvas, not mutually exclusive modes. Desktop shows compact task cards beside the time-scaled agenda; a phone shows the cards and agenda in one vertical flow with a direct jump between them. Each card keeps the full-width title and project together, a direct numeric Planned time field, and one visible Schedule action. Its grip reorders selected work or drags it onto a free slot or an existing block. A card dragged over a target shows the exact resulting placement; touch and keyboard controls perform the same moves. The card's order records intended sequence, not a change to the task's priority field.

At 1440 pixels, the desktop canvas should give the timed agenda at least 600 pixels and the work rail roughly 400 pixels. The title and nearby project should receive most of each card's width. A phone should use its full width for both work and agenda rather than squeeze them into columns. These are capture targets, not hard CSS widths. The [screen flow](daily-planning-screen-flow.mmd) makes the distinct page transitions explicit.

The agenda distinguishes fixed events, pinned/manual blocks, proposed blocks, and unplaced work. Proposed blocks include one or more related tasks; long work can occupy more than one session. Dropping a task on an existing block adds it when the block has capacity or previews an extension or split when it does not. Docket never silently overlaps an event. The available-work browser remains separate and searchable. It ranks carried work, due work, and project work with a concrete reason. A project with a milestone and no actionable task can show a proposed task for explicit Add or Dismiss; no task is silently created.

Today's explicit commitments enter the proposal automatically: existing daily selections, work already placed in a block, and carried work the person selected during yesterday's review. Docket then proposes eligible work from due and project queues to use remaining capacity. Newly proposed work is marked Suggested with a concrete reason, such as “Due today” or “Next task in Release launch,” and can be removed before confirmation. A task already completed or being tracked stays visible as actual or active work rather than becoming a second planned task.

For example, a person opens the planner at 10:40 after recording 25 minutes on a launch update. A meeting starts at 11:30, and the person finishes at 17:00. Docket shows the recorded work in the elapsed part of the agenda, proposes only the remaining work after 10:40, places the longer review after the meeting, and keeps the chosen buffer free. If release prep cannot fit, it appears under Unscheduled with a move or duration action. The person does not have to reconstruct the morning or drag every task into position.

The work list does not display a passive “minutes available” total. When everything fits, the agenda itself shows the answer. When work does not fit, an inline decision area names the affected tasks and offers actions on them: shorten Planned time, move a task to another day, change the finish time, or leave it Unscheduled. Changing duration or adding work immediately updates a preview for the remaining free time. It preserves blocks the person moved or pinned. The person can inspect the proposed changes before applying them and can undo an applied rebuild.

The agenda also distinguishes active and completed work. A task can occupy two sessions while remaining one card in the work list. A block can contain several tasks, with its length matching its allocations. If a task cannot fit in an existing block, Docket previews an extension or another session and never silently overlaps the next event. Schedule, Move, Add to block, Duration, Pin, and Unschedule cover the same outcomes for keyboard and touch. Details that cannot fit a short timed rectangle expand outside it.

**Review plan** puts a compact factual status above the full agenda: what is placed, what remains unplaced, and any conflict needing a decision. It does not repeat all task names or occupy a large hero card. If Athena is available, it may add a separate one- or two-sentence qualitative assessment grounded in the current proposal and its revision. The note is labeled Athena, is dismissible, and never blocks confirmation. There is no synthetic “Athena-like” fallback prose. The task cards and timed blocks stay editable here.

Athena's assessment should describe the likely shape of the day or a meaningful tradeoff. It should not recite metadata or declare one task “the priority.” Review keeps the same editable entities as Plan today, but gives the agenda visual precedence. A changed proposal invalidates a stale Athena note.

**Confirmation** celebrates the accepted plan briefly and offers Start or Continue for the next task, or Go to Today. If an event comes first, it shows the event. Confirmation does not start tracking. An adjusted plan ends with Plan updated and Undo.

## Proposal rules

The server builds the initial proposal without an LLM. It starts from the current time for a late start, or from the person's next work segment for a future day. It stops at the chosen finish time. It subtracts fixed calendar events, protected time, active or completed work, and pinned blocks. It uses the canonical expected work-location range to label where work can happen. It does not infer that a task requires a place when that requirement is absent from the task model. A later task-location field may turn those labels into hard placement constraints; until then, location is an availability/context signal, not a fabricated task attribute.

Selected daily tasks keep their edited Planned time. For a task without a daily duration, Docket can use a minute-based estimate when its unit is known, then recorded history or a visible default. A points estimate never becomes minutes. Dependency edges are hard order constraints. Due dates and task priority rank the remaining eligible work, while the person's explicit card order breaks ties and survives later proposals. Docket packs related short tasks into a block within one work-location segment and splits long tasks around real interruptions. It leaves work that cannot fit under Unscheduled with a reason. These suggestions remain editable; the person may confirm with unscheduled work.

The proposal records the source of each suggested duration. An edited daily duration always wins. The scheduler consumes only future work windows for a late start and leaves the person's configured buffer intact. It never moves past work, fixed events, or pinned blocks to make the arithmetic look feasible. If the selected work does not fit, it reports the specific tasks and reasons. It never moves the finish time without an explicit edit.

Work recorded earlier today stays in the actual ledger. When Docket uses a task's minute estimate to suggest future work, it subtracts relevant recorded work from that estimate and never schedules a completed task. An accepted plan's original planned duration remains unchanged after later actual work. A late draft therefore compares original intent, remaining proposal, and actual work without counting one task twice.

The existing `planDay` service supplies deterministic ordering and free-time placement, but its current one-organization, one-task-per-box result cannot directly represent this flow. The daily proposal service should reuse its tested dependency and availability rules while producing the multi-organization `DailyPlanSnapshot` session model. `POST /v1/daily-plan/day/:date/proposal` should return a proposed snapshot and reasons without writing it. The first unplanned entry can use that result as its editable draft; a rebuild compares its result with the current draft before applying. API authorization must use the same cross-organization visibility checks as the day read and draft write.

## Athena's role

Athena reads the same grounded proposal and visible task/project context. It can explain a likely interruption, note a conflict, or draft a missing task for an approaching milestone. Each proposed task has Add and Dismiss actions. Its review note is short and tied to the proposal revision so it disappears or refreshes after material edits. It cannot silently add tasks, change duration, move fixed events, or confirm a plan. If Athena is unavailable, the deterministic proposal and every manual control still work.

Review requests Athena's note asynchronously after it has a stable proposal. It shows no placeholder narrative while waiting. The response carries the proposal revision token, and the UI discards it if the person edits the plan before it arrives. Model latency cannot hold up confirmation.

## Delivery and proof

1. Correct the current screen's false affordances first: make the step controls real navigation, remove the overlapping sticky footer, align card leading edges, replace Planned time selects with direct editing, and make schedule targets visible. Update browser tests for navigation, numeric editing, dropping onto an existing block, and 320px overflow.
2. Add the deterministic proposal contract and tests. Verify late starts, active work, protected time, events, pinned blocks, dependencies, cross-organization visibility, task duration provenance, location segments, multi-task blocks, splits, and unplaced reasons.
3. Make Plan today open with a proposal, keep manual placements stable when the remaining schedule changes, and expose preview, apply, and Undo. Connect the decision area to duration, date, and finish-time controls.
4. Add optional Athena task proposals and a grounded review note. Keep its failure path invisible to manual planning. Replace the current deterministic narrative with a compact factual review.
5. Capture Today entry, yesterday review, initial proposal, add-work browser, drag and keyboard placement, review, confirmation, late start, and adjustment at 1440×900 and 390×844 in both themes. Run the six current browser scenarios plus proposal and location cases. Check 320px overflow, touch targets, focus, reduced motion, and the absence of agenda/footer overlap before marking the visual audit SHIP.

The remaining model gap is task-specific place requirements. The canonical work schedule can tell Docket where the person expects to work; the current task row does not say where a particular task must happen. The proposal must show this uncertainty rather than invent a place requirement.

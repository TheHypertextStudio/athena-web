---
name: update-work
description: Use when the user asks to change Docket work, record completion or blockers, post a work update, or correct a task description.
---

# Update work

Read [Working in Docket](../../references/work-management.md) before writing.

Read [Agent assignments](../../references/agent-work.md) when reporting agent work or deciding
whether a task, project, initiative, or program met its outcome. Read
[Subagents](../../references/subagents.md) when reconciling worker results; use one agreed writer
and verify combined acceptance before completing the parent assignment.

Resolve the intended records with discovery and semantic reads, preserving scope and metadata.
Task titles are not unique. Read each task's `stateOptions` and canonical `stateType`; choose the
owning team's completed or other requested state rather than assuming a global `done` key.

Use one `update` per compatible workspace/change group. Prefer explicit IDs when the user selected
particular work; filtered scope is suitable when they requested the whole matching set. Check all
matched, changed, already-matching, and skipped items. Read back affected content as needed, always
after description edits. Report partial failure with the actual affected links.

Task completion can also complete eligible ancestor tasks and close the caller's active task timer.
Account for those documented effects when updating subtasks or tracked work; inspect relevant parent
state and timer results rather than claiming only the selected rows changed.

Keep completion tracking in state and verified acceptance checkboxes. Preserve the requirement text;
do not append a completion story, CI output, run ID, or deployment receipt to Context. Use `comment`
for a concise task outcome or blocker, and `report_status` for a project, program, or initiative
update. Its health verdict also changes current health: set it only when requested or supported by
the authorized assessment. Store detailed technical evidence in the appropriate private records.

Do not mark work complete just because a commit exists or CI is green. Match evidence to the task's
acceptance conditions; retain any runtime, device, provider, or deployment gap. If the user explicitly
confirms verification, preserve that provenance without inventing independent verification.

Example: for twelve verified migration tasks, resolve the twelve IDs, batch the compatible state
change, and put a concise shared outcome on their project. Keep the task specifications useful for
future readers and report any skipped rows.

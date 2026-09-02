# /worklog

Read or update `docs/WORKLOG.md`, the source of truth for task status per AGENTS.md's Work Tracking System.

## Usage

```
/worklog              # show Active Tasks and their status
/worklog add <task>   # add a new task under Active Tasks
/worklog start <id>   # mark a task IN_PROGRESS
/worklog done <id>    # move a task to Completed Tasks
```

## Actions

### View

1. Read `docs/WORKLOG.md` → Active Tasks.
2. List each entry's ID, title, Status, and Priority — e.g. `[NOTION-UX-001] A broken Notion connection stops offering setup and starts offering repair — IN_PROGRESS, P0`.
3. Surface anything `BLOCKED` first; that's what needs a decision, not a status update.

### Add

1. ID format: a short feature-area prefix in caps plus a three-digit sequence — `NOTION-UX-001`, `CADENCE-001`, `LAUNCH-VIEWS-001`. Grep `docs/WORKLOG.md` for an existing prefix before inventing one; a task that continues prior work should reuse it.
2. Title the entry as a sentence describing the outcome, the way existing entries do — "A broken Notion connection stops offering setup and starts offering repair," not "Fix Notion connection bug."
3. Add it under Active Tasks with `Status: IN_PROGRESS`, `Started`, `Priority`, and a `Description` that states the actual problem, not a restatement of the title.

### Start

1. Create the entry first if it doesn't exist (see Add).
2. Set `Status: IN_PROGRESS` and `Started` to today's date.

### Done

1. Check off Subtasks and resolve, or explicitly carry forward, any Blockers note.
2. For anything beyond a trivial change, use the fuller structure recent large entries use instead of cramming everything into Notes: `#### Files changed`, `#### Validation` (the actual commands run and their result — `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage`, not just "tests pass"), and `#### Learnings`. See `[ID-DECOUPLE-001]` in `docs/WORKLOG.md` for what that looks like at full scale.
3. Move the entry to the Completed Tasks section.

## Notes

Update the work log before starting work and after finishing it, per AGENTS.md. A task with no entry didn't happen as far as the next agent, or the next `/retro`, is concerned.

# /worklog

View or update the project work log.

## Description

Display the current work log status or add entries. The work log tracks all active, completed, and backlog tasks.

## Usage

```
/worklog              # View current status
/worklog add <task>   # Add new task to backlog
/worklog start <id>   # Start working on a task
/worklog done <id>    # Mark task as completed
```

## Actions

### View Status

1. Read `docs/WORKLOG.md`
2. Display active tasks with their status
3. Show count of backlog and completed items

### Add Task

1. Generate a new task ID (format: AREA-NNN)
2. Add task to Backlog section
3. Include priority and description

### Start Task

1. Move task from Backlog to Active
2. Set status to IN_PROGRESS
3. Add started timestamp

### Complete Task

1. Move task from Active to Completed
2. Add completion timestamp
3. Prompt for summary and learnings

## File Location

`docs/WORKLOG.md`

## Notes

Always update the work log BEFORE starting work and AFTER completing work, as specified in AGENTS.md.

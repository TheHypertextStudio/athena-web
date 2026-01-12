---
name: status
description: Display current agent state and project status. Use to see active tasks, git status, uncommitted changes, and validation state at a glance.
---

# /status

Display current agent state and project status.

## Description

Shows the current state of work, including active tasks, recent changes, and validation status.

## Usage

```
/status
```

## Actions

1. Determine current agent state (from AGENTS.md state machine)
2. Read active tasks from WORKLOG.md
3. Check git status for uncommitted changes
4. Run quick validation checks
5. Display summary

## Output Format

```
=== Project Athena Status ===

Agent State: IMPLEMENTING

Active Tasks:
- [TASK-001] Implement authentication (IN_PROGRESS)
- [TASK-002] Add calendar sync (BLOCKED)

Git Status:
- Branch: feature/AUTH-001-google-signin
- Uncommitted changes: 3 files modified

Validation:
- Types: PASS
- Lint: PASS
- Tests: 42/42 passing (87% coverage)

Next Steps:
- Complete current implementation
- Run full validation
- Update documentation
```

## Notes

Use this to quickly understand the current state of work and what needs to be done next.

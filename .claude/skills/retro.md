# /retro

Close out the RETROSPECTING state from AGENTS.md's workflow for a task that just finished.

## Usage

```
/retro              # retrospective on the task most recently marked completed
/retro <task-id>    # retrospective on a specific task, e.g. `/retro NOTION-005`
```

## Actions

1. Review the task's git commits, changed files, and any blockers or surprises encountered along the way.
2. Capture only what's true: what's worth reusing on the next task, what cost more time than it should have and why (a wrong grep pattern, a test that hid a regression, an assumption that didn't hold), and what changes how the next agent should approach similar work. If none of that applies, write "nothing notable" and move on — a padded retro reads worse than a short honest one.
3. If a learning is broad enough to change how every agent works here, not just this task, propose the AGENTS.md update it implies — per AGENTS.md's Self-Modification Protocol: state the rationale, make an atomic change, bump the version. Don't leave a repo-wide learning stranded where nobody will reread it.

## Notes

Be specific about what went wrong, including your own dead ends. The value of a retrospective is in what the next agent can act on, not in how the work is framed.

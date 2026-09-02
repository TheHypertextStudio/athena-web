# /retro

Close out the RETROSPECTING state from AGENTS.md's workflow for a task that just finished.

## Usage

```
/retro              # retrospective on the task most recently marked completed
/retro <task-id>    # retrospective on a specific task, e.g. `/retro NOTION-005`
```

## Actions

1. Read the task's entry in `docs/WORKLOG.md` — its Description, Subtasks, and any Blockers or Notes recorded along the way.
2. Add or extend a `#### Learnings` subsection using the format recent large entries already use — see `[ID-DECOUPLE-001]` in `docs/WORKLOG.md` for what a substantive one looks like: specific, technical, and tied to what actually happened.
3. Capture only what's true: what's worth reusing on the next task, what cost more time than it should have and why (a wrong grep pattern, a test that hid a regression, an assumption that didn't hold), and what changes how the next agent should approach similar work. If none of that applies, write "nothing notable" and move on — a padded retro reads worse than a short honest one.
4. If a learning is broad enough to change how every agent works here, not just this task, propose the AGENTS.md update it implies — per AGENTS.md's Self-Modification Protocol: state the rationale, make an atomic change, bump the version. Don't leave a repo-wide learning stranded in a task entry nobody will reread.

## Notes

Be specific about what went wrong, including your own dead ends. The value of a retrospective is in what the next agent can act on, not in how the work is framed.

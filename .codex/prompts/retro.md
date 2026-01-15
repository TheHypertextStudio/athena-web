---
description: Conduct a retrospective on completed work. Use after finishing a task to document what went well, what could improve, and key learnings.
argument-hint: [TASK_ID=<task-id>]
---

# Retrospective

Conduct a retrospective on completed work.

## Description

Perform a retrospective analysis of recently completed work. This follows the RETROSPECTING state in the agent state machine.

## Usage

```
/prompts:retro                    # Retrospective on last completed task
/prompts:retro TASK_ID=ID-001     # Retrospective on specific task
```

If `$TASK_ID` is provided, retrospective on that specific task. Otherwise, use the most recently completed task.

## Actions

1. Read the completed task from WORKLOG.md
2. Analyze what was accomplished
3. Identify what went well
4. Identify what could improve
5. Document learnings
6. Suggest process improvements if warranted
7. Update WORKLOG.md with retrospective notes

## Retrospective Structure

```markdown
### Retrospective: [Task ID]

**What went well:**

- Point 1
- Point 2

**What could improve:**

- Point 1
- Point 2

**Learnings:**

- Learning 1
- Learning 2

**Process changes (if any):**

- Suggested change
```

## Notes

- Be honest about difficulties encountered
- Document solutions that worked for future reference
- Consider if AGENTS.md should be updated based on learnings

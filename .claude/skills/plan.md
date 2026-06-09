# /plan

Create an implementation plan for a task.

## Description

Enter planning mode to design an implementation approach for a task. This follows the PLANNING state in the agent state machine.

## Usage

```
/plan <task description>
```

## Actions

1. Analyze the task requirements
2. Research existing code patterns in the codebase
3. Identify files that will need modification
4. Break down into subtasks
5. Identify potential risks or blockers
6. Write plan to WORKLOG.md
7. Present plan for approval

## Plan Structure

```markdown
## Plan: [Task Title]

### Objective

What we're trying to accomplish

### Approach

How we'll accomplish it

### Steps

1. Step 1 description
2. Step 2 description
3. ...

### Files to Modify

- `path/to/file.ts` - What changes

### Risks

- Potential issue 1
- Potential issue 2

### Validation

How we'll verify success
```

## Exit Criteria

Plan is documented in WORKLOG.md and approved before implementation begins.

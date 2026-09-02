# /plan

Enter the PLANNING state from AGENTS.md's workflow (`IDLE → PLANNING → RESEARCHING → …`) and produce a plan worth acting on, not a formality before implementation.

## Usage

```
/plan <task description>
```

## Actions

1. Read the task against the existing codebase, not just the request. Anything touching Hono routes, Next.js data fetching, or Drizzle schema has real constraints already written down in AGENTS.md's Platform Best Practices — check those before proposing an approach that conflicts with them.
2. Search for prior art. `docs/WORKLOG.md` is full of solved problems in the same shape — a task on Notion sync should start by reading `[NOTION-005]` or `[NOTION-004]`, not by re-deriving the approach from scratch.
3. Identify every file the change touches, not a representative sample — a plan that names three files when the change needs six will get revised mid-implementation instead of before it.
4. Call out risks concretely. "Might trip the source-policy test that blocks rendering raw Problem `detail` text" is a risk; "could be tricky" is not.
5. Write the task into `docs/WORKLOG.md` under Active Tasks using the real field set: `Status`, `Started`, `Priority`, `Description`, `Subtasks`, `Blockers`, `Notes`. Give it an ID in the repo's actual convention — a short feature-area prefix plus a three-digit number (`CADENCE-001`, `LAUNCH-VIEWS-001`), not a generic `TASK-001`. Reuse an existing prefix if the task continues work already in the log.
6. Present the plan and wait for explicit approval before touching code, per AGENTS.md's Plan Approval. This step catches a wrong assumption before it costs an implementation pass, not after.

## Plan Structure

Match the block AGENTS.md defines under Planning Protocol:

```markdown
## Plan: [Task Title]

### Objective

### Approach

### Steps

### Files to Modify

### Risks

### Validation
```

## Exit Criteria

The plan lives in a `docs/WORKLOG.md` task entry and is approved. A plan that only exists in chat context disappears the moment the session does — write it down before implementation starts.

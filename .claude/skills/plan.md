# /plan

Enter the PLANNING state from AGENTS.md's workflow (`IDLE → PLANNING → RESEARCHING → …`) and produce a plan worth acting on, not a formality before implementation.

## Usage

```
/plan <task description>
```

## Actions

1. Read the task against the existing codebase, not just the request. Anything touching Hono routes, Next.js data fetching, or Drizzle schema has real constraints already written down in AGENTS.md's Platform Best Practices — check those before proposing an approach that conflicts with them.
2. Search for prior art in git history and `docs/engineering/` specs rather than re-deriving an existing approach from scratch.
3. Identify every file the change touches, not a representative sample — a plan that names three files when the change needs six will get revised mid-implementation instead of before it.
4. Call out risks concretely. "Might trip the source-policy test that blocks rendering raw Problem `detail` text" is a risk; "could be tricky" is not.
5. Present the plan and proceed, asking for approval only when the next action is irreversible or genuinely needs a product decision, per AGENTS.md's Plan Approval.

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

The plan is documented (for significant architectural changes, under `docs/plans/` or `docs/superpowers/plans/`) before implementation starts.

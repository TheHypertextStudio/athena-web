# /status

Answer "where are we" against AGENTS.md's workflow states and current repository state, without re-reading AGENTS.md from scratch.

## Usage

```
/status
```

## Actions

1. Determine the current workflow state from AGENTS.md's state machine (`IDLE → PLANNING → RESEARCHING → … → RETROSPECTING → IDLE`) based on what's actually happened this session, not what's convenient to claim.
2. Run `git status` and `git log -n 5 --oneline` for the current branch, recent commits, and uncommitted changes.
3. Run `pnpm typecheck` and `pnpm lint`. Skip `pnpm test:coverage` unless asked for it explicitly — CI runs it as `turbo run test:coverage`, partitioned into groups (see `.github/workflows/ci.yml`), and it can take minutes; a status check isn't the place to pay that cost by default.
4. Report the summary.

## Output shape

The block below is illustrative — a shape to fill in, not a captured run. Substitute whatever is actually in git state and whatever the commands actually report.

```
Agent State: IMPLEMENTING

Git:
- Branch: claude/notion-connection-repair
- Uncommitted: 3 files modified

Validation:
- typecheck: pass
- lint: pass
- test:coverage: not run (pass --full to include it)

Next: finish the remaining subtasks and validate before committing.
```

## Notes

If there are no uncommitted changes, say so plainly — a clean tree is a valid, useful answer, not a failure to report something.

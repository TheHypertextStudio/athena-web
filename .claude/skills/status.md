# /status

Answer "where are we" against AGENTS.md's workflow states and `docs/WORKLOG.md`, without re-reading either from scratch.

## Usage

```
/status
```

## Actions

1. Determine the current workflow state from AGENTS.md's state machine (`IDLE → PLANNING → RESEARCHING → … → RETROSPECTING → IDLE`) based on what's actually happened this session, not what's convenient to claim.
2. Read `docs/WORKLOG.md` → Active Tasks for anything `IN_PROGRESS` or `BLOCKED`.
3. Run `git status` for the current branch and uncommitted changes.
4. Run `pnpm typecheck` and `pnpm lint`. Skip `pnpm test:coverage` unless asked for it explicitly — CI runs it as `turbo run test:coverage`, partitioned into groups (see `.github/workflows/ci.yml`), and it can take minutes; a status check isn't the place to pay that cost by default.
5. Report the summary.

## Output shape

The block below is illustrative — a shape to fill in, not a captured run. Substitute whatever is actually in Active Tasks and whatever the commands actually report.

```
Agent State: IMPLEMENTING

Active Tasks:
- [NOTION-UX-001] Notion connection repair flow (IN_PROGRESS)
- [DOCKET-PRO-001] Product-based billing (BLOCKED — see Blockers note)

Git:
- Branch: claude/notion-connection-repair
- Uncommitted: 3 files modified

Validation:
- typecheck: pass
- lint: pass
- test:coverage: not run (pass --full to include it)

Next: finish the remaining NOTION-UX-001 subtasks, then request a /plan review before touching DOCKET-PRO-001's blocker.
```

## Notes

If Active Tasks is empty and there are no uncommitted changes, say so plainly — an empty status is a valid, useful answer, not a failure to report something.

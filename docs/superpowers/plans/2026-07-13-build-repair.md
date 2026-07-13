# Build Repair Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with test-first checkpoints.

**Goal:** Restore a clean TypeScript build after the active-provider catalog and account-export audit changes diverged.

**Architecture:** Keep active provider catalogs narrow while retaining explicit legacy provider types at dormant event/runtime boundaries. Make account-export scope a persisted, typed value used consistently by request routes and the asynchronous sweep.

**Tech Stack:** TypeScript, Vitest, Hono, Drizzle, pnpm/Turbo.

## Global Constraints

- Preserve dormant Slack/Outlook/Discord data compatibility without re-enabling them in active catalogs.
- Do not use `any`, unsafe casts, stubs, or skipped tests.
- Validate focused tests and a clean `pnpm build` before completion.

### Task 1: Repair account-export scope contract

**Files:** `apps/api/src/account/export.ts`, `apps/api/src/routes/me-account.ts`, related export tests.

- Add a typed `exportScope` parser/helper and `FULL_ACCOUNT_EXPORT_SCOPE` where route consumers can import them.
- Build the collected document from the persisted export job's scope, not an undefined request-local variable.
- Add a regression test covering a queued export with a scoped job and verify the sweep can build its audit metadata.

### Task 2: Restore legacy provider compile boundaries

**Files:** `packages/integrations/src/index.ts`, provider type definitions, `apps/api/src/container.ts`, Slack relevance/runtime files, event-sync/reconcile consumers.

- Re-export `slackMentionedUserIds`.
- Use explicit active-vs-legacy provider unions at dormant compatibility boundaries.
- Add explicit observer fallback behavior and preserve required Slack runtime configuration typing.
- Add focused provider contract coverage where existing test seams support it.

### Task 3: Validate and publish

- Run focused export/provider tests.
- Run a clean `pnpm build` in the isolated worktree.
- Review the diff, commit the coherent fix, and push only the fix commit.

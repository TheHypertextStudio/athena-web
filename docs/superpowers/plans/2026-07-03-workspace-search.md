# Workspace Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workspace-wide semantic search foundation described in `docs/superpowers/specs/2026-07-03-workspace-search-design.md`.

**Architecture:** Postgres owns the durable read model through `search_document` and `search_index_job`. API projectors convert source rows into semantic search documents, a job processor keeps the index fresh and repairable, and both the command palette and `/search` page consume one shared DTO.

**Tech Stack:** Drizzle ORM, PGlite-compatible migrations, Hono, Zod DTOs in `@docket/types`, TanStack Query helpers, Next.js App Router, Vitest.

---

## File Map

- Create `packages/db/src/schema/search.ts`: Drizzle tables for `search_document` and `search_index_job`.
- Modify `packages/db/src/enums.ts`: search enums for document family/kind and job operation/reason/status.
- Modify `packages/db/src/schema/index.ts` and `packages/db/src/index.ts`: export the search schema island.
- Create `packages/db/tests/search.test.ts`: schema and migration smoke tests.
- Create `packages/types/src/search.ts`: public search query/result DTOs.
- Modify `packages/types/src/hub.ts` and `packages/types/src/index.ts`: make Hub search use the shared search DTO and export it.
- Create `packages/types/tests/search.test.ts`: DTO acceptance/rejection tests.
- Create `apps/api/src/search/{types,rank,routes,registry,enqueue,process-jobs,backfill,query}.ts`: API search service.
- Create `apps/api/src/search/projectors/{work,people,content,activity,calendar}.ts`: source-to-document projectors.
- Modify `apps/api/src/routes/hub.ts`: replace direct task/project/program `ILIKE` with the search query service.
- Create `apps/api/src/routes/search.ts`: org-scoped search route mounted at `/v1/orgs/:orgId/search`.
- Modify `apps/api/src/routes/orgs.ts`: mount the org search router after `orgContextMiddleware`.
- Add targeted enqueue calls in source write routes after source rows are created/updated/deleted.
- Create `apps/api/tests/search/{projectors,query,jobs}.test.ts` and `apps/api/tests/routes/search.test.ts`.
- Create `scripts/search-backfill.ts` and add root/package scripts for local repair.
- Modify `apps/web/src/lib/query-keys.ts`: structured search query keys.
- Modify `apps/web/src/components/command-palette/{types,palette-row,use-hub-search}.tsx`: consume semantic `SearchResult` rows and typed routes.
- Create `apps/web/src/lib/search-route.ts`: route interpreter shared by palette and search page.
- Create `apps/web/src/app/(app)/search/{page,search-client}.tsx`: authenticated full search page with filters and cursor paging.
- Create or extend focused web tests for route mapping and command-palette search mapping.
- Modify `docs/WORKLOG.md`: track task state and final retrospection.

## Task 1: DB Schema And Migration

**Files:**

- Modify: `packages/db/src/enums.ts`
- Create: `packages/db/src/schema/search.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/search.test.ts`

- [x] **Step 1: Write the failing DB test**

Create `packages/db/tests/search.test.ts` with tests that import the search tables, insert a semantic document and a pending index job, verify enum values, and confirm the unique `(source_table, entity_id)` document constraint prevents duplicate source projections.

- [x] **Step 2: Run the failing DB test**

Run: `pnpm --filter @docket/db exec vitest run tests/search.test.ts`

Expected: FAIL because `searchDocument`, `searchIndexJob`, and search enums are not exported yet.

- [x] **Step 3: Add search enums and schema**

Add enums:

```ts
export const searchDocumentFamily = pgEnum('search_document_family', [
  'work',
  'people',
  'content',
  'activity',
]);
export const searchDocumentKind = pgEnum('search_document_kind', [
  'organization',
  'team',
  'member',
  'agent',
  'agent_session',
  'task',
  'project',
  'program',
  'initiative',
  'milestone',
  'cycle',
  'label',
  'saved_view',
  'comment',
  'update',
  'attachment',
  'calendar_event',
  'activity',
]);
export const searchIndexJobOperation = pgEnum('search_index_job_operation', ['upsert', 'delete']);
export const searchIndexJobReason = pgEnum('search_index_job_reason', [
  'entity_write',
  'event_log',
  'backfill',
  'repair',
  'manual',
]);
export const searchIndexJobStatus = pgEnum('search_index_job_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
]);
```

Implement `search_document` with semantic route/facet/visibility JSON, user/org scopes, full text input fields, and indexes from the design. Implement `search_index_job` as the durable outbox.

- [x] **Step 4: Generate and inspect the migration**

Run: `pnpm --filter @docket/db db:generate`

Expected: a new SQL migration in `packages/db/drizzle` that creates four enums, both tables, indexes, and the unique partial job dedupe index.

- [x] **Step 5: Run the DB test green**

Run: `pnpm --filter @docket/db exec vitest run tests/search.test.ts`

Expected: PASS.

- [x] **Step 6: Run package DB validation**

Run: `pnpm --filter @docket/db typecheck && pnpm --filter @docket/db test`

Expected: PASS.

## Task 2: Public Search DTOs

**Files:**

- Create: `packages/types/src/search.ts`
- Modify: `packages/types/src/hub.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/tests/search.test.ts`

- [x] **Step 1: Write failing DTO tests**

Create tests that prove `SearchOut` accepts semantic task, comment, activity, and calendar results; rejects unknown kinds/families; accepts opaque cursors; and keeps `HubSearchOut` aligned with the same output shape.

- [x] **Step 2: Run the failing DTO tests**

Run: `pnpm --filter @docket/types exec vitest run tests/search.test.ts`

Expected: FAIL because `SearchOut` and semantic result DTOs do not exist.

- [x] **Step 3: Implement DTOs**

Define `SearchDocumentFamily`, `SearchDocumentKind`, `SearchRoute`, `SearchSubject`, `SearchSource`, `SearchFacetSummary`, `SearchAction`, `SearchResult`, `SearchQuery`, and `SearchOut`. Make `HubSearchOut` re-export or alias the shared `SearchOut` so the old `results` payload is replaced with `items`.

- [x] **Step 4: Run DTO tests green**

Run: `pnpm --filter @docket/types exec vitest run tests/search.test.ts`

Expected: PASS.

- [x] **Step 5: Run package types validation**

Run: `pnpm --filter @docket/types typecheck && pnpm --filter @docket/types test`

Expected: PASS.

## Task 3: Projection Registry And Ranking

**Files:**

- Create: `apps/api/src/search/types.ts`
- Create: `apps/api/src/search/rank.ts`
- Create: `apps/api/src/search/routes.ts`
- Create: `apps/api/src/search/registry.ts`
- Create: `apps/api/src/search/projectors/work.ts`
- Create: `apps/api/src/search/projectors/people.ts`
- Create: `apps/api/src/search/projectors/content.ts`
- Create: `apps/api/src/search/projectors/activity.ts`
- Create: `apps/api/src/search/projectors/calendar.ts`
- Test: `apps/api/tests/search/projectors.test.ts`

- [x] **Step 1: Write failing projector tests**

Seed rows for every V1 kind and assert each projector returns the exact `kind`, `family`, title, searchable body, subject pointer, route, facets, visibility mode, source attribution, and base rank.

- [x] **Step 2: Run the failing projector tests**

Run: `pnpm --filter @docket/api exec vitest run tests/search/projectors.test.ts`

Expected: FAIL because the search service modules do not exist.

- [x] **Step 3: Implement projector contracts**

Create a `SearchDocumentDraft` internal type that mirrors the DB insert shape but uses typed route/facet/visibility objects. Create a `SearchProjector` interface and registry lookup by `sourceTable`.

- [x] **Step 4: Implement V1 projectors**

Cover all design kinds: organization, team, member, agent, agent session, task, project, program, initiative, milestone, cycle, label, saved view, comment, update, attachment, calendar event, and activity.

- [x] **Step 5: Run projector tests green**

Run: `pnpm --filter @docket/api exec vitest run tests/search/projectors.test.ts`

Expected: PASS.

## Task 4: Durable Enqueue, Processor, And Backfill

**Files:**

- Create: `apps/api/src/search/enqueue.ts`
- Create: `apps/api/src/search/process-jobs.ts`
- Create: `apps/api/src/search/backfill.ts`
- Create: `scripts/search-backfill.ts`
- Modify: `package.json`
- Test: `apps/api/tests/search/jobs.test.ts`

- [x] **Step 1: Write failing job tests**

Prove enqueue dedupes pending work, the processor idempotently upserts documents, delete jobs archive documents, failed projectors retry with `attempts` and `lastError`, and backfill enqueues source rows without duplicating existing pending jobs.

- [x] **Step 2: Run failing job tests**

Run: `pnpm --filter @docket/api exec vitest run tests/search/jobs.test.ts`

Expected: FAIL because enqueue and processor modules are absent.

- [x] **Step 3: Implement enqueue helpers**

Expose `enqueueSearchIndexJob` and `enqueueSearchIndexJobs` that generate stable dedupe keys from `(sourceTable, entityId, operation, reason)` and insert with conflict-ignore for active pending/processing rows.

- [x] **Step 4: Implement processor**

Lease pending jobs by `run_after`, set `processing`, call the registry, upsert or archive documents, store `processed_at`, and on failure increment attempts with exponential retry delay.

- [x] **Step 5: Implement backfill**

Scan supported source tables in pages, enqueue `backfill` jobs, and expose a local `pnpm search:backfill` script.

- [x] **Step 6: Run job tests green**

Run: `pnpm --filter @docket/api exec vitest run tests/search/jobs.test.ts`

Expected: PASS.

## Task 5: Permission-Filtered Query Service

**Files:**

- Create: `apps/api/src/search/query.ts`
- Test: `apps/api/tests/search/query.test.ts`

- [x] **Step 1: Write failing query tests**

Seed indexed documents across two orgs, a user-private calendar document, inherited content documents, and activity documents. Assert membership boundaries, org narrowing, user-private matching, archive exclusion, family/kind/source/date filters, cursor stability, snippets, and score ordering.

- [x] **Step 2: Run failing query tests**

Run: `pnpm --filter @docket/api exec vitest run tests/search/query.test.ts`

Expected: FAIL because `searchWorkspace` does not exist.

- [x] **Step 3: Implement search query parsing and filtering**

Normalize `q`, `limit`, cursor, families, kinds, sources, org ids, date range, and `includeArchived`. Resolve caller org ids once, then filter documents by org membership or `user_private` user id.

- [x] **Step 4: Implement ranking and cursoring**

Use deterministic rank components: title exact/prefix/contains boost, base rank, recency, active org boost, and stable `(score, updatedAt, id)` keyset cursor. Generate `matchedFields` and snippets from title, summary, then body.

- [x] **Step 5: Run query tests green**

Run: `pnpm --filter @docket/api exec vitest run tests/search/query.test.ts`

Expected: PASS.

## Task 6: API Routes And Event/Data-Log Integration

**Files:**

- Modify: `apps/api/src/routes/hub.ts`
- Create: `apps/api/src/routes/search.ts`
- Modify: `apps/api/src/routes/orgs.ts`
- Modify write routes for tasks, projects, programs, initiatives, cycles, milestones, labels, saved views, comments, updates, attachments, agents, agent sessions, events, and calendar events.
- Test: `apps/api/tests/routes/search.test.ts`

- [x] **Step 1: Write failing route tests**

Prove `/v1/hub/search` returns semantic results across caller orgs, `/v1/orgs/:orgId/search` cannot cross tenants, org filters are intersected with caller memberships, and event rows appear as `activity` while also enqueueing their mapped entity for reindex.

- [x] **Step 2: Run failing route tests**

Run: `pnpm --filter @docket/api exec vitest run tests/routes/search.test.ts`

Expected: FAIL because the upgraded routes are not wired.

- [x] **Step 3: Upgrade Hub search**

Replace source-table `ILIKE` queries with `searchWorkspace({ scope: 'hub', userId, params })` and return `SearchOut`.

- [x] **Step 4: Add org search**

Mount `searchRouter` at `/:orgId/search` after `orgContextMiddleware`; call `searchWorkspace({ scope: 'org', userId, orgId, params })`.

- [x] **Step 5: Enqueue from data writes**

Add `entity_write` jobs next to source row writes and `event_log` jobs when canonical events are emitted. Route writes enqueue jobs, not document drafts.

- [x] **Step 6: Run route tests green**

Run: `pnpm --filter @docket/api exec vitest run tests/routes/search.test.ts`

Expected: PASS.

## Task 7: Command Palette Integration

**Files:**

- Modify: `apps/web/src/components/command-palette/types.ts`
- Modify: `apps/web/src/components/command-palette/palette-row.tsx`
- Modify: `apps/web/src/components/command-palette/use-hub-search.ts`
- Create: `apps/web/src/lib/search-route.ts`
- Modify: `apps/web/src/lib/query-keys.ts`
- Test: focused web tests for search route and palette mapping.

- [x] **Step 1: Write failing web mapping tests**

Assert task, comment, activity, and calendar result rows map to palette items with correct icon, kind label, org/source context, and navigation href from the typed route object.

- [x] **Step 2: Run failing web tests**

Run the focused web test command used by the existing web test setup for the new test files.

Expected: FAIL because palette still expects `HubSearchHitType` and local three-kind routing.

- [x] **Step 3: Implement typed route interpreter**

Map `SearchRoute` kinds to existing app URLs. Object routes open entity pages; content routes include highlight params when available; activity routes open stream context or external URLs.

- [x] **Step 4: Update palette mapping**

Fetch `/v1/hub/search`, read `items`, support all semantic kinds, keep hub/org scope, and use the typed route interpreter instead of a local entity switch.

- [x] **Step 5: Run web mapping tests green**

Run the focused web test command again.

Expected: PASS.

## Task 8: Full Search Page

**Files:**

- Create: `apps/web/src/app/(app)/search/page.tsx`
- Create: `apps/web/src/app/(app)/search/search-client.tsx`
- Modify: `apps/web/src/lib/query-keys.ts`
- Test: focused web tests for query params and client filtering behavior.

- [x] **Step 1: Write failing search page tests**

Assert the page reads `q`, `families`, `kinds`, `sources`, `orgIds`, and date range from URL params; fetches through the shared query layer; renders semantic result rows; and preserves filters in shareable URLs.

- [x] **Step 2: Run failing search page tests**

Run the focused web test command for the new page tests.

Expected: FAIL because `/search` does not exist.

- [x] **Step 3: Implement `/search`**

Build a dense authenticated search workspace: input, segmented family filters, kind/source menus, workspace filter, date range inputs, cursor paging, result rows with semantic labels, snippets, org chips, and source badges.

- [x] **Step 4: Run search page tests green**

Run the focused web test command again.

Expected: PASS.

## Task 9: Documentation, Validation, And Commit Sequence

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify docs only if implementation changes public setup or command names beyond this plan.

- [x] **Step 1: Update worklog completion**

Move `SEARCH-002` from Active to Completed with summary, files changed, validation, and retrospection.

- [x] **Step 2: Run targeted validation**

Run:

```bash
pnpm --filter @docket/types typecheck
pnpm --filter @docket/types test
pnpm --filter @docket/db typecheck
pnpm --filter @docket/db test
pnpm --filter @docket/api typecheck
pnpm --filter @docket/api exec vitest run tests/search tests/routes/search.test.ts
pnpm --filter @docket/web typecheck
pnpm --filter @docket/web test
```

Expected: PASS or clearly documented unrelated/environment-specific failures.

- [x] **Step 3: Run final broad validation as runtime allows**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: PASS or documented pre-existing blocker with focused gates passing.

- [x] **Step 4: Commit atomically**

Commit in logical slices using editor/stdin/message-file commits, not `git commit -m`:

1. `feat(db): add workspace search index schema`
2. `feat(types): define semantic search DTOs`
3. `feat(api): index and query semantic workspace search`
4. `feat(web): add workspace search surfaces`
5. `docs(search): record workspace search implementation`

Expected: `git rev-list --merges --count origin/main..HEAD` remains `0`.

## Plan Self-Review

- Spec coverage: DB read model, durable jobs, projection registry, event-log integration, permission query service, Hub/org API, command palette, search page, backfill, ranking, and validation are each mapped to tasks.
- Placeholder scan: no task delegates undefined behavior; all expected commands and file responsibilities are explicit.
- Type consistency: public API uses `SearchOut.items`; old `HubSearchOut.results` is intentionally replaced by the semantic DTO.

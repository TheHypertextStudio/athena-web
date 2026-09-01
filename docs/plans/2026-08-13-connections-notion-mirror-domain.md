# Connections Notion Mirror Domain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Docket-designed Notion mirror from generic Types and Integrations ownership into a
real Connections vertical without changing its API, database, sync, or provider behavior.

**Architecture:** `@docket/connections` owns the executable mirror contract, design rules, value
projection, provider port, SDK adapter, behavioral in-memory adapter, and provider-error
classification. API, DB, and web remain delivery/persistence/UI callers. Work supplies the
organization vocabulary; Connections must not depend on the retired contract package, app routes, Drizzle, or
UI source.

**Tech Stack:** TypeScript, Zod, Vitest, Notion SDK, Drizzle schema adapters, Hono/OpenAPI,
pnpm workspace packages.

---

### Task 1: Pin the current mirror invariants before moving runtime code

**Files:**

- Test: `packages/integrations/tests/notion/notion-mirror.test.ts`
- Test: `packages/integrations/tests/notion/notion-mirror-schema.test.ts`
- Test: `packages/integrations/tests/notion/notion-mirror-values.test.ts`
- Test: `packages/integrations/tests/notion/mock-notion-mirror.test.ts`
- Test: `apps/api/tests/routes/notion-mirror-{design,plan,reconcile,routes}.test.ts`

**Step 1: Add one failing characterization per unpinned boundary.**

Cover property-ID addressing after a title rename, two-way edits only for Task/Project, soft-delete
handling, an unresolved relation becoming resolved, write-budget pacing, and auth failure becoming
a truthful reauthorization state.

**Step 2: Run the targeted tests and confirm each failure identifies the missing invariant.**

Run: `../../node_modules/.bin/vitest run --config vite.config.ts tests/notion/notion-mirror*.test.ts tests/notion/mock-notion-mirror.test.ts`

Expected: each new assertion is red before any source move.

**Step 3: Add the smallest characterization fixture or assertion.**

Do not change application behavior in this task; the test is the migration boundary.

**Step 4: Re-run the same tests.**

Expected: green with behavior unchanged.

**Step 5: Commit.**

Commit the tests with the first Connections implementation slice when staging is available.

### Task 2: Move provider failure classification and Notion protocol vocabulary

**Files:**

- Create: `domains/connections/src/provider-error.ts`
- Create: `domains/connections/src/notion/protocol.ts`
- Modify: `packages/integrations/src/connector.ts`
- Modify: `packages/integrations/src/notion.ts`
- Modify: `apps/api/src/routes/notion-mirror-reconcile.ts`
- Test: `domains/connections/tests/provider-error.test.ts`
- Test: `packages/integrations/tests/notion/notion-mirror.test.ts`

**Step 1: Write failing domain tests.**

Assert that `isProviderAuthError` recognizes the moved error shape and that
`NOTION_API_VERSION` is a single Connections-owned constant.

**Step 2: Run the direct domain test.**

Run: `../../node_modules/.bin/vitest run --config vite.config.ts tests/provider-error.test.ts`

Expected: red because Connections has no provider-error/protocol implementation.

**Step 3: Implement the public error/protocol modules and legacy aliases.**

Keep generic linked-connector callers working through a temporary named legacy export. Make the
leased sync spine branch on the new type guard so an authentication error still records
reauthorization rather than a generic failed run.

**Step 4: Run domain and reconcile tests.**

Expected: auth classification and API state remain byte-for-byte compatible.

**Step 5: Commit.**

Commit the public error/protocol cutover with its compatibility alias and tests.

### Task 3: Split mirror design rules and value projection into Connections

**Files:**

- Create: `domains/connections/src/notion/mirror-schema.ts`
- Create: `domains/connections/src/notion/mirror-values.ts`
- Delete after cutover: `packages/integrations/src/notion-mirror-schema.ts`
- Delete after cutover: `packages/integrations/src/notion-mirror-values.ts`
- Move tests: `packages/integrations/tests/notion/notion-mirror-{schema,values}.test.ts`

**Step 1: Make moved unit suites import public Connections paths.**

Start with a direct import that fails because the public export does not exist.

**Step 2: Run the schema/value suites.**

Expected: red only on module resolution, not on a changed expectation.

**Step 3: Extract small named modules.**

Keep files below the readability ceiling by separating catalog/default design, projection ordering,
value typing/resolution, and value codec when the existing modules exceed 500 lines. Preserve the
existing content-hash input, including the readable `\0` delimiter.

**Step 4: Re-run all mirror design/value tests.**

Expected: property order, limits, omissions, unresolved references, and hashes are unchanged.

**Step 5: Commit.**

Commit the extracted rules and moved tests as one vertical slice.

### Task 4: Move the mirror port and adapters without pulling in the generic connector kernel

**Files:**

- Create: `domains/connections/src/notion/mirror-port.ts`
- Create: `domains/connections/src/notion/adapters/notion-sdk.ts`
- Create: `domains/connections/src/notion/adapters/in-memory.ts`
- Delete after cutover: `packages/integrations/src/notion-mirror.ts`
- Delete after cutover: `packages/integrations/src/mock-notion-mirror.ts`
- Move tests: `packages/integrations/tests/notion/{notion-mirror,mock-notion-mirror}.test.ts`

**Step 1: Write a direct adapter contract test.**

Exercise provision, property-ID write, pull, rate-limit handling, and the behavioral mock without a
real Notion account.

**Step 2: Run it red against the absent public adapter.**

Run: `../../node_modules/.bin/vitest run --config vite.config.ts tests/notion-mirror.test.ts tests/mock-notion-mirror.test.ts`

Expected: module-resolution failure before extraction.

**Step 3: Extract the port and adapters.**

Do not move `notion.ts`, `notion-mapping.ts`, `observer-notion.ts`, `connector.ts`, or
`provider-client.ts`; they remain the future cross-provider kernel slice.

**Step 4: Re-run the adapter tests and package typecheck.**

Expected: all adapter behavior remains offline-testable and Connections imports no generic Types
or delivery code.

**Step 5: Commit.**

Commit port/adapters and tests together.

### Task 5: Cut delivery callers over to explicit Connections entry points

**Files:**

- Modify: `apps/api/src/{container.ts,routes/notion-mirror*.ts}`
- Modify: `packages/db/src/schema/notion-mirror.ts`
- Modify: `apps/web/src/components/settings/notion/**`
- Modify: `apps/web/src/app/(app)/settings/connections/notion/**`
- Modify: relevant API, DB, and web Notion mirror tests

**Step 1: Change one direct consumer import to the published Connections path.**

Expected first failure: missing manifest dependency or public export, never a deep source import.

**Step 2: Declare only direct workspace dependencies.**

Add `@docket/connections: workspace:*` to API, web, DB, Types compatibility, and Integrations only
while each imports a public Connections path. Update matching lock importers and validate them with
the workspace-lock policy.

**Step 3: Keep delivery responsibilities at the edge.**

Routes retain tenancy, credentials, database rows, sync lease, cron scheduling, and OpenAPI. The
domain owns only mirror behavior and provider adaptation.

**Step 4: Run API/web/DB focused suites and typechecks.**

Expected: unchanged OpenAPI responses, schema order, and Settings behavior.

**Step 5: Commit.**

Commit direct caller cutover with manifest/lock changes and behavior tests.

### Task 6: Publish the complete domain surface and enforce the retirement boundary

**Files:**

- Modify: `domains/connections/package.json`
- Modify: `domains/registry.json`
- Modify: `packages/test-utils/tests/workspace-policies/{domain-import-policy,migrated-contract-import-policy}.test.ts`
- Modify: `docs/WORKLOG.md`
- Modify: `docs/engineering/specs/domain-first-reorganization.md`

**Step 1: Add a failing policy fixture for a legacy production import.**

Assert that a source import of the migrated Notion mirror contract from the retired contract package or a
private Connections path is rejected with the public replacement.

**Step 2: Publish only named Connections subpaths.**

Add `./provider-error`, `./notion/{mirror-contract,mirror-port,mirror-schema,mirror-values,protocol}`
and the two adapter paths. Keep the root export forbidden.

**Step 3: Delete legacy implementation modules only after callers pass.**

Leave an explicit Types facade only until every real consumer migrates; do not retain an
`@docket/integrations` compatibility barrel for private domain implementation.

**Step 4: Run the acceptance matrix.**

Run Connections, Integrations, DB, API Notion-route, web Notion-settings, Types compatibility,
workspace-policy, typecheck, lint, Prettier, OpenAPI generation/diff, and `git diff --check`.

Expected: no `packages/integrations/src/notion-mirror*` implementation, no new Types contract,
no domain-to-app imports, and unchanged API/database behavior.

**Step 5: Commit.**

Commit documentation, registry, imports, and policy after the implementation is green.

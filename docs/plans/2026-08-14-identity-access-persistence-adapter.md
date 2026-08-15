# Identity & Access Persistence Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or
> `executing-plans` to implement this plan task by task.

**Goal:** Put the DB-backed facts needed for explicit grant authorization behind one deliberate
`@docket/db/identity-access` public subpath, while preserving `@docket/authz` as the existing
caller-facing compatibility surface.

**Architecture:** `@docket/identity-access` remains pure: it evaluates normalized actor/role,
resource-chain, and grant facts without database access. The new DB adapter owns authoritative
actor/role loading, task/project containment traversal, candidate-grant loading, and fact
normalization. `@docket/authz` keeps only the small policy bridge that maps adapter denials to its
existing result shape and calls the pure evaluator.

**Tech Stack:** TypeScript, Drizzle ORM, PGlite, Zod-owned Identity & Access contracts, Vitest,
ESLint, Prettier, pnpm workspace package exports.

---

## Non-negotiable boundaries

- Add only `@docket/db/identity-access`; do not add a DB root-barrel export or another generic
  package.
- The adapter may depend on DB schema/client internals and the public Identity & Access contracts,
  but never on Authz, API, Web, Types, or delivery-runtime code.
- Preserve the current `canActor` model exactly: generic active actors are valid; same-org role
  joins are authoritative; grants are allow-only; expiry, subject-kind, resource-kind, and cascade
  decisions remain in the pure evaluator.
- Do not move API delivery policy: `resource-access.ts`, `task-helpers.ts`, public-resource
  baseline logic, guest policy, batching, archive filtering, and `visibilityOverride` remain
  outside this slice.
- Do not silently broaden topology: current `canActor` traverses organization, task, and project
  containment only. Cycle and initiative behavior is not part of this extraction.
- Do not stage or commit shared-worktree changes during this plan. The repository-level migration
  remains active after this narrow slice.

## Task 1: Characterize the public persistence facts

**Files:**

- Create: `packages/db/tests/identity-access.test.ts`
- Read: `packages/authz/src/can-actor.ts`
- Read: `packages/authz/src/ancestor-chain.ts`
- Read: `packages/authz/tests/access-control/authz.test.ts`

- [ ] **Step 1: Write the public-subpath contract test**

  Import the not-yet-existing `@docket/db/identity-access` subpath from a DB-package test. Create
  a migrated in-memory PGlite database using the established `packages/db/tests/schema/*.test.ts`
  pattern, then seed two organizations, roles, actors, a team, a program, a project, a task, and
  representative actor/role grants.

- [ ] **Step 2: Characterize all adapter outcomes before implementation**

  Assert exact stable results for missing, cross-org, suspended, and archived actors. For a ready
  result, assert the principal contains only the authoritative same-org role, the chain is target
  first and ends at the organization, and grants are normalized into public Identity & Access
  facts without evaluating them. Include task/project/missing-record chains, direct actor grants,
  role grants, expired grants, exact non-cascading grants, and non-cascading ancestor grants.

- [ ] **Step 3: Run the new test to prove it is red**

  Run from `packages/db`:

  ```sh
  ../../node_modules/.bin/vitest run --config vite.config.ts tests/identity-access.test.ts --maxWorkers=1
  ```

  Expected: module-resolution failure because `@docket/db/identity-access` is not exported yet.

## Task 2: Add the DB-owned adapter

**Files:**

- Create: `packages/db/src/identity-access.ts`
- Modify: `packages/db/package.json`
- Test: `packages/db/tests/identity-access.test.ts`

- [ ] **Step 1: Declare the named public entrypoint**

  Add only `./identity-access` to `@docket/db`'s export map, pointing its `types` and `default`
  conditions at `./src/identity-access.ts`. Keep `src/index.ts` unchanged so consumers must choose
  the persistence boundary deliberately.

- [ ] **Step 2: Implement normalized fact loading**

  Export `ResourceKind`, `ResourceRef`, `ancestorChain`, and
  `loadExplicitAuthorizationFacts(actorId, target, db)`. The result must be either:

  ```ts
  { readonly kind: 'ready'; readonly facts: Pick<ExplicitAuthorizationInput, 'principal' | 'resourceChain' | 'grants'> }
  ```

  or one of `actor_not_found`, `cross_org`, `actor_suspended`, or `actor_archived`.

  Use the exact current same-org `actor.roleId → role.id` join. Load task/project ancestry in the
  existing order, always append the organization root, query candidate grant rows by subject and
  resource IDs, and map only public Identity & Access fact fields. Do not calculate effective
  capability in this package.

- [ ] **Step 3: Run the DB contract test to prove it is green**

  Re-run the Task 1 command. Expected: all adapter facts and denials pass through the public
  package path.

## Task 3: Collapse Authz into a compatibility bridge

**Files:**

- Modify: `packages/authz/src/can-actor.ts`
- Modify: `packages/authz/src/ancestor-chain.ts`
- Modify: `packages/authz/src/index.ts` only if its explicit exports need a type-path update
- Modify: `packages/authz/tests/access-control/authz.test.ts`

- [ ] **Step 1: Add an Authz compatibility assertion**

  Import the DB adapter public path in the existing Authz test and assert that the Authz ancestor
  exports refer to the same adapter surface. Leave the existing 48 behavior cases intact as the
  end-to-end oracle.

- [ ] **Step 2: Run the focused Authz test to prove the compatibility assertion is red**

  ```sh
  cd packages/authz && ../../node_modules/.bin/vitest run --config vite.config.ts \
    tests/access-control/authz.test.ts --maxWorkers=1
  ```

  Expected: the current Authz-owned chain/loading code is not yet the DB adapter export.

- [ ] **Step 3: Make Authz thin without changing its callers**

  Replace `ancestor-chain.ts` with explicit value/type re-exports from
  `@docket/db/identity-access`. Make `canActor` load facts, map each adapter denial to the exact
  existing `ResolveResult`, and call `evaluateExplicitAllow` only for `ready` facts. Preserve the
  `ResolveResult` name, reason strings, timestamps, and `effectiveCapability` behavior so all
  current API/MCP callers remain source-compatible.

- [ ] **Step 4: Run the focused Authz test to prove it is green**

  Re-run the Task 3 command. Expected: existing behavior cases and the public-surface identity
  assertion pass without new API imports.

## Task 4: Verify delivery non-regression and record ownership

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/engineering/specs/domain-first-reorganization.md`
- Read/test: `apps/api/tests/permissions/resource-access.test.ts`
- Read/test: `apps/api/tests/routes/task-helpers.test.ts`
- Read/test: `apps/api/tests/routes/task-resource-access.test.ts`

- [ ] **Step 1: Update the architecture record**

  State that the DB adapter owns only explicit-grant persistence facts and containment loading;
  Authz is a compatibility bridge; API continues to own visibility/public-baseline delivery
  policy. Do not describe the broader Identity & Access migration as finished.

- [ ] **Step 2: Run focused non-regression suites**

  Run the DB adapter and Authz tests plus the listed API authorization suites serially. The API
  tests must continue to prove its human/guest/public-baseline policy independently of the moved
  DB facts.

- [ ] **Step 3: Run static checks in every affected package**

  Run `tsc --noEmit`, targeted ESLint, and Prettier in `packages/db` and `packages/authz`; run
  the focused API typecheck/lint/format checks; then run the relevant workspace-policy suite and
  `git diff --check`. Verify no domain source imports DB, Authz, API, Types, or a private source
  path.

- [ ] **Step 4: Record limits honestly**

  Report focused checks only. Do not claim root-wide validation, browser verification, hosted CI,
  or a fresh pnpm lifecycle run while the workspace registry-DNS verifier blocks those commands.

## Batch acceptance

- `@docket/db/identity-access` is the sole public persistence boundary for `canActor` facts.
- `@docket/identity-access` remains pure and portable; it never queries the database.
- Existing Authz importers continue to use `@docket/authz` and preserve exact authorization
  outcomes.
- API task/resource delivery policy remains unchanged and independently tested.
- No root barrel, database migration, schema change, new domain, or compatibility cycle is
  introduced.

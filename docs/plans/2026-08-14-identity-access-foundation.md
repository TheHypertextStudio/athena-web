# Identity & Access Foundation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task.

**Goal:** Establish a real, pure Identity & Access domain that owns executable capability and
explicit-grant policy, while preserving the current API contracts and avoiding a Types/DB cycle.

**Architecture:** `@docket/identity-access` begins as a Zod-only product domain with named public
entrypoints for capability vocabulary, grant applicability, and explicit-grant evaluation. It does
not load Drizzle rows, decide public visibility, or expose HTTP DTOs. the retired contract package and
`@docket/authz` remain temporary compatibility facades; the latter continues to load DB facts and
delegates only its pure decision portion. A later slice introduces a named DB adapter, then moves
task/resource delivery policy after parity characterization.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle (outside the pure domain), pnpm workspace
manifests, domain registry policy.

---

## Non-negotiable boundaries

- `domains/identity-access/src` may depend only on `zod` and local files. It must never import
  the retired contract package, `@docket/db`, Drizzle, API code, UI code, environment state, or test helpers.
- Do not move `Visibility`, `Health`, `ActorOut`, `GrantOut`, `GrantUpsert`, `RoleOut`,
  `RoleCreate`, or `RoleUpdate` in this batch. They are transport or unresolved-policy contracts.
- Do not implement or activate `grant.visibilityOverride`; it is subject-scoped but documented as
  resource-global, and needs a separately approved data model.
- Preserve current maximum-allow capability semantics. Do not introduce deny precedence,
  most-specific replacement, or unsupported initiative/cycle traversal in this refactor.
- Keep the temporary facades explicit and one-way: the retired contract package / `@docket/authz` may import
  Identity & Access; Identity & Access may not import either one.

## Task 1: Correct Billing's deployable-runtime contract

**Files:**

- Modify: `domains/registry.json`
- Modify: `domains/billing/package.json`
- Modify: `packages/test-utils/tests/workspace-policies/domain-registry-policy.test.ts`
- Modify: `docs/engineering/specs/domain-first-reorganization.md`

### Step 1: Add the failing registry expectation

Add a focused assertion that the `@docket/billing` registration supports only `api`. It should fail
against the current broad `admin`/`runner`/`desktop` declaration.

### Step 2: Verify the red test

Run:

```bash
./node_modules/.bin/vitest run packages/test-utils/tests/workspace-policies/domain-registry-policy.test.ts
```

Expected: the Billing runtime assertion fails because the registry still claims non-API deployables.

### Step 3: Make the smallest truthful change

- Set Billing's `supportedDeployableRuntimes` to `["api"]`.
- Describe the package as server-side billing lifecycle and provider behavior.
- State in the architecture spec that desktop accesses billing over the API/OpenAPI boundary, not
  through Stripe/Drizzle implementation exports.
- Extend the AST-backed workspace policy so production imports from `apps/api`, `apps/web`,
  `apps/admin`, and `apps/runner` may consume a domain only when that domain's registry entry
  declares the corresponding runtime. Cover static, re-export, dynamic-import, and `require`
  forms; source tests are excluded and there is no fictional desktop TypeScript workspace to scan.
- Pin Billing's five deliberate public entrypoints in the registry policy so a later manifest change
  cannot silently broaden its server implementation surface.

### Step 4: Verify green

Run the focused policy test and Prettier. Do not change Billing application code or public exports.

### Step 5: Close policy-bypass review findings

The registry and import policies must also reject the following, with negative fixtures and the
same AST coverage used above:

- a stale registry entry, an absent `domains/<id>/package.json`, or a directory/manifest-name
  mismatch;
- a domain's relative import into a different workspace package or service source tree, even if it
  declares the package as a dependency; public package exports remain the only allowed boundary;
- every root or subpath import of a delivery app package (`@docket/api`, `@docket/web`,
  `@docket/admin`, or `@docket/runner`) from domain source;
- dynamic import with an options argument and test-only helper directories, so the scanner cannot
  be bypassed or report test source as production.

## Task 2: Add the pure Identity & Access domain kernel

**Files:**

- Create: `domains/identity-access/package.json`
- Create: `domains/identity-access/tsconfig.json`
- Create: `domains/identity-access/vite.config.ts`
- Create: `domains/identity-access/src/capabilities.ts`
- Create: `domains/identity-access/src/grants.ts`
- Create: `domains/identity-access/src/authorization.ts`
- Create: `domains/identity-access/tests/capabilities.test.ts`
- Create: `domains/identity-access/tests/authorization.test.ts`
- Modify: `domains/registry.json`
- Modify: `packages/test-utils/tests/workspace-policies/domain-registry-policy.test.ts`
- Modify: `pnpm-lock.yaml`

### Step 1: Write failing domain behavior tests

Create tests which import the intended public entrypoints and prove:

1. the exact five capability values parse, rank in ascending order, and `satisfies` has the correct
   higher-or-equal cascade;
2. an actor grant matches only the same actor, and a role grant matches only the same role;
3. an expired grant does not contribute a capability;
4. a non-cascading ancestor grant does not apply, while an exact target grant does;
5. the evaluator chooses the strongest applicable allow capability and returns a stable reason.

Use plain facts with string IDs; no DB, mocks, routes, or framework setup belongs in these tests.

### Step 2: Verify red

Run the two new test files directly. Expected failure: the public package/module paths do not
exist yet.

### Step 3: Add the package and registry contract

Create `@docket/identity-access` with only these explicit exports:

```text
./capabilities
./grants
./authorization
```

Its sole runtime dependency is `zod`; the registry declares it owned by Identity & Access and
supported by API, web, admin, runner, and desktop because the pure vocabulary/policy is portable.
Add a registry test assertion that the active domain list includes it. Mirror the standard domain
TypeScript/Vitest configuration used by `domains/work`.

### Step 4: Implement the minimal pure policy

- `capabilities.ts`: `Capability`, `GrantCapability`, `CAPABILITY_RANK`, `satisfies`, and a
  `strongestCapability` helper.
- `grants.ts`: `GrantSubjectKind`, `GrantResourceKind`, normalized grant/principal/chain fact
  interfaces, and an applicability predicate that checks organization, subject kind/id, expiry,
  exact target, and cascade.
- `authorization.ts`: an explicit-allow evaluator which receives facts and returns
  `{ allow, effectiveCapability, reason }`. It has no visibility baseline or persistence access.

### Step 5: Verify green

Run domain tests, the domain typecheck, ESLint, Prettier, and registry policy. Confirm the domain
source has no forbidden dependency imports.

## Task 3: Convert legacy capability/grant definitions to facades and delegate `canActor`

**Files:**

- Modify: `the deleted legacy type warehouse/package.json`
- Modify: `domains/work/src/contracts/capability.ts`
- Modify: `apps/api/src/contracts/grant.ts`
- Modify: `the deleted legacy type warehouse tests/core/capability.test.ts`
- Modify: `packages/authz/package.json`
- Modify: `packages/authz/src/index.ts`
- Modify: `packages/authz/src/can-actor.ts`
- Modify: `packages/authz/tests/access-control/authz.test.ts`
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/types.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/routes/task-helpers.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/use-org-capability.ts`
- Modify: `packages/test-utils/tests/workspace-policies/migrated-contract-import-policy.test.ts`
- Modify: `pnpm-lock.yaml`

### Step 1: Write compatibility and parity failures

Add tests showing the retired contract package capability/grant vocabulary is the exact same runtime object as
the new named domain export, and add table-driven `canActor` cases whose outcome must match the
pure evaluator for direct actor grant, role grant, expiry, exact grant, and non-cascading ancestor.

### Step 2: Verify red

Run the Types compatibility and Authz focused suites. Expected failure: compatibility exports and
delegation have not moved yet.

### Step 3: Make facades one-way and delegate decisions

- Replace only the capability and grant-kind definitions in Types with explicit domain re-exports;
  retain `Health`, `Visibility`, branded-ID DTOs, and transport schemas where they are.
- Make DB's `GrantCapability` a type alias of the domain owner.
- Make Authz import/re-export capabilities from Identity & Access and map its loaded actor, role,
  ancestor chain, and grant rows into the pure evaluator. Keep DB querying and `ancestorChain`
  inside Authz for this batch.
- Cut over the two production callers that bypass those facades today: API task visibility imports
  `GrantResourceKind` from `@docket/identity-access/grants`, and Web's org-capability hook imports
  capability vocabulary from `@docket/identity-access/capabilities`. Add their direct manifest
  dependencies in the same edit. API routes that deliberately consume the legacy Authz service stay
  on that compatibility edge.
- Add manifest dependencies and lockfile importers. Do not change production API imports yet;
  `@docket/authz` remains the deliberate compatibility edge for DB-backed authorization calls.

### Step 4: Verify green

Run the new domain suite, Types compatibility suite, Authz access-control suite, task-helper suite,
DB/API/Web typechecks, and policy tests. Check that source ownership/registry/dependency policies
remain green.

## Task 4: Record the migration boundary and prepare the next slice

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/engineering/specs/domain-first-reorganization.md`

### Step 1: Record exactly what moved

Document that Identity & Access owns capability vocabulary, explicit grant applicability, and pure
allow evaluation only. State that DB loading, task visibility, resource visibility, role DTOs,
role administration, agent/human delivery differences, and visibility-policy migration are
deferred with their reasons.

### Step 2: Verify documentation

Run Prettier and `git diff --check` on the changed documentation.

## Batch acceptance

- Existing API wire schema/OpenAPI output remains unchanged.
- No source in `domains/identity-access` imports Types, DB, Drizzle, delivery code, or test code.
- the retired contract package and `@docket/authz` remain compatibility-only edges with no duplicate capability
  or grant-kind definitions.
- Billing no longer falsely declares desktop, admin, or runner implementation support.
- Focused tests prove the new behavior and the old compatibility surface; root/browser/hosted CI
  remain separate integration gates.

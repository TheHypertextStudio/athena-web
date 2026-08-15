# Automation Rules Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or
> `executing-plans` to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Make Automation Rules a portable, feature-owned domain without changing rule execution,
API transport, persistence, or provider-action behavior.

**Architecture:** `@docket/automation` owns the declarative `on → when → then` rule grammar and
the side-effect-free predicate/event evaluators. API code keeps rule persistence, event projection,
handler registration, logging, re-entrancy, and action dispatch. `@docket/types` becomes a
one-way facade for the moved grammar while retaining branded-ID API DTOs.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspace manifests and lockfile, domain registry,
AST-backed import policies.

---

## Non-negotiable boundaries

- `domains/automation/src` may import only `zod` and other local domain files.
- The domain exposes exactly `./contracts` and `./evaluation`; it has no root export.
- `runAutomations`, handler registration, database stores, route validation envelopes, mail routing,
  and API logging stay outside the domain.
- Preserve existing predicate semantics exactly: missing paths are `undefined`; `and` is vacuously
  true; `or` is false when empty; numeric comparisons require numbers; `contains` supports arrays
  and strings; absent match fields are wildcards.
- `@docket/types` may re-export owned schemas but must not duplicate their runtime definitions.

## Task 1: Characterize the portable rule language

**Files:**

- Create: `domains/automation/tests/contracts.test.ts`
- Create: `domains/automation/tests/evaluation.test.ts`
- Read as behavior oracles: `packages/types/tests/dto/automation.test.ts`,
  `apps/api/tests/lib/automation/predicate.test.ts`, and
  `apps/api/tests/lib/automation/engine.test.ts`

- [x] **Step 1: Write failing public-entrypoint tests**

  Import `@docket/automation/contracts` and `@docket/automation/evaluation`. Cover a recursive
  `Predicate`, default `ActionSpec.params`, internal and external `AutomationEventMatch`, and a
  complete `AutomationRule`.

- [x] **Step 2: Add evaluator behavior cases before implementation**

  Assert dotted-path resolution, all five leaf operators, nested boolean composition, empty
  `and`/`or`, absent event-match fields as wildcards, and missing fields as non-throwing false
  comparisons.

- [x] **Step 3: Verify red**

  Run the two domain test files directly. They must fail because the public package entrypoints do
  not exist—not because they depend on API, Types, or a database.

## Task 2: Create the portable Automation Rules domain

**Files:**

- Create: `domains/automation/package.json`
- Create: `domains/automation/tsconfig.json`
- Create: `domains/automation/vite.config.ts`
- Create: `domains/automation/src/contracts.ts`
- Create: `domains/automation/src/evaluation.ts`
- Modify: `domains/registry.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Add a zod-only package contract**

  Mirror the established `domains/work` configuration. Declare only the named `./contracts` and
  `./evaluation` exports, `zod` as the sole runtime dependency, and no root export.

- [x] **Step 2: Move the grammar without changing its shape**

  Put `PredicateValue`, `PredicateLeafOp`, `Predicate`, `ActionSpec`, `AutomationEventMatch`, and
  `AutomationRule` in `contracts.ts`, preserving their schemas, metadata, defaults, and inferred
  type names.

- [x] **Step 3: Move the pure behavior without API dependencies**

  Put `evaluatePredicate(predicate, event)` and `matchesAutomationEvent(on, event)` in
  `evaluation.ts`. Keep internal helper functions private. Do not move `runAutomations` or a
  registry type into the domain.

- [x] **Step 4: Register the explicit deployable boundary**

  Add the domain to `domains/registry.json` as Automation-owned, with its two exports, zod-only
  runtime dependency, and `api`, `web`, `admin`, `runner`, and `desktop` support.

- [x] **Step 5: Verify green**

  Run domain tests, TypeScript, ESLint, Prettier, and the domain-registry policy. Confirm with a
  source scan that no domain source imports Types, DB, an app, a delivery runtime, or test helpers.

## Task 3: Turn Types into a compatibility facade and move consumers to public domain paths

**Files:**

- Modify: `packages/types/package.json`
- Modify: `packages/types/src/automation.ts`
- Modify: `packages/types/src/recurrence.ts`
- Modify: `packages/types/tests/dto/automation.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/lib/automation/predicate.ts`
- Modify: `apps/api/src/lib/automation/engine.ts`
- Modify: `apps/api/src/lib/automation/rules-store.ts`
- Modify: `apps/api/src/lib/automation/routing-cues.ts`
- Modify: `apps/api/src/lib/automation/registry.ts`
- Modify: `apps/api/tests/lib/automation/predicate.test.ts`
- Modify: `apps/api/tests/lib/automation/engine.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/components/settings/automations-tab.tsx`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Prove runtime schema identity**

  Add a Types compatibility test proving the legacy `Predicate`, `ActionSpec`,
  `AutomationEventMatch`, and `AutomationRule` exports are the exact same runtime objects as the
  new Automation domain exports.

- [x] **Step 2: Make Types one-way**

  Replace the six portable schema/type definitions in `packages/types/src/automation.ts` with
  explicit value-and-type re-exports from `@docket/automation/contracts`. Retain
  `AutomationRuleCreate`, `AutomationRuleUpdate`, `AutomationRuleRemoved`, and
  `AutomationRuleOut`, since their branded IDs and API transport fields remain Types-owned.
  Point `recurrence.ts` directly at the public Automation event-match path.

- [x] **Step 3: Cut API to named public boundaries**

  Make `predicate.ts` a small compatibility forwarding module or delete it only if every caller
  moves in the same slice. Have `engine.ts` import the named evaluation functions while retaining
  `EngineRule`, `ActionContext`, dispatch ordering, handler lookup, error isolation, and logging.
  Move `rules-store.ts` and `routing-cues.ts` grammar imports to `./contracts`; update the registry
  documentation reference.

- [x] **Step 4: Cut Web to the grammar owner**

  Import `ActionSpec` directly from `@docket/automation/contracts` in the automations UI; retain
  `AutomationRuleCreate` and `AutomationRuleOut` from Types as API DTOs.

- [x] **Step 5: Declare every direct dependency and verify behavior**

  Add `@docket/automation: workspace:*` to Types, API, and Web and synchronize the lockfile.
  Run the Types grammar/identity tests, API predicate/engine and automation-route tests, and the
  Web automation-template test before package typechecks and linting.

## Task 4: Lock the boundary and document the migration

**Files:**

- Modify: `packages/test-utils/tests/workspace-policies/domain-registry-policy.test.ts`
- Modify: `packages/test-utils/tests/workspace-policies/domain-import-policy.test.ts`
- Modify: `packages/test-utils/tests/workspace-policies/migrated-contract-import-policy.test.ts`
- Modify: `packages/test-utils/tests/workspace-policies/workspace-lockfile-policy.test.ts`
- Modify: `docs/WORKLOG.md`
- Modify: `docs/engineering/specs/domain-first-reorganization.md`

- [x] **Step 1: Add registry and lockfile expectations**

  Assert that Automation appears with exactly its two public exports, zod-only dependency, and
  declared portable runtimes. Assert the three direct consumers have manifest and lockfile
  dependencies.

- [x] **Step 2: Prevent new Types ownership drift**

  Register the six portable Automation grammar symbols in the migrated-contract policy. Existing
  Types facades are permitted; production imports from API/Web must use the Automation public
  entrypoint. Test static imports, re-exports, type queries, dynamic import, and require bypass
  forms already covered by the shared policy helpers.

- [x] **Step 3: Record the honest boundary**

  Update the worklog and architecture spec to say Automation owns grammar and pure evaluation only.
  Explicitly leave API rule persistence, provider action adapters, handler registry, action
  dispatch, and re-entrancy in the API layer.

- [x] **Step 4: Final focused validation**

  Run all Automation domain tests, Types/API/Web focused behavior tests, package typechecks and
  scoped lint/format checks, all workspace-policy tests, and `git diff --check`. Do not claim a
  root suite, browser run, hosted CI, or a fresh pnpm lifecycle run while the local registry-DNS
  verifier prevents those commands.

## Batch acceptance

- Desktop can parse and evaluate Automation Rules through explicit public domain paths with no API,
  DB, handler, mail, or provider dependency.
- Existing API and Web rule behavior remains equivalent, including error isolation during action
  dispatch.
- Types keeps only a temporary, explicit compatibility facade for the moved grammar; no duplicate
  schema definitions remain.
- No new root barrel, package-private source import, types-only package, or domain-to-delivery
  dependency is introduced.

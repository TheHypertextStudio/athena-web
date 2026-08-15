# Domain-first reorganization

**Status:** Active
**Decision date:** 2026-08-13

## Objective

Make Athena understandable by organizing code around the product concepts people work with, rather
than around generic technical layers or a global `@docket/types` warehouse. The web application,
API, admin surface, Cloudflare runner, and future desktop app must share stable product vocabulary
and API contracts without sharing framework-bound implementation code.

## Decisions

1. Delete `@docket/types`; do not rename it to `core`, `shared`, `common`, or another omnibus
   package.
2. Create business-owned workspaces only where a domain has executable contracts, validation,
   policies, or use cases that genuinely serve more than one deployable. A types-only package is
   not permitted.
3. Keep Next, Hono, Cloudflare, Drizzle, provider SDKs, and native UI code at delivery or adapter
   edges. Routes, MCP handlers, cron jobs, queues, and workflows invoke domain application code;
   they do not own business logic.
4. Use OpenAPI as the cross-platform wire contract. The macOS client consumes generated Swift
   transport code and maintains explicit local projections; it does not share TypeScript models.
5. Preserve observable API, persistence, authorization, audit, and user-facing behavior in every
   migration slice unless a separate change explicitly approves a behavior change.

## Working structure

```text
apps/                         Delivery and composition
  api/
  web/
  admin/
  runner/

domains/                      Business-owned runtime code
  athena/
  automation/
  billing/
  connections/
  identity-access/
  work/

packages/                     Narrow technical capabilities
  db/
  env/
  ui/
  brand/
  mail/
  blob-store/
  service-worker/
  test-utils/
```

Only create a domain workspace once it owns real product behavior. Athena, Automation, Billing,
Connections, Identity & Access, and Work are active domain workspaces; empty folders and technical-layer
packages are not placeholders for architecture. Future work may establish notifications or
planning boundaries when it has a similarly concrete ownership boundary.

Connections owns the Docket-designed Notion mirror's contracts, rules, port, and Notion
SDK/in-memory adapters at
`@docket/connections/notion/{mirror-contract,mirror-schema,mirror-values,mirror-port,adapters/notion-sdk,adapters/in-memory}`.
The API still owns credential lookup, leased sync/reconciliation, application workflows, and
delivery composition; the generic linked-database connector remains in Integrations. This is a
real ownership milestone, not a claim that the broader Connections vertical slice is complete.

`work` means the product's actionable-work hierarchy: initiatives, programs, projects,
milestones, cycles, tasks, dependencies, labels, comments, templates, saved views, and recurrence.
It is a domain name, not a route name or a generic utility bucket.

Each domain has deliberate exports only. The machine-readable source of truth is
[`domains/registry.json`](../../../domains/registry.json), which records the owner, public entry
points, allowed runtime dependencies, and supported runtimes. The registry and each package
manifest are checked together.

Representative public entry points are:

```text
@docket/work/task-contract
@docket/work/task-drafting
@docket/athena/turn
@docket/athena/turn/adapters/lattice
@docket/automation/contracts
@docket/automation/evaluation
@docket/billing/application/entitlement
@docket/connections/notion/mirror-contract
@docket/connections/notion/mirror-port
@docket/connections/notion/adapters/notion-sdk
@docket/identity-access/capabilities
@docket/identity-access/grants
@docket/identity-access/authorization
```

No root wildcard barrel can expose implementation details, mocks, or provider adapters. Production
code cannot import another domain's private paths, app routes, UI components, environment
singletons, or testing exports.

## Current public domain boundaries

The table groups public entry points by capability; the registry is the complete list.

| Domain            | Owns                                                                                                                 | Public capability groups                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Athena            | Guided agent work, durable execution, elicitation, conversation, turns, voice, and phone                             | execution; elicitation; session/bus; conversation/digest; turns; voice; phone |
| Automation        | Declarative Automation Rules grammar and side-effect-free predicate/event evaluation                                 | contracts; evaluation                                                         |
| Billing           | Subscription state, entitlement policy, and provider adapters                                                        | contracts; adapters; lifecycle; entitlement                                   |
| Connections       | Docket-designed Notion mirror contracts, rules, port, and adapters; generic linked connector remains in Integrations | mirror contract/schema/values; port; SDK/in-memory adapters                   |
| Identity & Access | Capability vocabulary, explicit-grant applicability, and pure maximum-allow evaluation                               | capabilities; grants; authorization                                           |
| Work              | Actionable-work vocabulary, priority/task contracts, and task rules                                                  | vocabulary; priority/task contract; drafting port; titles; parent resolution  |

`@docket/work/task-drafting` owns the `TaskSynthesizer` port. Athena's Anthropic and deterministic
implementations live under its own explicit `task-drafting/adapters/*` entry points and depend
one-way on Work. This keeps provider code out of the work domain and gives another runtime a clear
place to supply a different implementation.

Work owns the canonical product vocabulary, `Priority`, task contracts, the task-drafting port,
title normalization, and parent resolution. Those are product concepts, not a generic type layer.

Automation owns the portable Automation Rules language: the `on → when → then` grammar and its
side-effect-free predicate and event-match evaluation. It does not persist rules, project events,
register or run action handlers, log failures, enforce re-entrancy, or expose API DTO envelopes;
those delivery concerns remain in API. `@docket/types` retains branded create/update/read DTOs and
an explicit temporary compatibility re-export of the grammar while consumers migrate.

Identity & Access is intentionally a pure, portable kernel. It accepts normalized actor/role,
grant, and target-chain facts and evaluates explicit `allow` grants only. It does not query
Drizzle, discover resource ancestry, decide a public-visibility baseline, or expose HTTP DTOs.
`@docket/authz` remains the named DB-backed adapter: it validates caller state, loads the
authoritative in-org role and grants, builds the containment chain, then delegates the normalized
facts to `@docket/identity-access/authorization`. `@docket/types` retains role/grant transport
schemas and re-exports the moved capability/grant-kind objects only as a temporary facade.

`@docket/types` is a temporary, deprecated compatibility facade while callers migrate. It may
re-export an already-owned contract for a bounded transition, but new domain contracts and runtime
behavior must originate in the owning domain. Do not add new generic exports there.

Billing is API-only: desktop clients access billing through the API/OpenAPI boundary, not through
Stripe or Drizzle implementation exports.

## Enforced debt-prevention guardrails

- The domain registry policy makes `domains/registry.json`, each domain manifest, public exports,
  runtime dependencies, and supported deployable runtimes agree.
- The AST-backed domain-import policy rejects production imports from delivery apps, UI,
  environment singletons, test-only code, another domain's private paths, and generic type
  packages. It scans both `src` and production build/configuration entrypoints, and recognizes
  static imports, re-exports, dynamic imports, and CommonJS `require`.
- The retired-package policy prevents `@docket/agent-runtime` from returning in workspace manifests
  or shipped source.
- The workspace-lock integrity policy keeps every declared `workspace:*` relationship synchronized
  with `pnpm-lock.yaml`, including service workspaces.
- The migrated-contract policy keeps `Priority`, capability/grant vocabulary, Automation grammar,
  and migrated Athena/Connections contracts out of production imports from `@docket/types`; it scans `src` and
  production build/configuration entrypoints and rejects opaque dynamic/CommonJS loader paths that
  could bypass a named public contract. The temporary facade itself remains the allowed
  compatibility edge.
- The literal-NUL source policy rejects embedded NUL bytes in checked source while allowing readable
  escaped delimiters, so source remains searchable and reviewable.

## Dependency direction

```text
deployable composition root
  -> domain-qualified adapters
    -> domain application and ports
      -> domain contracts and rules

route / MCP / cron / queue / workflow -> domain application service
persistence adapter              -> @docket/db/<domain>
provider adapter                 -> provider SDK
```

The physical Drizzle schema and migration history remain centralized during the migration. Domain
repositories map persistence records to domain contracts; database rows are not canonical API
models.

## Migration order

### 0. Restore a trustworthy baseline

- Fix the red CI and E2E regressions.
- Repair broken public package exports and remove no-op generator commands.
- Make required CI, E2E smoke, and branch protection truthful.
- Capture behavior, schema, API-contract, import, and protocol baselines.

### 1. Prevent new debt

- Add a machine-readable domain registry with ownership, public exports, allowed dependencies, and
  supported runtimes.
- Enforce package exports, dependency direction, cycles, file-size ratchets, generated-file drift,
  and a frozen `@docket/types` surface.
- Publish current onboarding and architecture documentation.

### 2. Migrate vertical domain slices

Move contract, domain rule, application service, persistence adapter, delivery handler, UI client,
and tests together. Connections has completed that vertical move for the Docket-designed Notion
mirror: its contracts, rules, port, and provider adapters are domain-owned, while credential
lookup, leased reconciliation, and the generic linked connector deliberately remain outside it.
Automation Rules now owns its portable grammar and pure evaluation under explicit domain paths;
API retains persistence and action execution. Continue with notifications, remaining work,
planning, and Athena slices as their ownership boundaries become concrete.

Identity & Access now owns pure capability and explicit-grant policy behind named subpaths. The
next Identity & Access slice must introduce a named DB adapter only after characterizing its
existing Authz behavior. It must not make the pure domain depend on `@docket/db` or
`@docket/types`: that would recreate the cycle the migration eliminated. Task visibility,
generic-resource visibility, role DTOs and administration, and human/agent delivery differences
remain outside the pure evaluator because they depend on persistence and delivery policy. Global
resource visibility also requires a separately approved, subject-independent policy record; the
existing subject-scoped `grant.visibilityOverride` is not an implementation-ready global policy.

### 3. Remove compatibility surfaces

Delete `@docket/types`, broad root barrels, route-to-route business imports, direct
route-to-database access, and duplicated Runner/API execution protocol code once their replacement
contracts are proven.

### 4. Burn down readability debt

New handwritten files target at most 300 lines; existing files are ratcheted down with a hard
ceiling of 500 lines. Generated and schema files may be exempt only with an owner, reason,
regeneration command, and verification command.

## Slice acceptance criteria

Each slice must:

- Start with characterization tests for the behavior being moved.
- Preserve serialized API fixtures and migration checksums during code-only moves.
- Regenerate and compare the OpenAPI document.
- Exercise every delivery caller that uses the application service.
- Pass focused tests, root typecheck, lint, tests, and build.
- Reduce a tracked debt budget without increasing another.
- Update the domain registry, architecture docs, and work log.

## Non-goals

- A one-shot directory rewrite.
- Physical database migration churn for code organization alone.
- A generic replacement for `@docket/types`.
- Shared TypeScript source between the web application and the native desktop application.

## Current verification and governance gaps

- The repaired browser journeys still need a canonical CI-topology run; an isolated fresh local
  stack reached unrelated offline/page-unavailable states before it could validate the assertions.
- The `E2E` workflow is advisory and non-gating today. It must not be described as a required
  deploy or merge check until a reliable, required execution is configured.
- Remote branch protection still needs a repository administrator to configure required checks and
  review/admin enforcement. Local repository policies cannot make that remote setting true.
- Focused package and policy checks support the completed slices. This document makes no claim that
  a full root lint, typecheck, test, or build run has passed for the migration.

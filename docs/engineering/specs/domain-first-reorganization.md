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

## Target structure

```text
apps/                         Delivery and composition
  api/
  web/
  admin/
  runner/

domains/                      Business-owned runtime code
  identity-access/
  work/
  planning/
  athena/
  connections/
  notifications/
  billing/

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

`work` means the product's actionable-work hierarchy: initiatives, programs, projects,
milestones, cycles, tasks, dependencies, labels, comments, templates, saved views, and recurrence.
It is a domain name, not a route name or a generic utility bucket.

Each domain has deliberate exports only:

```text
@docket/work/contract
@docket/work/application
@docket/work/ports
@docket/work/testing
```

No root wildcard barrel can expose implementation details, mocks, or provider adapters. Production
code cannot import another domain's private paths, app routes, UI components, environment
singletons, or testing exports.

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
and tests together. Begin with connections/provider catalog, notifications, billing, and a full
work/task vertical slice. Follow with identity-access, remaining work, planning, and Athena.

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

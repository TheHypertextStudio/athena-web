# Local-First Detail Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paint a validated entity snapshot within 200 ms of an authenticated row click and move
server reconciliation off the navigation critical path without adding idle infrastructure cost.

**Architecture:** The existing browser-location store and generated offline route table become the
online authenticated router. A bounded snapshot store provides the first detail paint, and one typed
aggregate endpoint reconciles each entity. TanStack request caching and IndexedDB offline retention
receive separate lifetimes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Hono RPC, TanStack Query, IndexedDB, Drizzle,
Vitest, and Playwright.

**Spec:** `docs/engineering/local-first-detail-navigation.md`

## Global Constraints

- Add no router, state-management, edge-service, or always-on compute dependency.
- Keep browser API requests same-origin and call the API origin directly from server code.
- Use branded identifiers and shared Zod schemas at route, cache, and API boundaries.
- Retain one route leaf, three in-memory snapshots, five minutes of ordinary inactive queries, and
  at most 25 MB of per-user snapshots for 24 hours in IndexedDB.
- Preserve real links, modified clicks, back and forward navigation, scoped offline states, and
  application-owned error copy.

---

### Task 1: Typed navigation contracts

- [x] Add failing tests for typed href construction, runtime route parsing, invalid identifiers,
      exhaustive entity snapshots, and complete subject references.
- [x] Generate parameter schemas and lazy loaders from authenticated file routes.
- [ ] Add typed route hooks and entity-opening helpers, then pass the focused contract tests.

### Task 2: Authenticated browser router

- [ ] Add failing browser and component tests proving same-tab navigation commits without RSC and
      back or forward navigation mounts the correct leaf.
- [ ] Make the authenticated outlet run online and offline through the existing location store.
- [ ] Route all authenticated links and imperative owners through the shared transport, and enforce
      the boundary with a source-policy test.

### Task 3: Bounded snapshot storage

- [ ] Add failing unit tests for the three-entry memory bound, schema/version rejection, 24-hour
      expiry, 25 MB LRU eviction, and user-scoped purge.
- [ ] Implement memory and IndexedDB snapshot stores.
- [ ] Remove whole-query persistence and restore five-minute default query garbage collection.

### Task 4: Aggregate API reads

- [ ] Add failing route tests for authenticated Task, Project, Program, and Initiative aggregates,
      output validation, tenant isolation, and missing or revoked access.
- [ ] Implement the four aggregate reads with no organization-wide rosters or per-row queries.
- [ ] Expose all responses through the Hono RPC contract and shared detail schemas.

### Task 5: Snapshot-first detail pages

- [ ] Add failing tests for immediate identity paint, delayed syncing feedback, transient refresh
      failure, `403`, `404`, deletion, and optional-section failure.
- [ ] Migrate the four work-view rows and detail routes to `openEntity` and the aggregate reads.
- [ ] Lazy-load pickers and inactive sections instead of fetching their collections on mount.

### Task 6: Performance and rollout gates

- [ ] Add production-build Playwright coverage for 50 ms acknowledgement, 200 ms identity paint,
      zero RSC requests, one aggregate request, and route-race prevention.
- [ ] Add offline direct-load and 50-navigation memory tests with forced garbage collection.
- [ ] Add sampled navigation timing and a rollback flag, then document measured production results.

### Task 7: Validation and closeout

- [ ] Run focused tests after every task and the repository typecheck, lint, test, and build gates
      with bounded concurrency.
- [ ] Review the final diff against the specification and update this plan and `docs/WORKLOG.md`.
- [ ] Commit each independently passing product slice with the repository's declared scope.

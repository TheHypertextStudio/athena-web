# Personal Athena API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the private `/v1/me/athena` API over the existing user-owned session substrate while
preserving registered-agent and organization-route compatibility.

**Architecture:** Define personal-only Zod DTOs in `@docket/types`, then mount one Hono router that
derives ownership from the authenticated Better Auth session. A focused context resolver validates
source ownership, workspace consistency, and active membership at invocation. Existing loop,
proposal, transcript, lifecycle, and owner-access services remain the behavior source of truth.

**Tech Stack:** Hono, Zod, Drizzle/Postgres, `@docket/authz`, Vitest, SSE, OpenAPI 3.1.

## Global Constraints

- Athena never receives a workspace Actor, grant, role, or independent authorization path.
- Personal work is owner-only; shared results retain ordinary resource visibility.
- Never accept `ownerUserId` in personal route inputs.
- Invocation context confers no authority; later Docket tool calls reauthorize independently.
- Do not add database schema, migrations, connectors, assignments, UI, or Cloudflare dispatch code.
- Preserve registered agents and every existing organization compatibility route.
- Return application-owned errors and document every route and DTO field.

---

### Task 1: Personal contracts and invocation validation

**Files:**

- Modify: `packages/types/src/agent.ts`
- Modify: `packages/types/src/index.ts`
- Create: `apps/api/src/routes/me-athena-context.ts`
- Test: `apps/api/tests/routes/me-athena.test.ts`

**Interfaces:**

- Produces: `AthenaInvocationContext`, `AthenaSessionSummaryOut`, `AthenaQueueOut`,
  `AthenaOverviewOut`, `AthenaSessionCreateBody`, and `resolveAthenaInvocation(userId, context)`.

- [x] Write route tests that submit valid task/project/initiative/program/calendar/event context,
      mismatched workspaces, another user's calendar item, inaccessible sources, and an
      `ownerUserId` body field.
- [x] Run `pnpm --filter @docket/api test -- me-athena.test.ts` and confirm missing schemas/router
      fail for the intended reason.
- [x] Implement the schemas and resolver. Direct workspace context requires an active human Actor;
      work sources load their canonical `organizationId`; calendar sources require caller ownership
      plus a task link or layer share for the workspace; stream events require the event workspace
      plus caller relevance.
- [x] Re-run the focused test and keep the source/workspace failures existence-hiding.

### Task 2: Owner-only overview, chat, and session routes

**Files:**

- Create: `apps/api/src/routes/me-athena.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/routes/me-athena.test.ts`

**Interfaces:**

- Consumes: request `session.user.id`, `resolveAthenaInvocation`, existing session serializers,
  transcript helpers, and `driveSession`.
- Produces: `/v1/me/athena`, `/chat`, `/chat/messages`, `/chat/new`, `/sessions`,
  `/sessions/:id`, and `/sessions/:id/messages`.

- [x] Write two-user tests proving overview/list/detail/chat/message isolation, stable current-chat
      selection, fresh-chat history preservation, and `needsYou`/`working`/`finished` grouping.
- [x] Run the focused test and confirm 404/privacy and missing-route failures.
- [x] Implement owner-derived session reads and writes. A personal summary contains `queueState`,
      objective text derived from user-authored activity, and validated invocation context; it never
      exposes provider reasoning.
- [x] Preserve synchronous settle responses while `driveSession` is the only dispatcher.
- [x] Re-run the focused tests.

### Task 3: Activity, SSE, proposals, approval, and lifecycle

**Files:**

- Modify: `apps/api/src/routes/me-athena.ts`
- Modify: `apps/api/src/routes/agent-session-approval.ts`
- Test: `apps/api/tests/routes/me-athena.test.ts`
- Test: `apps/api/tests/routes/agent-session-owner-privacy.test.ts`

**Interfaces:**

- Produces: personal activity JSON/SSE, proposal list/edit/group decisions, activity decisions and
  elicitation replies, plus run/pause/resume/cancel and compatibility approval shortcuts.

- [x] Write failing tests for owner-only activity and SSE replay using `Last-Event-ID`, steering,
      lifecycle transitions, batch/single decisions, and approval by an owner without `assign`.
- [x] Add a cross-workspace approved action test proving the decision uses the action workspace and
      the tool still enforces the owner's live permission there.
- [x] Implement the routes by composing existing proposal, loop, transcript, and lifecycle helpers.
      Registered-agent approval context remains workspace-bound; Athena approval context comes from
      the targeted action or persisted session focus and never becomes authority.
- [x] Re-run both personal and compatibility suites.

### Task 4: OpenAPI, documentation, and verification

**Files:**

- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/tests/openapi-spec.test.ts`
- Modify: `docs/engineering/specs/athena-agent.md`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Produces: documented `Athena` operations and final worklog evidence.

- [x] Add an OpenAPI regression requiring the complete personal route family and documented schemas.
- [x] Run focused API and OpenAPI tests.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` in order.
- [x] Run `git diff --check`, inspect the full diff, and verify
      `git rev-list --merges --count 09ec19ac..HEAD` is `0`.
- [x] Mark Task 3 complete in the parent plan and worklog, record validation and retrospective, then
      commit the cohesive feature slice with a substantive Conventional Commit body.

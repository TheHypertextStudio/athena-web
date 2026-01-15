# Project Athena Work Log

> **Purpose**: Comprehensive tracking of all work - past, present, and future.
> **Last Updated**: 2026-01-12

---

## Active Tasks

---

### [CALDAV-SERVER-001] CalDAV Server Foundation (Phase 1)

- **Status**: IN_PROGRESS
- **Started**: 2026-01-12
- **Priority**: P1
- **Description**: Implement CalDAV server to allow native calendar apps (iOS Calendar, macOS Calendar.app) to connect directly to Athena.
- **Subtasks**:
  - [x] Create database schema for calendars, app_passwords, event_changes tables
  - [x] Add CalDAV columns to events table (calendarId, etag, sequence, calendarStatus, transparency, classification)
  - [x] Generate database migration (0008_bizarre_argent.sql)
  - [x] Implement CalDAV Basic Auth middleware with scrypt password hashing
  - [x] Create iCalendar parsing/generation utilities (utils/ics.ts)
  - [x] Create WebDAV XML builder utilities (utils/xml.ts)
  - [x] Implement PROPFIND handler for discovery chain
  - [x] Implement GET handler for event retrieval as .ics
  - [x] Implement PUT handler for event create/update with ETag conflict detection
  - [x] Implement DELETE handler for event removal
  - [x] Mount DAV routes at /dav with .well-known redirects
  - [x] Create app password management API routes
  - [ ] Apply database migration (requires running PostgreSQL)
  - [ ] Test with macOS Calendar.app
- **Notes**: All code compiles. Migration generated but not applied (database not running). REPORT handler returns 501 (not yet implemented - Phase 2).
- **Files Created**:
  - `apps/api/src/db/schema/dav.ts` - CalDAV/CardDAV schema
  - `apps/api/src/services/caldav-server/` - CalDAV server service
  - `apps/api/src/routes/dav.ts` - DAV routes
  - `apps/api/src/routes/app-passwords.ts` - App password management API
  - `apps/api/drizzle/0008_bizarre_argent.sql` - Migration

### [AUTH-SESSION-RESILIENCE-001] Auth Session Resilience Refactor

### [CAL-FIX-001] Calendar Integrations Hardening

- **Status**: IN_PROGRESS
- **State**: IMPLEMENTING
- **Started**: 2026-01-11
- **Priority**: P0
- **Description**: Implement calendar integration fixes for security, reliability, onboarding defaults, accessibility, performance, and schema alignment.
- **Plan**:
  - **Notes**:
    - Updated Google/Outlook providers to rely on official SDKs and require event IDs in types.
    - Added CalDAV provider enum + migration and wired CalDAV into integration registry/UI.
    - Continued tightening sync correctness (410 handling, push-only filtering, prune guards).
  - **State Transitions**: PLANNING → RESEARCHING → IMPLEMENTING (2026-01-12)

## Plan: Calendar Integrations Hardening

### Objective

Implement all calendar integration fixes from the audit, ordered by priority, to ensure “just works” onboarding with strong security and performance.

### Approach

Audit security, performance, correctness, and accessibility across calendar sync; prioritize fixes that block onboarding or cause data loss, then align APIs/types and UX improvements.

### Steps (Priority-Ordered Fixes)

#### P0 (High)

1. Fix CalDAV storage correctness: add a dedicated `caldav_calendar` integration provider enum + migration, update provider mapping, and register CalDAV in the integrations registry so it does not collide with Google.
2. Resolve lint/runtime blockers: add missing imports (CalDAV/iCloud crypto), implement `mergeCalendars` in the sync service, add `pruneMissingEvents`, and guard missing `externalId` by falling back to `id`.
3. Complete OAuth state hardening: signed state + cookie binding, remove userId from state payload, and ensure callback only accepts matching cookie state.
4. Ensure token security: encrypt access/refresh tokens at rest with `DATA_ENCRYPTION_KEY`, enforce production key presence, and keep tokens out of API responses.
5. Sync correctness for deltas + deletions: handle Google/Outlook 410 sync token invalidation with typed errors, paginate all event pages, and prune missing events for CalDAV/iCloud full syncs.
6. Respect syncDirection in pulls: skip inbound sync for push-only calendars and clamp read-only calendars to pull in both service + UI.
7. Prevent cross-calendar duplication: push updates only to the correct connection (by `sourceIntegrationId` or mapping) instead of broadcasting to all connections.
8. iCloud/CalDAV onboarding: intercept `athena://` auth URLs, render credential forms, call calendar callback with state, and surface provider configuration errors.

#### P1 (Medium)

1. Safer onboarding defaults: enable only primary calendars by default and default to pull-only unless the user opts into push/bidirectional.
2. Sync throttling + backoff: avoid redundant syncs on page load by respecting `lastSyncAt`/`lastSyncStatus`, and avoid double-sync after OAuth callback.
3. API contract alignment: update OpenAPI + web client types to include `externalId`, `isPrimary`, `canEdit`, `lastSyncError`, and correct error payload shapes.
4. Error UX improvements: map `error` responses in the API client, show `lastSyncError` in UI, and add clearer retry guidance.
5. Accessibility upgrades: label switches/selects, add `aria-live` for callback status, replace `confirm()` with accessible dialog, and ensure keyboard focus handling.
6. Outlook time zone correctness: parse `dateTime` + `timeZone` into accurate UTC/local times.
7. Harden CalDAV token parsing: validate stored server URLs on read (not just on exchange) and block DNS-rebinding to private IPs.
8. Test coverage: add unit tests for OAuth state, token encryption, sync-direction enforcement, and integration tests for sync pruning + onboarding flows.

#### P2 (Low)

1. Evaluate recurring event handling: decide whether to sync instances (`singleEvents=true`) or store recurrence exceptions for Google/Outlook.
2. Add UX polish for calendar settings: tooltips for sync modes, clearer iCloud app-specific password help, and inline validation for CalDAV server URLs.
3. Add structured sync telemetry: optional logging/metrics for sync duration, page counts, and error frequency to guide future performance work.

### Files to Modify

- `apps/api/src/routes/calendar-sync.ts`
- `apps/api/src/services/calendar-sync/**`
- `apps/api/src/lib/env.ts`
- `apps/api/src/lib/crypto.ts` (new)
- `apps/api/src/db/schema/core.ts` (if schema needs fields)
- `apps/api/src/db/migrations/**` (enum update for CalDAV provider)
- `apps/web/src/components/integrations/**`
- `apps/web/src/app/(protected)/settings/integrations/callback/page.tsx`
- `apps/web/src/hooks/useCalendarSync.ts`
- `apps/web/src/lib/api-client.ts`
- `packages/types/src/openapi/calendar-sync.ts`
- `docs/WORKLOG.md`

### Risks

- OAuth and token encryption changes are security-sensitive and require careful migration.
- Pagination and deletion handling changes could impact sync correctness.

### Validation

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and targeted calendar integration tests if added.

### [ROUTE-MAGIC-VAL-001] Route Magic Value Cleanup

- **Status**: IN_PROGRESS
- **State**: IMPLEMENTING
- **Started**: 2026-01-05
- **Priority**: P1
- **Description**: Replace hardcoded magic values in all API routes with named constants to improve consistency and auditability.
- **Notes**: Constants must remain colocated with route usage (no shared constants module).
- **Plan**:

## Plan: Route Magic Value Cleanup

### Objective

Remove magic values in API routes by consolidating repeated literals into named constants.

### Approach

Inventory repeated literals (status strings, default limits, error messages, enums, timeouts) across route files, add shared constants where appropriate, and update routes to reference them while preserving API behavior.

### Steps

1. Inventory magic values across `apps/api/src/routes/*.ts` and group by domain (status values, pagination defaults, error messages, time units).
2. Introduce constants in route modules or shared route constants (`apps/api/src/routes/constants.ts`) where reuse is meaningful.
3. Update route handlers to reference constants, maintaining existing response shapes and defaults.
4. Run typecheck/lint/tests to ensure no behavior changes or regressions.

### Files to Modify

- `apps/api/src/routes/*.ts`
- `apps/api/src/routes/constants.ts` (new, if shared values are needed)
- `docs/WORKLOG.md`

### Risks

- Unintended behavior changes if defaults are altered during refactor.
- Over-centralization of constants may reduce local clarity.

### Validation

Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

### [BACKEND-PLAN-001] Backend Completion Plan (TASKS.yaml)

- **Status**: IN_PROGRESS
- **State**: IMPLEMENTING
- **Started**: 2026-01-05
- **Priority**: P0
- **Description**: Plan sequencing to implement all backend functionality specified or implied in TASKS.yaml before client work.
- **Plan**:

## Plan: Backend Completion (TASKS.yaml)

### Objective

Deliver all backend functionality in TASKS.yaml so client implementations can proceed against stable APIs.

### Approach

Inventory backlog backend tasks, group by dependency, and execute in phased batches: schema/migrations → routes/services → infra/integrations → realtime/sync → tests/docs.

### Steps

1. Build a backend-only task matrix from TASKS.yaml (IDs, dependencies, required routes/services/schemas).
2. Implement remaining data model changes and migrations (rrule, time blocks, timers, attachments, workspaces, notifications, AI tables, soft delete, custom statuses, etc.).
3. Complete API routes + Zod schemas per domain (auth recovery/sessions/linking, account export/deletion, tasks/calendar/agenda/time, attachments, search, settings, billing, analytics).
4. Add async workers, webhooks, and integration sync pipelines (export jobs, calendar sync, third-party integrations).
5. Implement realtime/sync infrastructure (WebSocket, SSE, offline sync primitives, conflict handling) and MCP server/tools.
6. Run validation (tests, lint, typecheck, build), update docs/OpenAPI, and close WORKLOG tasks.

### Files to Modify

- `apps/api/src/db/schema/*.ts` - new tables/columns and relations
- `apps/api/src/routes/*.ts` - missing endpoints per domain
- `apps/api/src/schemas/*.ts` - Zod IO schemas
- `apps/api/src/services/**` - AI, notifications, storage, encryption
- `apps/api/src/integrations/**` - OAuth + sync logic
- `apps/api/src/workers/**` - background jobs
- `apps/api/src/ws/**` - realtime server
- `packages/mcp-server/**` - MCP server/tools
- `apps/api/tests/**` - unit/integration coverage
- `docs/WORKLOG.md`, `docs/api/` - tracking + OpenAPI docs

### Risks

- External API integrations (calendar, Stripe, Linear) require secrets and callbacks.
- Schema migrations touching existing data (soft delete, encryption) may need backfills.
- Realtime/sync requires careful auth and conflict handling to avoid data races.

### Validation

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` after each batch; ensure coverage targets stay >=80%.

- **Notes**: Task matrix generated at `docs/engineering/backend-task-matrix.md` with user-journey alignment.
- **Notes**: Execution order drafted at `docs/engineering/backend-execution-order.md`.

### [DATA-001] Core Data Models

- **Status**: IN_PROGRESS
- **Started**: 2026-01-04
- **Priority**: P0
- **Description**: Create Drizzle ORM schemas for all core domain entities
- **Subtasks**:
  - [x] Define enums (taskPriority, taskStatus, projectStatus, initiativeStatus)
  - [x] Create initiatives table with self-referencing hierarchy
  - [x] Create projects table
  - [x] Create tasks table with relations
  - [x] Create events table
  - [x] Create moments table
  - [x] Create activityStreams and activities tables
  - [x] Create junction tables (eventParticipants, taskTags, tags)
  - [x] Define all relations
  - [x] Export from schema index
  - [ ] Commit changes
- **Files Changed**:
  - `apps/api/src/db/schema/core.ts` (created)
  - `apps/api/src/db/schema/index.ts` (updated)
  - `apps/api/src/lib/auth.ts` (fixed TypeScript error)

---

## Completed Tasks

### [CALENDAR-ENTRY-CARD-001] Calendar Entry Card Refactor

- **Completed**: 2026-01-14
- **Summary**: Split CalendarEntryCard into focused helper modules, centralized drag-preview logic, and aligned display times with clipped day bounds to reduce drift and improve readability.
- **Files Changed**:
  - `apps/web/src/components/objects/surfaces/DayCalendar/CalendarEntryCard.tsx`
  - `apps/web/src/components/objects/surfaces/DayCalendar/CalendarEntryCardParts.tsx`
  - `apps/web/src/components/objects/surfaces/DayCalendar/CalendarEntryCard.utils.ts`
  - `apps/web/src/components/objects/surfaces/DayCalendar/useCalendarEntryDrag.ts`
  - `docs/WORKLOG.md`

### [UI-TOOLBAR-001] Remove Tasks Toolbar Create Button

- **Completed**: 2026-01-13
- **Summary**: Removed the toolbar "New" create button and cleaned up related props; resolved lint issues in task dependency flow export naming and keyboard navigation centering.
- **Files Changed**:
  - `apps/web/src/components/flows/task-dependency/TaskDependencyFlow.tsx`
  - `apps/web/src/components/flows/task-dependency/useGraphKeyboardNav.ts`
  - `apps/web/src/components/tasks/surfaces/TasksSurface/TasksSurface.tsx`
  - `apps/web/src/components/tasks/surfaces/TasksSurface/TasksToolbar.tsx`
  - `docs/WORKLOG.md`

### [UI-TRANSITION-002] Create Task Modal Shared Element Implementation

- **Completed**: 2026-01-13
- **Summary**: Wired create task triggers to shared element transitions by tracking layout IDs, updating create buttons to motion wrappers, and converting the modal to TransitionModal with layoutId support; resolved a lint blocker in the dependency graph hook.
- **Files Changed**:
  - `apps/web/src/components/flows/task-dependency/useDependencyGraph.ts`
  - `apps/web/src/components/tasks/TaskCreationModal.tsx`
  - `apps/web/src/components/tasks/surfaces/TasksSurface/TasksEmptyState.tsx`
  - `apps/web/src/components/tasks/surfaces/TasksSurface/TasksSurface.tsx`
  - `apps/web/src/components/tasks/surfaces/TasksSurface/TasksToolbar.tsx`
  - `apps/web/src/hooks/useTasksSurface.ts`
  - `docs/WORKLOG.md`

### [UI-TRANSITION-001] Create Task Modal Shared Element Transition

- **Completed**: 2026-01-13
- **Summary**: Identified that the create task modal uses a portal-based Dialog with no shared `layoutId` on the create button, so Framer Motion shared element transitions never link the button to the modal content; resolved lint blockers encountered during validation.
- **Files Changed**:
  - `apps/web/src/components/calendar/TimeBlockTaskSelector.tsx`
  - `apps/web/src/components/objects/surfaces/DayCalendar/CalendarEntryCard.tsx`
  - `docs/WORKLOG.md`

### [APP-PASSWORD-SCRYPT-001] App Password Scrypt Maxmem Fix

- **Completed**: 2026-01-12
- **Summary**: Allowed higher scrypt memory usage for app password hashing/verification to prevent API 500s during app password creation.
- **Files Changed**:
  - `apps/api/src/services/caldav-server/auth.ts`
  - `docs/WORKLOG.md`

### [SECURITY-SETTINGS-SSR-001] Fix Connected Devices Dynamic Import

- **Completed**: 2026-01-12
- **Summary**: Removed the invalid `next/dynamic` `ssr: false` usage in the security settings page by importing the client `ConnectedDevicesSection` directly.
- **Files Changed**:
  - `apps/web/src/app/(protected)/settings/security/page.tsx`
  - `docs/WORKLOG.md`

### [SETTINGS-MOBILE-001] Settings Screen Mobile Responsiveness

- **Completed**: 2026-01-12
- **Summary**: Made the settings screen fully mobile responsive with a sticky header that changes surface elevation on scroll, horizontal scrollable navigation pills on mobile, and responsive settings components.
- **Files Changed**:
  - `apps/web/src/app/(protected)/settings/layout.tsx` - Sticky header with scroll-based elevation, horizontal mobile nav
  - `apps/web/src/components/settings/settings-section.tsx` - Responsive SettingsRow, SettingsItemCard, SettingsToggleRow

### [AUTH-SESSION-RESILIENCE-001] Auth Session Resilience Refactor

- **Completed**: 2026-01-12
- **Summary**: Restored SSR session checks with Better Auth while degrading gracefully on backend failures, showing an auth error banner instead of breaking public-page renders; removed the client gate and cleaned lint/type issues needed for validation.
- **Files Changed**:
  - `apps/web/src/app/(auth)/layout.tsx`
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/components/auth/index.ts`
  - `apps/web/src/components/auth/public-auth-gate.tsx` (deleted)
  - `apps/web/src/components/integrations/calendar-credentials-dialog.tsx`
  - `apps/api/src/routes/app-passwords.ts`
  - `apps/api/src/routes/dav.ts`
  - `apps/api/src/services/caldav-server/auth.ts`
  - `apps/api/src/services/caldav-server/handlers/delete.ts`
  - `apps/api/src/services/caldav-server/handlers/get.ts`
  - `apps/api/src/services/caldav-server/handlers/propfind.ts`
  - `apps/api/src/services/caldav-server/handlers/put.ts`
  - `apps/api/src/services/caldav-server/utils/ics.ts`
  - `apps/api/src/services/caldav-server/utils/xml.ts`
  - `apps/api/src/services/calendar-sync/providers/google.ts`

### [AUTH-SESSION-QUERY-001] Auth Session Query Failure

- **Completed**: 2026-01-12
- **Summary**: Guarded public-page session lookups against database failures and cleaned lint blockers encountered during validation.
- **Files Changed**:
  - `apps/web/src/lib/auth-server.ts`
  - `apps/web/src/app/(auth)/layout.tsx`
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/components/tasks/task-list-item.tsx`
  - `apps/web/src/components/tasks/task-detail-modal.tsx`
  - `apps/web/src/components/tasks/task-list-view.tsx`
  - `apps/api/src/services/calendar-sync/service.ts`
  - `docs/WORKLOG.md`

### [ROUTE-AUDIT-NULL-001] Route Null/Undefined Handling Audit

- **Completed**: 2026-01-11
- **Duration**: 0.2 day
- **Summary**: Validated null/undefined handling changes and confirmed route fallbacks now surface invalid state instead of silently defaulting.
- **Files Changed**:
  - `apps/api/src/routes/account.ts`
  - `apps/api/src/routes/ai.ts`
  - `apps/api/src/routes/billing.ts`
  - `apps/api/src/routes/bulk.ts`
  - `apps/api/src/routes/integrations.ts`
  - `apps/api/src/routes/onboarding.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Route defaults should be explicitly documented to avoid masking invalid state.
- **Retrospective**: Went well—validation passes confirmed the audit changes; improve—capture fallback rules in shared route docs; change—pair audits with dedicated route tests when defaults shift.
- **State Transitions**: PLANNING → IMPLEMENTING → VALIDATING → COMPLETE
- **Validation**: `pnpm typecheck`, `pnpm lint`, `pnpm test`

### [WEB-WARN-001] Web Build Warning Cleanup

- **Completed**: 2026-01-11
- **Duration**: 0.2 day
- **Summary**: Removed Next.js build warnings by guarding workspace persistence storage for SSR and disabling composite/declaration settings in the web tsconfig.
- **Files Changed**:
  - `apps/web/src/hooks/use-active-workspace.ts`
  - `apps/web/tsconfig.json`
  - `docs/WORKLOG.md`
- **Learnings**: Client-side persistence needs an SSR-safe storage initializer to avoid Node web storage warnings.
- **Retrospective**: Went well—stack trace pinpointed the storage access quickly; improve—add SSR guardrails for other client-only storage uses; change—track build warnings in worklog to prevent regressions.
- **State Transitions**: PLANNING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING
- **Validation**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`

### [MCP-REF-001] MCP Server Hardening + Refactor

- **Completed**: 2026-01-11
- **Duration**: 0.4 day
- **Summary**: Hardened MCP server scoping, privacy, and pagination; modularized resources/tools/prompts; added typed query helpers and MCP tests; refactored agenda prompt helper.
- **Files Changed**:
  - `packages/mcp-server/package.json`
  - `packages/mcp-server/src/index.ts`
  - `packages/mcp-server/src/constants.ts`
  - `packages/mcp-server/src/prompts.ts`
  - `packages/mcp-server/src/queries.ts`
  - `packages/mcp-server/src/resource-templates.ts`
  - `packages/mcp-server/src/resources.ts`
  - `packages/mcp-server/src/subscriptions.ts`
  - `packages/mcp-server/src/tools.ts`
  - `packages/mcp-server/src/types.ts`
  - `packages/mcp-server/src/utils.ts`
  - `packages/mcp-server/tests/mcp-server.test.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Shared query helpers and typed schema inputs prevent scoping drift; modular MCP handlers make testing safer.
- **Retrospective**: Went well—module split reduced lint friction and clarified ownership checks; improve—add more MCP tooling tests around sampling; change—standardize cursor helpers across services.
- **State Transitions**: PLANNING → RESEARCHING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING
- **Validation**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`

### [LINT-DEP-001] Task Status Deprecation Cleanup

- **Completed**: 2026-01-11
- **Duration**: 0.2 day
- **Summary**: Replaced deprecated `tasks.status` usage with status category mappings across agenda, analytics, search, repository, and AI tools; added status mapping helpers.
- **Files Changed**:
  - `apps/api/src/routes/agenda.ts`
  - `apps/api/src/services/analytics/service.ts`
  - `apps/api/src/services/ai/tools.ts`
  - `apps/api/src/services/search/service.ts`
  - `apps/api/src/services/tasks/repository.ts`
  - `apps/api/src/services/tasks/schemas.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Status category is the canonical filter surface; legacy status inputs should map through a single helper.
- **Retrospective**: Went well—targeted replacements cleared lint quickly; improve—add contract tests for status filters; change—centralize status mappings early to avoid repeated refactors.
- **State Transitions**: PLANNING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING
- **Validation**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`

### [MCP-AUDIT-001] MCP Server Architecture Audit

- **Completed**: 2026-01-11
- **Duration**: 0.2 day
- **Summary**: Audited the MCP server package for architecture, security/privacy, and performance risks; documented remediation recommendations.
- **Files Changed**:
  - `docs/WORKLOG.md`
- **Learnings**: Subscription tracking must be session-scoped to prevent notification leakage; user scoping needs consistent enforcement in every query.
- **Retrospective**: Went well—targeted scan surfaced correctness and privacy gaps quickly; improve—add MCP tool/resource tests; change—codify resource/tool guardrails in a shared helper.
- **State Transitions**: PLANNING → RESEARCHING → DOCUMENTING → RETROSPECTING
- **Validation**: `pnpm typecheck`; `pnpm lint` failed (existing @typescript-eslint/no-deprecated errors in `apps/api`).

### [CAL-AUDIT-001] Calendar Integrations Audit

- **Completed**: 2026-01-11
- **Duration**: 0.2 day
- **Summary**: Audited calendar integrations (Google, Outlook, iCloud, CalDAV) for onboarding defaults, UX/accessibility, lint/type safety, performance, and security. Compiled findings and remediation recommendations.
- **Files Changed**:
  - `docs/WORKLOG.md`
- **Learnings**: Calendar sync correctness depends on incremental pagination and explicit delete handling; OAuth state must be signed and user-bound.
- **Retrospective**: Went well—inventorying API+UI touchpoints surfaced integration gaps quickly; improve—add automated calendar sync tests to catch data divergence; change—align OpenAPI schemas with runtime responses.
- **State Transitions**: PLANNING → RESEARCHING → DOCUMENTING → RETROSPECTING
- **Validation**: Audit-only; no code changes.

### [TEST-BLOCKERS-001] API Test Blockers

- **Completed**: 2026-01-05
- **Duration**: 0.2 day
- **Summary**: Unblocked API integration tests by fixing task dependency checks, aligning dependency error messaging, and adding test-safe defaults for integration redirects and subscriptions.
- **Files Changed**:
  - `apps/api/src/lib/errors.ts`
  - `apps/api/src/services/tasks/repository.ts`
  - `apps/api/src/services/tasks/service.ts`
  - `apps/api/src/routes/integrations.ts`
  - `apps/api/tests/setup.ts`
  - `apps/api/tests/integration/test-utils.ts`
  - `apps/api/tests/integration/tasks.test.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Mocked `findFirst` calls may resolve `null`, so repository checks must treat `null` as no result.
- **Retrospective**: Went well—targeted fixes stabilized integration flows; improve—align error status codes with OpenAPI earlier; change—centralize test env defaults to avoid repeated setup edits.
- **State Transitions**: PLANNING → RESEARCHING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING
- **Validation**: `pnpm test`

### [LINT-ALL-001] Repo-wide Lint Cleanup

- **Completed**: 2026-01-05
- **Duration**: 0.1 day
- **Summary**: Confirmed repo-wide lint remains clean after test and error-handling fixes.
- **Files Changed**:
  - `docs/WORKLOG.md`
- **Learnings**: Keep error handlers generic enough for app-scoped context types to avoid typecheck regressions.
- **Retrospective**: Went well—lint stayed clean during test fixes; improve—run lint alongside targeted test fixes to catch drift sooner.
- **Validation**: `pnpm lint`

### [WEB-LINT-001] Web Lint Cleanup

- **Completed**: 2026-01-05
- **Duration**: 0.1 day
- **Summary**: Web lint and tests complete without additional code changes; prior jsdom blocker no longer impacts `pnpm test`.
- **Files Changed**:
  - `docs/WORKLOG.md`
- **Learnings**: Re-running full validation can surface that earlier environment blockers are already resolved.
- **Retrospective**: Went well—frontend suites ran cleanly once the environment stabilized; improve—capture transient environment blockers with a retry checklist.
- **Validation**: `pnpm lint`, `pnpm test`

### [VALIDATION-ROUTES-002] Backend Lint/Test Cleanup

- **Completed**: 2026-01-05
- **Duration**: 0.2 day
- **Summary**: Completed backend validation by fixing task dependency detection and ensuring error handling composes with typed app contexts.
- **Files Changed**:
  - `apps/api/src/lib/errors.ts`
  - `apps/api/src/middleware/error-handler.ts`
  - `apps/api/src/services/tasks/repository.ts`
  - `apps/api/src/services/tasks/service.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Context typing in Hono requires generic helpers to accept app-specific variables.
- **Retrospective**: Went well—type and error handling fixes were localized; improve—add a regression test for circular dependency lookups with null mocks.
- **Validation**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`

### [TEST-MOCK-DB-001] Centralize DB Mocks

- **Completed**: 2026-01-05
- **Duration**: 0.2 day
- **Summary**: Consolidated API test database mocks into a shared utility with hoisted-friendly setup and reset helpers, then migrated integration and service tests to the shared mock.
- **Files Changed**:
  - `apps/api/tests/integration/test-utils.ts`
  - `apps/api/tests/setup.ts`
  - `apps/api/tests/integration/*.test.ts`
  - `apps/api/tests/services/risc.test.ts`
  - `apps/api/src/test/helpers.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Vitest hoisted mocks require a globally initialized factory to avoid import-time access errors.
- **Retrospective**: Went well—centralization reduced repeated mock definitions; improve—capture table coverage once when new routes land; change—consider a typed helper for table presence.
- **Validation**: `pnpm --filter @athena/api test`

### [MCP-ROUTES-007] Remove MCP Subroutes

- **Completed**: 2026-01-05
- **Duration**: 0.1 day
- **Summary**: Removed non-spec `/mcp/resources`, `/mcp/tools`, and `/mcp/prompts` routes so MCP is served only from `/mcp`.
- **Files Changed**:
  - `apps/api/src/routes/mcp.ts`
  - `apps/api/src/index.ts`
  - `docs/WORKLOG.md`
  - `docs/engineering/deployment.md`
- **Learnings**: Keeping MCP on a single endpoint avoids drift between static lists and the registered server surface.
- **Retrospective**: Went well—routing simplification was straightforward; improve—document migration expectations for clients using the removed routes.

### [MCP-UTIL-005] MCP Utilities + Session Isolation

- **Completed**: 2026-01-05
- **Duration**: 1 day
- **Summary**: Added MCP subscriptions, listChanged and resource-updated notifications for task/event changes, pagination coverage, completions support, and session isolation checks. Validated with MCP integration tests and MCP server typecheck.
- **Files Changed**:
  - `packages/mcp-server/src/index.ts`
  - `apps/api/src/routes/mcp.ts`
  - `apps/api/tests/integration/mcp.test.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Resource updated notifications should be gated behind subscriptions; listChanged remains independent of subscriptions.
- **Retrospective**: Went well—MCP utilities mapped cleanly to SDK capabilities; improve—type-safe JSON parsing helpers earlier to avoid lint churn; change—add shared test utilities for MCP response parsing to reduce repetition.

### [MCP-SAMPLING-006] MCP Sampling Agenda Generation

- **Completed**: 2026-01-05
- **Duration**: 1 day
- **Summary**: Added MCP sampling for `get_agenda` to request agenda summaries via `sampling/createMessage`, validate JSON output, and fall back to deterministic agenda data; added integration coverage for sampling responses; updated Zod helpers and index-signature access to satisfy strict lint/type checks.
- **Files Changed**:
  - `packages/mcp-server/src/index.ts`
  - `apps/api/tests/integration/mcp.test.ts`
  - `apps/api/src/lib/auth.ts`
  - `packages/shared/src/validation/index.ts`
  - `packages/types/src/api/index.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Sampling responses should be parsed defensively and validated before returning to clients; fallbacks keep agendas reliable.
- **Retrospective**: Went well—SDK sampling integration was straightforward; improve—share MCP parsing helpers for tests; change—capture sampling prompt formats in specs if reused.
- **State Transitions**: PLANNING → RESEARCHING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING
- **Validation**: `pnpm typecheck` and `pnpm build` passed; `pnpm lint` failed on existing `apps/api` lint violations (441 errors) and `pnpm test` failed due to missing test files in `packages/shared` and `apps/web`.

### [MCP-001..004] MCP Server Spec Completion

- **Completed**: 2026-01-05
- **Summary**: Added MCP server package, completed required tools/prompts, resource templates, and updated MCP tests and non-spec listings.
- **Files Changed**:
  - `packages/mcp-server/package.json`
  - `packages/mcp-server/tsconfig.json`
  - `packages/mcp-server/src/index.ts`
  - `apps/api/src/services/mcp/server.ts`
  - `apps/api/src/routes/mcp.ts`
  - `apps/api/tests/integration/mcp.test.ts`
  - `apps/api/package.json`
- **Learnings**: Returning structured MCP tool payloads keeps response generation on the assistant.

### [MCP-TEST-002] MCP Resource Templates

- **Completed**: 2026-01-05
- **Summary**: Added MCP resource templates for entity URIs and expanded MCP tests for template listing and reads.
- **Files Changed**:
  - `apps/api/src/services/mcp/server.ts`
  - `apps/api/tests/integration/mcp.test.ts`
- **Learnings**: ResourceTemplate list callbacks allow dynamic resources to appear in resource listings.

### [TEST-UPDATE-001] MCP Test Coverage Refresh

- **Completed**: 2026-01-05
- **Summary**: Expanded MCP tests for additional resources, tool behaviors, and prompt edge cases.
- **Files Changed**:
  - `apps/api/tests/integration/mcp.test.ts`
- **Learnings**: MCP coverage benefits from asserting resource/tool discovery and basic side-effect calls.

### [INIT-001] Documentation

- **Completed**: 2026-01-04
- **Summary**: Created AGENTS.md with comprehensive autonomous workflow guidelines
- **Files Changed**:
  - `AGENTS.md` (created)
  - `CLAUDE.md` (symlink to AGENTS.md)
- **Learnings**: State machine approach provides clear workflow structure

### [INIT-002] Monorepo Scaffolding

- **Completed**: 2026-01-04
- **Summary**: Set up Turborepo with pnpm workspaces
- **Files Changed**:
  - `package.json`, `pnpm-workspace.yaml`, `turbo.json`
  - `apps/api/` - Hono backend
  - `apps/web/` - Next.js frontend
  - `packages/types/` - Shared TypeScript types
  - `packages/shared/` - Shared utilities
  - `packages/test-utils/` - Testing helpers
  - Root configs: `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- **Learnings**: Turborepo caching significantly speeds up builds

### [INIT-003] CI/CD Pipeline

- **Completed**: 2026-01-04
- **Summary**: GitHub Actions for CI and semantic-release
- **Files Changed**:
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `.github/dependabot.yml`
- **Learnings**: Semantic-release automates versioning from commits

### [AUTH-001] Authentication

- **Completed**: 2026-01-04
- **Summary**: Better Auth with OAuth (Google, Apple, Microsoft) and passkeys
- **Files Changed**:
  - `apps/api/src/lib/auth.ts` - Auth configuration
  - `apps/api/src/db/schema/auth.ts` - Auth schema (users, sessions, accounts, verifications, passkeys)
  - `apps/api/src/routes/auth.ts` - Auth routes
  - `apps/web/src/lib/auth-client.ts` - Client auth
  - `apps/web/src/components/auth/login-form.tsx`
  - `apps/web/src/components/auth/signup-form.tsx`
  - `apps/web/src/app/(auth)/login/page.tsx`
  - `apps/web/src/app/(auth)/signup/page.tsx`
  - `apps/web/src/app/dashboard/page.tsx`
- **Learnings**: Better Auth simplifies OAuth + passkey integration

---

## Backlog

### Phase 1: Core Platform (P0)

#### [API-001] Core REST Endpoints

- **Priority**: P0
- **Description**: CRUD endpoints for all domain entities with OpenAPI documentation
- **Dependencies**: DATA-001
- **Subtasks**:
  - Initiatives CRUD (list, get, create, update, delete)
  - Projects CRUD with initiative filtering
  - Tasks CRUD with project/assignee filtering
  - Events CRUD with participant management
  - Moments CRUD with time range queries
  - Activity streams and activities
  - Tags CRUD and task-tag associations
  - OpenAPI/Scalar documentation setup

#### [API-002] Input/Output Validation

- **Priority**: P0
- **Description**: Zod schemas for all API inputs and outputs
- **Dependencies**: API-001

#### [DB-001] Database Migrations

- **Priority**: P0
- **Description**: Drizzle migrations for schema deployment
- **Dependencies**: DATA-001

#### [TEST-001] API Unit Tests

- **Priority**: P0
- **Description**: Unit tests for all API endpoints (80% coverage)
- **Dependencies**: API-001

#### [TEST-002] Integration Tests

- **Priority**: P0
- **Description**: Integration tests with test database
- **Dependencies**: TEST-001

### Phase 2: Web Application (P1)

#### [WEB-001] Dashboard UI

- **Priority**: P1
- **Description**: Main dashboard with overview widgets
- **Dependencies**: API-001

#### [WEB-002] Task Management UI

- **Priority**: P1
- **Description**: Task list, detail view, creation, editing
- **Dependencies**: WEB-001

#### [WEB-003] Project Management UI

- **Priority**: P1
- **Description**: Project views with task organization
- **Dependencies**: WEB-002

#### [WEB-004] Initiative Management UI

- **Priority**: P1
- **Description**: Initiative hierarchy visualization and management
- **Dependencies**: WEB-003

#### [WEB-005] Calendar/Events UI

- **Priority**: P1
- **Description**: Event calendar with scheduling
- **Dependencies**: WEB-001

#### [WEB-006] Moments UI

- **Priority**: P1
- **Description**: Time tracking and moment visualization
- **Dependencies**: WEB-001

### Phase 3: MCP Integration (P1)

#### [MCP-001] MCP Server Foundation

- **Priority**: P1
- **Description**: Model Context Protocol server for AI agent integration
- **Dependencies**: API-001
- **Subtasks**:
  - Task operations (list, create, update, complete)
  - Project operations
  - Event operations
  - Context retrieval
  - Natural language command parsing

#### [MCP-002] MCP Client SDK

- **Priority**: P1
- **Description**: TypeScript SDK for MCP client implementations
- **Dependencies**: MCP-001

### Phase 4: Advanced Features (P2)

#### [SYNC-001] Real-time Updates

- **Priority**: P2
- **Description**: WebSocket or SSE for live data synchronization
- **Dependencies**: API-001

#### [NOTIF-001] Notification System

- **Priority**: P2
- **Description**: Push notifications for deadlines, reminders, updates
- **Dependencies**: WEB-001

#### [SEARCH-001] Full-text Search

- **Priority**: P2
- **Description**: Search across tasks, projects, events
- **Dependencies**: API-001

#### [REPORT-001] Analytics & Reporting

- **Priority**: P2
- **Description**: Productivity metrics, time tracking reports
- **Dependencies**: WEB-001

#### [INTEG-001] Calendar Integrations

- **Priority**: P2
- **Description**: Google Calendar, Apple Calendar sync
- **Dependencies**: WEB-005

#### [INTEG-002] Third-party Integrations

- **Priority**: P2
- **Description**: Slack, Discord, email integrations
- **Dependencies**: NOTIF-001

### Phase 5: Production Readiness (P2)

#### [PERF-001] Performance Optimization

- **Priority**: P2
- **Description**: Query optimization, caching, CDN
- **Dependencies**: All Phase 1-2

#### [SEC-001] Security Audit

- **Priority**: P2
- **Description**: Security review, penetration testing
- **Dependencies**: AUTH-001, API-001

#### [OPS-001] Production Infrastructure

- **Priority**: P2
- **Description**: Container orchestration, monitoring, logging
- **Dependencies**: All Phase 1-2

#### [DOC-001] User Documentation

- **Priority**: P2
- **Description**: User guides, API documentation, tutorials
- **Dependencies**: All Phase 1-2

---

## Notes

### Technology Stack

- **Backend**: Hono, Drizzle ORM, PostgreSQL, Better Auth
- **Frontend**: Next.js 15, React, shadcn/ui, Tailwind CSS
- **Testing**: Vitest
- **CI/CD**: GitHub Actions, semantic-release
- **Package Manager**: pnpm with Turborepo

### Key Decisions

1. **Better Auth over Auth.js**: Better passkey support, cleaner API
2. **Drizzle over Prisma**: Type inference, SQL-like syntax
3. **Hono over Express**: Better TypeScript support, middleware composition
4. **shadcn/ui over component libraries**: Full customization control

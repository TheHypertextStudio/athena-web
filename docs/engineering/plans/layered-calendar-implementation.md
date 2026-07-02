# Layered Calendar Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this roadmap task-by-task.
>
> **Goal:** Build provider-neutral layered calendar support with Google Calendar as the first
> two-way provider and Docket-native time blocks as first-class calendar items.
>
> **Architecture:** User-scoped layers/items store time objects; org-scoped task links bridge to
> tasks. Provider sync uses adapters and a write outbox. UI reads through the query layer and opens
> an item workspace for editing and task relationships.
>
> **Tech Stack:** Drizzle, Hono RPC, Zod DTOs, TanStack Query, Next.js, Vitest, Playwright.

---

## Phase 0 - Current-State Audit

- Re-read:
  - `packages/db/src/schema/calendar.ts`
  - `packages/types/src/calendar.ts`
  - `packages/types/src/agenda.ts`
  - `apps/api/src/routes/me-calendar.ts`
  - `apps/api/src/routes/agenda.ts`
  - `apps/api/src/routes/google-calendar-sync.ts`
  - `apps/web/src/components/agenda/*`
  - `apps/web/src/components/settings/google-calendar-settings.tsx`
- Confirm current Google OAuth scopes in `packages/auth/src/auth-builder.ts`.
- Run baseline focused checks:
  - `pnpm --filter @docket/types typecheck`
  - `pnpm --filter @docket/db typecheck`
  - `pnpm --filter @docket/api test -- tests/routes/calendar-agenda.test.ts`
  - `pnpm --filter @docket/web test -- tests/agenda`

Acceptance:

- Agent documents any drift from this roadmap before making schema changes.

## Phase 1 - Types And Schema

- Add branded ids as needed:
  - `CalendarLayerId`
  - `CalendarItemId`
  - `CalendarItemWriteId`
- Add DTOs in `packages/types/src/calendar.ts` or split into a focused calendar module if file size
  becomes unwieldy.
- Add Drizzle schema for:
  - `calendarLayer`
  - `calendarItem`
  - `calendarItemTaskLink`
  - `calendarItemWrite`
- Keep old `calendarList`/`calendarEvent` exports until all callers migrate.
- Generate and review migration:
  - `pnpm db:generate`
- Add migration/backfill SQL for existing calendar rows.

Tests:

- Add schema/type tests for DTO parsing.
- Add DB migration fixture test if the package has migration test conventions.

Acceptance:

- Existing calendar route tests still pass after compatibility serializers are updated.
- New schema supports native blocks, provider events, and task links.

Commit:

- `feat(calendar): add layered calendar schema and types`

## Phase 2 - Calendar Read Service And Compatibility Routes

- Create calendar service files:
  - `apps/api/src/calendar/calendar-read.ts`
  - `apps/api/src/calendar/calendar-serializers.ts`
  - `apps/api/src/calendar/calendar-permissions.ts`
- Implement range read:
  - filters by signed-in `userId`,
  - accepts time range and layer filters,
  - includes only visible linked task summaries,
  - handles all-day and timed items.
- Update `/v1/agenda` to read from the new service but preserve current `AgendaOut`.
- Update `/v1/me/calendar` settings read to include layer data while preserving existing shape until
  UI migration.

Tests:

- Extend `apps/api/tests/routes/calendar-agenda.test.ts`.
- Add tests for task-link permission filtering.
- Add all-day event range tests.

Acceptance:

- Current agenda behavior is unchanged.
- New range service can return provider events, native blocks, and task timeboxes.

Commit:

- `feat(calendar): read layered calendar items`

## Phase 3 - Native Blocks API

- Add routes:
  - `POST /v1/me/calendar/items`
  - `GET /v1/me/calendar/items`
  - `GET /v1/me/calendar/items/:id`
  - `PATCH /v1/me/calendar/items/:id`
  - `DELETE /v1/me/calendar/items/:id`
- Implement native-block create/update/delete first.
- Validate time bounds:
  - timed items require `startsAt` and `endsAt`,
  - all-day items require `allDayStartDate` and `allDayEndDate`,
  - end must be after start.
- Create default native layer lazily for the user when needed.

Tests:

- Native block CRUD.
- Ownership isolation.
- Invalid time bounds.
- Range query includes native block.

Acceptance:

- A user can create and edit a Docket-native focus/travel/DNS block without provider accounts.

Commit:

- `feat(calendar): add native calendar blocks`

## Phase 4 - Task Links And Event Workspace Data

- Implement `calendar-item-task-links` service.
- Add routes:
  - `POST /v1/me/calendar/items/:id/tasks`
  - `DELETE /v1/me/calendar/items/:id/tasks/:taskId`
- Supported POST modes:
  - link existing task by `organizationId` and `taskId`,
  - create task in an org/team and link it.
- Validate:
  - calendar item belongs to session user,
  - org actor exists,
  - task exists in the org,
  - caller can view/link/create as needed.
- Migrate `create-task` route to use `CalendarItemTaskLink` while optionally preserving existing
  attachment creation for backwards-compatible task detail display.

Tests:

- One item links to multiple tasks.
- One task links to multiple items.
- Cross-org task link is rejected.
- Hidden/private task does not appear in item detail for unauthorized viewer.

Acceptance:

- Event workspace data can render a task stack grouped by role.

Commit:

- `feat(calendar): link calendar items to tasks`

## Phase 5 - Provider Sync Engine

- Create provider-neutral sync engine:
  - `calendar-sync-engine.ts`
  - adapter contract,
  - lease handling,
  - result tally.
- Port current Google polling sync into `calendar-google-adapter.ts`.
- Store sync token per provider layer.
- Implement full sync, incremental sync, token invalidation reset, cancelled-event tombstones.
- Add `POST /v1/me/calendar/sync` against the new engine.

Tests:

- Full Google sync maps calendars to layers and events to items.
- Incremental sync updates/archives items.
- Invalid sync token triggers full layer resync.
- Existing manual sync route returns expanded tally.

Acceptance:

- Current Google Calendar sync behavior is preserved through the new engine.

Commit:

- `feat(calendar): introduce provider calendar sync engine`

## Phase 6 - Provider Write-Back

- Add `calendarItemWrite` outbox logic.
- Update Google auth/scope handling for calendar editing.
- Implement provider event core update:
  - title,
  - start/end/all-day,
  - location,
  - description.
- Implement permission resolver:
  - OAuth write scope,
  - layer access role,
  - event-level capability,
  - recurrence support.
- Implement conflict state when provider etag/update timestamp changed after local base.

Tests:

- Read-only scope returns write-scope-required problem.
- Successful provider patch stamps new etag/update anchors.
- Provider conflict stores conflict and preserves local intent.
- Retryable provider failure leaves pending outbox row.

Acceptance:

- Editable Google events can be edited in Docket and synced back to Google.

Commit:

- `feat(calendar): sync editable event changes back to providers`

## Phase 7 - Google Push Hints And Scheduled Reliability

- Add external webhook route:
  - `POST /v1/webhooks/calendar/google`
- Register/renew watches for selected Google layers.
- Validate channel token/resource id.
- Treat callback as sync hint only.
- Add scheduled sweep or extend existing cron to renew watches and run due syncs.

Tests:

- Webhook with invalid token rejected.
- Valid webhook schedules or triggers layer sync.
- Expired watch is renewed.
- Concurrent sync lease prevents duplicate runs.

Acceptance:

- Provider changes arrive faster via push hints while scheduled sync remains the reliability
  backstop.

Commit:

- `feat(calendar): handle Google Calendar sync notifications`

## Phase 8 - Web Data Layer

- Add query keys:
  - `calendarLayers`
  - `calendarItems`
  - `calendarItem`
- Add calendar data hooks/modules following `docs/engineering/specs/data-layer.md`.
- Implement optimistic mutation helpers for:
  - native block CRUD,
  - provider item update pending state,
  - layer visibility,
  - task link/detach.
- Avoid direct component fetches.

Tests:

- Query definitions unwrap problems.
- Mutations patch and roll back visible range cache.
- Invalidation covers item detail, range, agenda, and settings where needed.

Acceptance:

- Calendar UI can consume the new API without ad-hoc fetch/useEffect data paths.

Commit:

- `feat(web): add layered calendar data hooks`

## Phase 9 - Calendar UI And Workspace

- Refactor agenda normalizer for provider-neutral calendar items.
- Add layer-aware item card component.
- Add item workspace drawer.
- Add linked task stack with role groups.
- Add create/link/detach task flows.
- Add inline core edit form.
- Add drag/resize only when permissions allow.
- Expand Google Calendar settings with layers, scope state, sync health, and edit enablement.

Tests:

- Item cards render source/kind states.
- Read-only event controls disabled.
- Workspace shows multiple linked tasks.
- Create task from item links the task.
- Layer toggles preserve layout and cache.
- Settings shows write-scope status.

Acceptance:

- Users can work with provider events, native blocks, and task links from calendar views.

Commit:

- `feat(web): add layered calendar workspace`

## Phase 10 - E2E, Docs, And Rollout

- Add Playwright coverage:
  - Google account read-only flow,
  - layer visibility,
  - native block CRUD,
  - create multiple tasks from one event,
  - editable event write-back with mocked provider or local test provider,
  - conflict/read-only states.
- Update docs:
  - `docs/core/specs/layered-calendar.md`
  - `docs/engineering/specs/calendar-architecture.md`
  - `docs/engineering/specs/calendar-sync.md`
  - `docs/engineering/specs/calendar-ui.md`
- Update `docs/WORKLOG.md`.
- Run full gates:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
  - relevant `pnpm test:e2e`

Acceptance:

- The feature has typed API, durable sync, UI coverage, migration safety, and documented provider
  constraints.

Commit:

- `docs(calendar): document layered calendar rollout`

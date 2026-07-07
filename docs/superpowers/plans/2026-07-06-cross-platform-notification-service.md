# Cross-Platform Notification Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the cross-platform notification service described in `docs/superpowers/specs/2026-07-06-cross-platform-notification-service-design.md`, including REST APIs, durable notification intent/delivery state, web/email/SMS/push channel seams, inbound events, user preferences, contact points, staff announcement tooling, documentation, tests, and end-to-end verification milestones.

**Architecture:** Add a notification-service spine around the existing `notification` inbox table rather than replacing it first. `notification_intent` owns product truth, `notification_recipient` snapshots audience expansion, `notification_delivery` tracks per-channel attempts, and the current `notification` table remains the web-channel projection. The API layer exposes user inbox/preference/contact-point routes under `/v1/me`, trusted intent routes under `/v1/notifications`, staff operational routes under `/admin/notifications`, and provider callbacks under `/internal/notifications/*`.

**Tech Stack:** Hono, Drizzle/Postgres/PGlite migrations, the new `@docket/notifications` domain package for notification schemas/policy/dispatcher code, existing `@docket/types` shared primitives, existing `@docket/boundaries` `Mailer` port, Vitest route/service tests, TanStack Query web clients, existing admin/web app shells, pnpm/turbo validation.

---

## Baseline Evidence

- `pnpm install` completed in the feature worktree and installed native git guardrails.
- `pnpm typecheck` passed: 12/12 turbo typecheck tasks successful from cache.
- `pnpm --filter @docket/api test tests/routes/notifications-inbox.test.ts` passed: 17/17 tests.

## File Structure

### Database and Notification Domain Package

- Modify `packages/db/src/enums.ts`
  - Add notification-service enums: sender type, category, priority, intent status, channel, delivery destination type, delivery status, recipient reason, suppression reason, contact point type/status, inbound event kind, reply policy.
- Modify `packages/db/src/types.ts`
  - Add JSON shapes for `NotificationAudience`, `NotificationContent`, `NotificationQuietHours`, `NotificationChannelPreference`, `NotificationSuppression`, and provider payload metadata.
- Modify `packages/db/src/schema/crosscutting.ts`
  - Add `notificationIntent`, `notificationRecipient`, `notificationDelivery`, `notificationPreference`, `contactPoint`, and `notificationInboundEvent`.
  - Add nullable `intentId` / `deliveryId` references to the existing `notification` web projection only if the generated migration is non-destructive.
- Generate migration under `packages/db/drizzle/`.
- Create `packages/notifications`
  - Own the notification domain surface: public schemas first, then policy, audience, preference, dispatcher, and channel adapter helpers as later milestones land.
  - Keep package-level exports small. Focused modules under `src/schemas/` own intents, recipients, deliveries, preferences, contact points, inbound events, route bodies, route queries, and route responses.
- Modify `packages/types/src/notification.ts`
  - Keep current inbox DTOs working; add service-announcement-compatible notification type if the schema needs it.

### API Service Layer

- Create `apps/api/src/services/notifications/policy.ts`
  - Category/channel rules, sender authorization checks, locked preference rules, broad-send approval thresholds, test-send constraints.
- Create `apps/api/src/services/notifications/audience.ts`
  - Expand explicit user, users, organization, all users, and staff segments into immutable recipient inputs.
- Create `apps/api/src/services/notifications/preferences.ts`
  - Resolve user preferences, quiet-hours behavior, contact-point availability, and suppression reasons.
- Create `apps/api/src/services/notifications/dispatcher.ts`
  - Create intent/recipient/delivery rows, fan out channels, call adapters, update statuses, enforce idempotency.
- Create `apps/api/src/services/notifications/adapters/web.ts`
  - Write current `notification` inbox rows as the web-channel projection.
- Create `apps/api/src/services/notifications/adapters/email.ts`
  - Use `getContainer().mailer` / `Mailer` to send email deliveries.
- Create `apps/api/src/services/notifications/adapters/sms.ts`
  - Implement provider seam and deterministic mock/capture behavior; local/test runs must not require live SMS credentials.
- Create `apps/api/src/services/notifications/adapters/push.ts`
  - Implement provider seam and invalid-token handling so mobile clients can attach without a model change.
- Create `apps/api/src/services/notifications/inbound.ts`
  - Normalize provider callbacks/replies into inbound events and apply delivery/contact-point state changes.

### API Routes

- Modify `apps/api/src/app.ts`
  - Mount `/v1/me/notifications`, `/v1/me/notification-preferences`, `/v1/me/contact-points`, and intent routes without breaking existing `/v1/notifications`.
- Create `apps/api/src/routes/me-notifications.ts`
  - Alias/evolve user inbox routes under `/v1/me/notifications`.
- Create `apps/api/src/routes/notification-preferences.ts`
  - GET/PATCH user preferences.
- Create `apps/api/src/routes/contact-points.ts`
  - GET/POST/verify/make-primary/DELETE contact points.
- Create `apps/api/src/routes/notification-intents.ts`
  - POST create, GET intent, GET recipients, GET deliveries, POST send, POST cancel, POST test.
- Modify `apps/api/src/routes/admin.ts`
  - Mount staff notification operations.
- Create `apps/api/src/routes/admin-notifications.ts`
  - List, detail, approve, reject, audit, inbound-events for staff.
- Modify `apps/api/src/server.ts`
  - Mount `/internal/notifications/events/*` and `/internal/notifications/inbound/*` provider callbacks outside public RPC.
- Create `apps/api/src/routes/internal-notifications.ts`
  - Signature-gated provider callback and inbound reply endpoints.

### Web and Admin UX

- Modify `apps/web/src/app/(app)/inbox/*`
  - Add Slack-like views: All, Unread, Needs action, Mentions and assignments, Announcements.
  - Preserve existing inbox behavior while reading richer DTOs when present.
- Create `apps/web/src/app/(app)/settings/notifications/page.tsx`
  - User-facing preferences grouped by human questions, with advanced category/channel matrix.
- Create `apps/web/src/components/settings/notification-preferences-section.tsx`
  - Category/channel controls, quiet hours, locked-category explanations.
- Create `apps/web/src/components/settings/contact-points-section.tsx`
  - Email/phone/push destination list, verification state, primary destination, disabled/bounced states.
- Modify `apps/admin/src/*`
  - Add service announcement console: compose, audience estimate, channel selection, preview, test send, approval, schedule/cancel, monitoring, inbound replies.

### Tests

- Create `apps/api/tests/services/notifications/policy.test.ts`
- Create `apps/api/tests/services/notifications/audience.test.ts`
- Create `apps/api/tests/services/notifications/preferences.test.ts`
- Create `apps/api/tests/services/notifications/dispatcher-web.test.ts`
- Create `apps/api/tests/services/notifications/dispatcher-email.test.ts`
- Create `apps/api/tests/services/notifications/inbound.test.ts`
- Create `apps/api/tests/routes/notification-intents.test.ts`
- Create `apps/api/tests/routes/me-notifications.test.ts`
- Create `apps/api/tests/routes/notification-preferences.test.ts`
- Create `apps/api/tests/routes/contact-points.test.ts`
- Create `apps/api/tests/routes/admin-notifications.test.ts`
- Create `apps/api/tests/routes/internal-notifications.test.ts`
- Create or extend web/admin component tests for inbox tabs, preference editing, contact points, and staff announcement flow.
- Add E2E smoke coverage for a staff service announcement that creates a web notification and sends/captures an email.

---

## Task 1: Schema and Shared DTO Spine

**Files:**

- Modify: `packages/db/src/enums.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/schema/crosscutting.ts`
- Create: `packages/notifications`
- Create: `packages/notifications/src/schemas/*`
- Generate: `packages/db/drizzle/0023_*.sql`
- Test: `packages/notifications` typecheck/lint/test
- Test: `packages/types` typecheck/lint/test after removing notification-domain drift
- Test: `packages/db` typecheck

- [x] **Step 1: Write type-level DTO tests by compiling desired imports**

Create DTO exports before runtime use by writing a typecheck-targeted test file, then run typecheck and confirm missing exports.

Expected initial failure:

```text
Module '"../src"' has no exported member 'NotificationIntentCreate'
```

- [x] **Step 2: Add notification schemas in `packages/notifications/src/schemas/*`**

Define Zod schemas for:

- `NotificationChannel`
- `NotificationCategory`
- `NotificationPriority`
- `NotificationSenderType`
- `NotificationIntentStatus`
- `NotificationAudience`
- `NotificationIntentCreate`
- `NotificationIntentOut`
- `NotificationRecipientOut`
- `NotificationDeliveryOut`
- `NotificationPreferenceOut`
- `NotificationPreferencePatch`
- `ContactPointOut`
- `ContactPointCreate`
- `ContactPointVerify`
- `NotificationInboundEventOut`

The initial create body must support:

```json
{
  "senderType": "system",
  "category": "service_announcement",
  "priority": "normal",
  "audience": { "type": "user", "userId": "usr_123" },
  "channels": ["web", "email"],
  "subject": "Scheduled maintenance",
  "body": { "text": "Maintenance tonight.", "html": "<p>Maintenance tonight.</p>" },
  "replyPolicy": "none",
  "idempotencyKey": "maint-1"
}
```

- [x] **Step 3: Add database enums and JSON shapes**

Add enum values that directly match the DTO literals so Drizzle row types align with Zod outputs.

- [x] **Step 4: Add database tables**

Add the new notification service tables in `crosscutting.ts`. Keep existing `notification` unchanged in this task except for nullable intent/delivery linkage only if Drizzle can generate a clean migration.

- [x] **Step 5: Generate and inspect migration**

Run:

```bash
pnpm db:generate
```

Expected: one new migration file and updated Drizzle metadata. Inspect the SQL for destructive operations. No existing notification rows should be dropped or rewritten.

- [x] **Step 6: Verify**

Run:

```bash
pnpm --filter @docket/types typecheck
pnpm --filter @docket/notifications typecheck
pnpm --filter @docket/notifications lint
pnpm --filter @docket/notifications test
pnpm --filter @docket/db typecheck
pnpm --filter @docket/api test tests/routes/notifications-inbox.test.ts
```

- [x] **Step 7: Document and commit**

Update `docs/WORKLOG.md` under `[NOTIF-SPEC-001]` with the schema milestone. Commit:

```bash
git add packages/notifications packages/types packages/db docs/WORKLOG.md
git commit -m "feat(data): add notification service spine"
```

---

## Task 2: Web-First Dispatcher and Policy Service

**Files:**

- Create: `packages/notifications/src/policy/*`
- Create: `apps/api/src/services/notifications/audience.ts`
- Create: `apps/api/src/services/notifications/preferences.ts`
- Create: `apps/api/src/services/notifications/dispatcher.ts`
- Create: `apps/api/src/services/notifications/adapters/web.ts`
- Test: `apps/api/tests/services/notifications/policy.test.ts`
- Test: `apps/api/tests/services/notifications/audience.test.ts`
- Test: `apps/api/tests/services/notifications/preferences.test.ts`
- Test: `apps/api/tests/services/notifications/dispatcher-web.test.ts`

- [x] **Step 1: Write RED policy tests**

Cover:

- `all_users` is staff-only.
- `security` and `account` are system/staff-only.
- SMS for multiple users requires staff approval.
- Marketing never rides service-announcement consent.
- Web channel is allowed for every non-marketing category.

- [x] **Step 2: Implement policy**

Implement pure functions:

```ts
canCreateNotification(input): PolicyDecision
categoryAllowsChannel(category, channel): boolean
requiresApproval(input): ApprovalRequirement
lockedPreference(category): boolean
```

- [x] **Step 3: Write RED audience tests**

Cover explicit user, users, organization active members, all users, and billing-admin segment expansion.

- [x] **Step 4: Implement audience resolver**

Resolve against Drizzle queries and return immutable recipient inputs with `reason`.

- [x] **Step 5: Write RED preference tests**

Cover default web/email behavior, quiet-hours delay, no verified contact point, bounced contact point, locked security category, and explicit user opt-out.

- [x] **Step 6: Implement preference resolver**

Return channel decisions with explicit suppression reasons. Do not call providers here.

- [x] **Step 7: Write RED dispatcher web tests**

Create a system service announcement to one user with `channels: ["web"]`; assert:

- one intent row,
- one recipient row,
- one web delivery row,
- one existing `notification` inbox row,
- unread count increments,
- idempotency key prevents duplicate sends.

- [x] **Step 8: Implement dispatcher and web adapter**

Dispatcher coordinates policy, audience, preference, delivery rows, and web adapter. Web adapter writes existing `notification` projection.

- [x] **Step 9: Verify and commit**

Run:

```bash
pnpm --filter @docket/api test tests/services/notifications
pnpm --filter @docket/api test tests/routes/notifications-inbox.test.ts
pnpm typecheck
```

Additional focused gates run for the committed slice:

```bash
pnpm --filter @docket/notifications test
pnpm --filter @docket/db test tests/notification-service-schema.test.ts
pnpm lint
pnpm --filter @docket/api build
```

Broad-gate note: `pnpm test` was stopped after 11m39s with only `@docket/api:test` still running
(101 API test files, many PGlite-backed); `pnpm build` was stopped in the unrelated web Next.js
build tail after API/admin had completed. Those broad gates are not recorded as green for this slice.

Commit:

```bash
git add apps/api docs/WORKLOG.md
git commit -m "feat(api): add web notification dispatcher"
```

---

## Task 3: Public REST Intent and User Inbox Routes

**Files:**

- Create: `apps/api/src/routes/notification-intents.ts`
- Create: `apps/api/src/routes/me-notifications.ts`
- Modify: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/routes/notification-intents.test.ts`
- Test: `apps/api/tests/routes/me-notifications.test.ts`

- [x] **Step 1: Write RED route tests for `/v1/notifications` intent endpoints**

Cover create draft, create-and-send, get intent, recipients, deliveries, cancel queued intent, and test send authorization.

- [x] **Step 2: Implement intent routes**

Mount:

```http
POST /v1/notifications
GET  /v1/notifications/:id
GET  /v1/notifications/:id/recipients
GET  /v1/notifications/:id/deliveries
POST /v1/notifications/:id/send
POST /v1/notifications/:id/cancel
POST /v1/notifications/:id/test
```

- [x] **Step 3: Write RED route tests for `/v1/me/notifications`**

Cover aliases for list/count/read/read-all/act plus detail by id. Existing `/v1/notifications` inbox behavior must still pass for compatibility.

- [x] **Step 4: Implement `/v1/me/notifications` routes**

Reuse the existing inbox query/mutation helpers instead of duplicating owner-isolation logic.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @docket/api test tests/routes/notification-intents.test.ts tests/routes/me-notifications.test.ts tests/routes/notifications-inbox.test.ts
pnpm typecheck
```

Commit:

```bash
git add apps/api packages/notifications docs/WORKLOG.md
git commit -m "feat(api): expose notification intent routes"
```

---

## Task 4: Preferences and Contact Points

**Files:**

- Create: `apps/api/src/routes/notification-preferences.ts`
- Create: `apps/api/src/routes/contact-points.ts`
- Create: `apps/api/src/services/notifications/preference-service.ts`
- Create: `apps/api/src/services/notifications/contact-point-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/notifications/src/schemas/contact-point.ts`
- Test: `apps/api/tests/routes/notification-preferences.test.ts`
- Test: `apps/api/tests/routes/contact-points.test.ts`

- [x] **Step 1: Write RED preference route tests**

Cover default preferences, patch category/channel values, locked security explanation, quiet-hours update, and org-scoped workflow override.

- [x] **Step 2: Implement preference routes**

Mount:

```http
GET   /v1/me/notification-preferences
PATCH /v1/me/notification-preferences
```

- [x] **Step 3: Write RED contact-point route tests**

Cover primary account email projection, phone creation pending verification, wrong code rejection, verify success, make-primary, delete/disable, bounced state suppressing delivery.

- [x] **Step 4: Implement contact-point routes**

Mount:

```http
GET    /v1/me/contact-points
POST   /v1/me/contact-points
POST   /v1/me/contact-points/:id/verify
POST   /v1/me/contact-points/:id/make-primary
DELETE /v1/me/contact-points/:id
```

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @docket/api test tests/routes/notification-preferences.test.ts tests/routes/contact-points.test.ts
pnpm --filter @docket/api test tests/services/notifications/preferences.test.ts
pnpm typecheck
```

Commit:

```bash
git add apps/api packages/notifications packages/db docs/WORKLOG.md
git commit -m "feat(api): add notification preferences and contact points"
```

---

## Task 5: Email Channel and Existing Email Flow Migration

**Files:**

- Create: `apps/api/src/services/notifications/adapters/email.ts`
- Modify: `apps/api/src/account/emails.ts`
- Modify: `apps/api/src/account/export.ts`
- Modify: `apps/api/src/routes/me-account.ts`
- Modify: `apps/api/src/routes/me-recovery.ts`
- Modify: `apps/api/src/routes/daily-digest.ts`
- Modify: `packages/auth/src/emails.ts` only where Better Auth still owns send timing
- Test: `apps/api/tests/services/notifications/dispatcher-email.test.ts`
- Extend: account/export/recovery/daily-digest route tests

- [x] **Step 1: Write RED email dispatcher tests**

Assert email delivery uses `CaptureMailer` in tests, records delivery state, suppresses bounced/no-email contact points, and does not mark web notification read when mail is delivered.

- [x] **Step 2: Implement email adapter**

Use `getContainer().mailer.send({ to, subject, html, text })`. Update delivery status to `sent` after adapter success and `failed` with secret-free errors after adapter failure.

- [x] **Step 3: Move account/security/export/digest sends through notification intents**

For each flow, preserve existing user-facing email body while adding intent/delivery records. Better Auth-internal flows may keep the direct mail send but should record notification intent/delivery state when the product can observe the event safely.

Progress: recovery-code regeneration now dispatches a `security` notification intent through web
and email while preserving the existing recovery-code email body. Account deletion/cancel,
export-ready, and daily digest sends now dispatch notification intents and delivery rows while
preserving their existing email bodies. Digest uses `skip_user_preferences` because the digest sweep
already selects only users who opted into the digest feature.

- [x] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @docket/api test tests/services/notifications/dispatcher-email.test.ts tests/routes/me-account.test.ts tests/routes/me-recovery.test.ts tests/routes/daily-digest.test.ts
pnpm --filter @docket/auth test
pnpm typecheck
```

Commit:

```bash
git add apps/api packages/auth docs/WORKLOG.md
git commit -m "feat(api): route transactional email through notifications"
```

Verified in the final focused API bundle:

```bash
cd apps/api
../../node_modules/.bin/vitest run tests/services/notifications/dispatcher-email.test.ts tests/routes/me-account.test.ts tests/routes/me-recovery.test.ts tests/routes/daily-digest.test.ts tests/services/notifications/inbound.test.ts tests/routes/internal-notifications.test.ts tests/services/notifications/dispatcher-sms-push.test.ts tests/routes/notification-service-smoke.test.ts
```

Result: 8 files and 41 tests passed.

---

## Task 6: Inbound Events and Provider Callback Surface

**Files:**

- Create: `apps/api/src/services/notifications/inbound.ts`
- Create: `apps/api/src/routes/internal-notifications.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/tests/services/notifications/inbound.test.ts`
- Test: `apps/api/tests/routes/internal-notifications.test.ts`

- [x] **Step 1: Write RED inbound normalization tests**

Cover email delivered/bounced/complained/clicked/opened, SMS delivered/failed/replied/STOP/START/HELP, push invalid-token, and unknown correlation tokens.

- [x] **Step 2: Implement inbound service**

Normalize provider payloads, record `notification_inbound_event`, update delivery status, update contact-point state, and attach replies to original notification when correlation exists.

- [x] **Step 3: Write RED internal route tests**

Cover signature missing rejection, signature accepted path, public `/v1` exclusion, and idempotent duplicate provider event handling.

- [x] **Step 4: Implement internal callback routes**

Mount:

```http
POST /internal/notifications/events/email
POST /internal/notifications/events/sms
POST /internal/notifications/events/push
POST /internal/notifications/inbound/email
POST /internal/notifications/inbound/sms
```

Implemented with HMAC-signed internal routes mounted outside `/v1`. Provider retry idempotency is
handled by normalized `providerEventId` stored in the inbound-event payload; add a dedicated DB
column/unique index later if concurrent duplicate callbacks become a real provider concern.

- [x] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @docket/api test tests/services/notifications/inbound.test.ts tests/routes/internal-notifications.test.ts
pnpm typecheck
```

Commit:

```bash
git add apps/api packages/notifications docs/WORKLOG.md
git commit -m "feat(api): ingest notification provider events"
```

Verified in the final focused API bundle above: inbound service and internal notification route
coverage passed with the email/SMS/push dispatcher and route smoke suites.

---

## Task 7: Staff Service Announcement Admin API

**Files:**

- Create: `apps/api/src/routes/admin-notifications.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/tests/routes/admin-notifications.test.ts`

- [x] **Step 1: Write RED admin API tests**

Cover draft list/detail, audience estimate, preview/test send, approval required for broad or urgent sends, approve/reject, schedule, cancel, delivery monitoring, audit, and inbound event listing.

- [x] **Step 2: Implement staff routes**

Expose:

```http
GET  /admin/notifications
GET  /admin/notifications/:id
GET  /admin/notifications/:id/estimate
GET  /admin/notifications/:id/preview
POST /admin/notifications/:id/approve
POST /admin/notifications/:id/reject
GET  /admin/notifications/:id/audit
GET  /admin/notifications/:id/inbound-events
```

Use existing staff middleware and operator audit event patterns.

Implemented as a sub-router mounted from `admin.ts` with direct `NotificationIntentService` and
database injection. Approve queues draft/scheduled intents and reject cancels not-yet-delivered
intents with operator audit. A richer approval-required workflow still needs durable approval state
columns before it can be represented honestly.

Follow-up implementation added `estimate` and `preview` endpoints backed by the existing audience
resolver, preference resolver, and policy helpers. Estimates report recipient counts, per-channel
send/delay/suppression counts, suppression reasons, and the current approval gate; previews render
the requested web/email/SMS/push channel content for the staff console.

- [x] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @docket/api test tests/routes/admin-notifications.test.ts tests/routes/admin.test.ts
pnpm typecheck
```

Commit:

```bash
git add apps/api packages/notifications docs/WORKLOG.md
git commit -m "feat(admin): add notification announcement API"
```

---

## Task 8: SMS and Push Channel Seams

**Files:**

- Create: `packages/boundaries/src/ports/sms.ts`
- Create: `packages/boundaries/src/mock/sms.ts`
- Create: `packages/boundaries/src/real/sms.ts`
- Create: `packages/boundaries/src/ports/push.ts`
- Create: `packages/boundaries/src/mock/push.ts`
- Create: `packages/boundaries/src/real/push.ts`
- Modify: `packages/boundaries/src/select.ts`
- Modify: `apps/api/src/services/notifications/adapters/sms.ts`
- Modify: `apps/api/src/services/notifications/adapters/push.ts`
- Test: `packages/boundaries/tests/mock/mock.test.ts`
- Test: `packages/boundaries/tests/real/real.test.ts`
- Test: `apps/api/tests/services/notifications/dispatcher-sms-push.test.ts`

- [x] **Step 1: Write RED boundary tests**

Assert mock SMS/push capture sends deterministically, real adapters reject missing credentials safely, invalid push tokens surface structured failures, and SMS STOP state suppresses future sends.

- [x] **Step 2: Add boundary ports and mocks**

Implement deterministic capture adapters analogous to `CaptureMailer`.

- [x] **Step 3: Add API channel adapters**

Wire SMS/push delivery creation to the boundary ports. Keep live provider credentials optional; tests must run with capture adapters.

- [x] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @docket/boundaries test
pnpm --filter @docket/api test tests/services/notifications/dispatcher-sms-push.test.ts
pnpm typecheck
```

Commit:

```bash
git add packages/boundaries apps/api packages/env docs/WORKLOG.md
git commit -m "feat(integrations): add notification sms and push ports"
```

Final focused verification:

```bash
cd packages/env && ../../node_modules/.bin/vitest run
cd packages/boundaries && ../../node_modules/.bin/vitest run
cd packages/notifications && ../../node_modules/.bin/vitest run
cd apps/api && ../../node_modules/.bin/vitest run tests/services/notifications/dispatcher-email.test.ts tests/routes/me-account.test.ts tests/routes/me-recovery.test.ts tests/routes/daily-digest.test.ts tests/services/notifications/inbound.test.ts tests/routes/internal-notifications.test.ts tests/services/notifications/dispatcher-sms-push.test.ts tests/routes/notification-service-smoke.test.ts
```

Results: `@docket/env` 41 tests, `@docket/boundaries` 391 tests, `@docket/notifications` 18 tests,
and the focused API bundle 41 tests passed. Env string cleanup is centralized in
`@docket/env.realEnvValue`; no `cleanEnvString` helper or definition remains under source files.

---

## Task 9: User-Facing Web UX

**Files:**

- Modify: `apps/web/src/app/(app)/inbox/*`
- Create: `apps/web/src/app/(app)/settings/notifications/page.tsx`
- Create: `apps/web/src/components/settings/notification-preferences-section.tsx`
- Create: `apps/web/src/components/settings/contact-points-section.tsx`
- Modify: `apps/web/src/lib/query-keys.ts`
- Modify: `apps/web/src/lib/query.ts` only if new typed query helpers are needed
- Test: `apps/web/tests/components/inbox/*.test.tsx`
- Test: `apps/web/tests/components/settings/notification-preferences-section.test.tsx`
- Test: `apps/web/tests/components/settings/contact-points-section.test.tsx`

- [x] **Step 1: Write RED component tests**

Cover Slack-like inbox tabs, "Also emailed" delivery hints, needs-action grouping, locked security preference explanation, quiet-hours editing, phone verification state, bounced/unsubscribed contact point state.

- [x] **Step 2: Implement inbox UX**

Use the typed TanStack Query layer. Do not hand-roll `useEffect` fetches.

- [x] **Step 3: Implement settings UX**

Group preferences by human questions first, with an advanced category/channel matrix beneath.

- [x] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @docket/web test
pnpm --filter @docket/web typecheck
pnpm --filter @docket/web lint
```

Commit:

```bash
git add apps/web docs/WORKLOG.md
git commit -m "feat(web): add notification preferences experience"
```

Final focused verification:

```bash
cd apps/web
../../node_modules/.bin/vitest run tests/components/inbox/inbox-client.test.tsx tests/components/settings/notification-preferences-section.test.tsx tests/components/settings/contact-points-section.test.tsx
```

Result: 3 files and 6 tests passed.

---

## Task 10: Staff Announcement Console UX

**Files:**

- Modify/Create: `apps/admin/src/*`
- Test: admin component tests matching existing test structure

- [x] **Step 1: Write RED admin UX tests**

Cover compose, audience estimate, channel selection, preview, test send, approval, schedule/cancel, monitoring, and inbound replies.

- [x] **Step 2: Implement staff console**

Build the six-step flow from the spec:

1. Compose.
2. Audience.
3. Channels.
4. Preview.
5. Review.
6. Monitor.

Implemented as `/notifications` in `apps/admin`, with a presentational console plus a typed page
that calls `/v1/notifications` for draft/test/send/cancel and `/admin/notifications/*` for list,
estimate, preview, approve, audit, and inbound monitoring.

- [x] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @docket/admin test
pnpm --filter @docket/admin typecheck
pnpm --filter @docket/admin lint
```

Commit:

```bash
git add apps/admin docs/WORKLOG.md
git commit -m "feat(admin): add service announcement console"
```

Final focused verification:

```bash
cd apps/admin
../../node_modules/.bin/vitest run tests/notification-console.test.tsx
```

Result: 1 file and 2 tests passed.

---

## Task 11: End-to-End and Documentation Milestone

**Files:**

- Create: `apps/api/tests/routes/notification-service-smoke.test.ts`
- Modify: `docs/engineering/deployment.md`
- Create: `docs/engineering/specs/notification-service.md`
- Modify: `.env.example`
- Modify: `scripts/integration-providers.ts` only after reconciling the unrelated primary-checkout change

- [x] **Step 1: Add route-level service smoke**

Cover staff creates service announcement, sends test, approves, sends to a test user, user sees web notification, and capture mailer records email.

Implemented as a route-level API smoke because the capture mailer is process-local; this avoids
adding a dev-only mailbox endpoint solely for Playwright while still covering the staff, recipient,
web inbox, and email capture contract end to end.

- [x] **Step 2: Document operational setup**

Document SMTP, SMS provider seam, push provider seam, inbound webhook routes, quiet-hours behavior, and support/audit workflow.

- [x] **Step 3: Run meaningful milestone gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

If `pnpm test:e2e` requires a running dev stack, start the documented local dev stack and record the exact URLs/commands used in `docs/WORKLOG.md`.

Focused route smoke/admin validation, API typecheck, and touched-file ESLint passed on 2026-07-07.
The staff-announcement email assertion remains route-level because the capture mailer is
process-local, but the user-facing notification browser milestone is now covered by a real
Playwright flow against an isolated branch dev stack:

```bash
pnpm exec dotenv -e .env.local -v APP_MODE=local -v DATABASE_URL=pglite://.data/docket-e2e-notifications-1783402329 -v DATABASE_URL_UNPOOLED=pglite://.data/docket-e2e-notifications-1783402329 -v API_URL=http://localhost:4100 -v WEB_URL=http://localhost:3100 -v BETTER_AUTH_URL=http://localhost:4100 -v BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3100,http://localhost:4100 -v BETTER_AUTH_ALLOWED_HOSTS=localhost -v BETTER_AUTH_PASSKEY_RP_ID=localhost -v NEXT_PUBLIC_API_URL=http://localhost:4100 -v NEXT_PUBLIC_APP_URL=http://localhost:3100 -- pnpm --filter @docket/db db:migrate
pnpm exec dotenv -e .env.local -v APP_MODE=local -v DATABASE_URL=pglite://.data/docket-e2e-notifications-1783402329 -v DATABASE_URL_UNPOOLED=pglite://.data/docket-e2e-notifications-1783402329 -v API_URL=http://localhost:4100 -v WEB_URL=http://localhost:3100 -v PORT=4100 -v BETTER_AUTH_URL=http://localhost:4100 -v BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3100,http://localhost:4100 -v BETTER_AUTH_ALLOWED_HOSTS=localhost -v BETTER_AUTH_PASSKEY_RP_ID=localhost -v NEXT_PUBLIC_API_URL=http://localhost:4100 -v NEXT_PUBLIC_APP_URL=http://localhost:3100 -- pnpm --filter @docket/api start
pnpm exec dotenv -e .env.local -v APP_MODE=local -v DATABASE_URL=pglite://.data/docket-e2e-notifications-1783402329 -v DATABASE_URL_UNPOOLED=pglite://.data/docket-e2e-notifications-1783402329 -v API_URL=http://localhost:4100 -v WEB_URL=http://localhost:3100 -v PORT=3100 -v BETTER_AUTH_URL=http://localhost:4100 -v BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3100,http://localhost:4100 -v BETTER_AUTH_ALLOWED_HOSTS=localhost -v BETTER_AUTH_PASSKEY_RP_ID=localhost -v NEXT_PUBLIC_API_URL=http://localhost:4100 -v NEXT_PUBLIC_APP_URL=http://localhost:3100 -- pnpm --dir apps/web exec next dev --hostname localhost --port 3100
APP_URL=http://localhost:3100 API_URL=http://localhost:4100 PASSKEY_RP_ID=localhost pnpm --dir apps/web test:e2e sign-in.spec.ts
APP_URL=http://localhost:3100 API_URL=http://localhost:4100 PASSKEY_RP_ID=localhost pnpm --dir apps/web test:e2e notifications.spec.ts
pnpm --dir apps/web exec tsc -p e2e/tsconfig.json --noEmit
pnpm --filter @docket/web lint
pnpm exec prettier --check apps/web/e2e/notifications.spec.ts
```

Results: migration passed, API served on `http://localhost:4100`, web served on
`http://localhost:3100`, sign-in E2E passed 1/1 in 1.7m, notification settings/contact-point E2E
passed 1/1 after selector tightening, E2E TypeScript passed, web lint passed, and Prettier check
passed.

Additional full-gate progress on 2026-07-07:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Results: `pnpm typecheck` passed with 13 successful tasks, `pnpm lint` passed with 13 successful
tasks, and the final `pnpm test` rerun passed with 13 successful tasks. The first root test run found
a timing-sensitive web sign-in component test under full Turbo concurrency; the test was hardened to
wait for the component's actual session-recovery retry contract, then verified with the failing file,
the full web package suite, web typecheck/lint, and the root test rerun. The focused notification
browser E2E gate now passes against the isolated branch stack.

- [x] **Step 4: Commit docs and E2E**

Commit:

```bash
git add apps/web/e2e/notifications.spec.ts docs/WORKLOG.md docs/superpowers/plans/2026-07-06-cross-platform-notification-service.md
git commit -m "test(web): cover notification settings e2e"
```

---

## Completion Audit

Before declaring the objective complete, verify each item against current state:

- [ ] Spec concepts exist in data model: intent, recipient snapshot, delivery, contact point, preferences, inbound event.
- [ ] REST API surface exists and is tested: `/v1/me/notifications`, `/v1/me/notification-preferences`, `/v1/me/contact-points`, `/v1/notifications`, `/admin/notifications`, `/internal/notifications/*`.
- [ ] Web channel preserves existing inbox behavior and adds intent/delivery linkage.
- [ ] Email channel uses `Mailer` and records delivery state.
- [ ] SMS and push have tested ports/adapters and contact-point behavior, even if live provider credentials are absent.
- [ ] Incoming provider events and user replies normalize into inbound events and update delivery/contact state.
- [ ] Staff announcement UX supports compose, audience, channels, preview, review, monitor.
- [ ] User UX supports Slack-like inbox tabs, preferences, quiet hours, and contact points.
- [ ] Docs explain behavior, setup, and operations.
- [ ] Full typecheck, lint, unit/integration tests, and E2E gates pass with command output recorded.
- [ ] `git rev-list --merges --count origin/main..HEAD` returns `0`.

# Notification Service

> **Status**: Implemented for web, email, SMS seam, push seam, staff announcements, preferences,
> contact points, and inbound provider events.
> **Last Updated**: 2026-07-07
> **Owners**: Platform

The notification service is the cross-platform surface for operational and product notifications.
It is not a mailer wrapper: every send starts as a durable intent, expands to immutable recipients,
resolves user preferences/contact points, records per-channel delivery rows, and projects web
delivery into the existing Hub inbox.

## Core Behavior

1. A caller creates a `notification_intent` with sender, category, audience, channels, subject,
   body, and reply policy.
2. Sending snapshots the audience into `notification_recipient` rows. Later audience membership
   changes do not rewrite a sent notification.
3. Each recipient/channel decision becomes a `notification_delivery` row with destination metadata,
   status, provider ids, and error details.
4. Web delivery writes one `notification` inbox row. Email, SMS, and push are sibling delivery rows
   that can be shown as delivery hints beside that web row.
5. User preferences, quiet hours, contact-point status, bounces, unsubscribes, and invalid push
   tokens affect external channels before the adapter runs.
6. Provider callbacks and replies land as `notification_inbound_event` rows and update delivery or
   contact-point health when the event is actionable.

Approval is separate from send. Staff approval moves a draft/scheduled intent to `queued`; the
explicit send call performs recipient snapshotting and delivery attempts.

## Data Model

| Table                        | Purpose                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `notification_intent`        | Staff/system/org-authored intent, lifecycle status, content, audience, channels.   |
| `notification_recipient`     | Immutable recipient snapshot and suppression reasons.                              |
| `notification_delivery`      | Per-recipient per-channel delivery state and destination metadata.                 |
| `notification_preference`    | User and org-scoped category/channel preferences plus quiet hours.                 |
| `contact_point`              | Email, phone, and push-token destinations with verification and health state.      |
| `notification_inbound_event` | Normalized provider events, replies, bounces, STOP/START, invalid-token callbacks. |
| `notification`               | Existing Hub inbox projection, linked back by `intent_id` and `delivery_id`.       |

## REST Surface

### User Inbox

`/v1/me/notifications` is the preferred personal inbox alias:

| Method | Path        | Behavior                                               |
| ------ | ----------- | ------------------------------------------------------ |
| `GET`  | `/`         | List the signed-in user's notifications, newest first. |
| `GET`  | `/count`    | Return unread and pending-approval counts.             |
| `GET`  | `/:id`      | Return one caller-owned notification or 404.           |
| `POST` | `/read-all` | Mark caller-owned unread notifications read.           |
| `POST` | `/:id/read` | Mark one caller-owned notification read.               |
| `POST` | `/:id/act`  | Apply a low-risk inline action and mark read.          |

The legacy `/v1/notifications` inbox routes remain for compatibility, but new personal UI should
use `/v1/me/notifications`.

### Preferences And Contact Points

| Method  | Path                                | Behavior                                                      |
| ------- | ----------------------------------- | ------------------------------------------------------------- |
| `GET`   | `/v1/me/notification-preferences`   | Materialize defaults plus saved overrides.                    |
| `PATCH` | `/v1/me/notification-preferences`   | Update quiet hours, timezone, and category/channel overrides. |
| `GET`   | `/v1/me/contact-points`             | List destinations visible to notification preferences.        |
| `POST`  | `/v1/me/contact-points`             | Create a pending email/phone/push destination.                |
| `POST`  | `/v1/me/contact-points/:id/verify`  | Verify a pending destination.                                 |
| `POST`  | `/v1/me/contact-points/:id/primary` | Make a destination primary for its type.                      |
| `POST`  | `/v1/me/contact-points/:id/disable` | Disable a destination without deleting history.               |

### Staff Notification Intents

`/v1/notifications` also hosts the staff-owned intent API:

| Method | Path              | Behavior                                                                           |
| ------ | ----------------- | ---------------------------------------------------------------------------------- |
| `POST` | `/`               | Create a draft or scheduled intent. Requires staff for staff/system announcements. |
| `GET`  | `/:id`            | Return one staff-visible intent.                                                   |
| `GET`  | `/:id/recipients` | Return the immutable recipient snapshot after send/test-send.                      |
| `GET`  | `/:id/deliveries` | Return per-channel delivery attempts.                                              |
| `POST` | `/:id/test`       | Send a copy to the staff caller only.                                              |
| `POST` | `/:id/send`       | Snapshot recipients and attempt delivery.                                          |
| `POST` | `/:id/cancel`     | Cancel a draft, queued, or scheduled intent.                                       |

### Staff Monitoring And Approval

`/admin/notifications` backs the staff console:

| Method | Path                  | Behavior                                                                        |
| ------ | --------------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/`                   | List intents for monitoring.                                                    |
| `GET`  | `/:id`                | Return one intent.                                                              |
| `GET`  | `/:id/estimate`       | Estimate recipients, channel send/delay/suppression counts, and approval gates. |
| `GET`  | `/:id/preview`        | Render web/email/SMS/push staff previews.                                       |
| `POST` | `/:id/approve`        | Move draft/scheduled to `queued` and write operator audit.                      |
| `POST` | `/:id/reject`         | Cancel a not-yet-delivered intent and write operator audit.                     |
| `GET`  | `/:id/audit`          | List operator audit events for the intent.                                      |
| `GET`  | `/:id/inbound-events` | List normalized provider events and replies for the intent.                     |

### Internal Provider Callbacks

| Method | Path                                    | Behavior                                                      |
| ------ | --------------------------------------- | ------------------------------------------------------------- |
| `POST` | `/internal/notifications/events/email`  | Normalize email delivery/bounce/complaint/unsubscribe events. |
| `POST` | `/internal/notifications/events/sms`    | Normalize SMS delivery, STOP, and START events.               |
| `POST` | `/internal/notifications/events/push`   | Normalize push delivery and invalid-token events.             |
| `POST` | `/internal/notifications/inbound/email` | Normalize email replies.                                      |
| `POST` | `/internal/notifications/inbound/sms`   | Normalize SMS replies.                                        |

Each callback must include `x-docket-signature`, an HMAC-SHA256 over the raw body.

## User Experience

- Web inbox is the canonical in-product record. Service announcements appear as ordinary inbox rows
  with compact delivery hints for email/SMS/push siblings.
- Preferences are quiet and reversible: users can disable mutable category/channel pairs, but locked
  security/account categories keep required channels on.
- Quiet hours delay external channels for normal-priority sends. Web rows remain available because
  they are not disruptive device notifications.
- Contact points are explicit and stateful. Pending destinations cannot receive external sends;
  bounced/unsubscribed/disabled destinations remain visible so the user understands why a channel is
  unavailable.
- Staff announcements follow a review path: compose, estimate, preview, test-send, approve, send,
  monitor deliveries, and review inbound events/audit.

## Channel Semantics

| Channel | Adapter           | Destination                         | Notes                                                                 |
| ------- | ----------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Web     | DB projection     | `notification` inbox row            | Canonical user-visible state.                                         |
| Email   | `Mailer` port     | active verified email contact point | SMTP in production; `CaptureMailer` in tests/local when unconfigured. |
| SMS     | `SmsSender` port  | active verified phone contact point | HTTP provider seam; user opt-in required for service announcements.   |
| Push    | `PushSender` port | active verified push token          | HTTP provider seam; invalid tokens disable the contact point.         |

## Implementation Boundaries

- Domain schemas, policies, web projection, and fixtures live in `@docket/notifications`.
- Runtime provider ports and capture/real adapters live in `@docket/boundaries`.
- API services own database behavior under `apps/api/src/services/notifications`.
- Route modules are thin factories over directly injected services or sub-routers.
- App composition (`apps/api/src/app.ts`) constructs concrete Drizzle-backed services.

## Verification

Primary focused suites:

```bash
cd apps/api
../../node_modules/.bin/vitest run tests/routes/notification-service-smoke.test.ts
../../node_modules/.bin/vitest run tests/routes/notification-intents.test.ts tests/routes/me-notifications.test.ts tests/routes/notification-preferences.test.ts tests/routes/contact-points.test.ts
../../node_modules/.bin/vitest run tests/services/notifications/dispatcher-email.test.ts tests/services/notifications/dispatcher-sms-push.test.ts tests/services/notifications/inbound.test.ts
```

The smoke covers the service-wide announcement journey: staff creates a draft, test-sends to self,
approves, sends to a test user, the user sees a web notification, and the capture mailer records the
staff test email plus recipient email.

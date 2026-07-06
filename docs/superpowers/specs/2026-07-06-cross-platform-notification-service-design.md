# Cross-Platform Notification Service - Design

> **Date**: 2026-07-06
> **Status**: Proposed
> **Scope**: REST notification service, service announcements, user inbox, email, phone/SMS, web, future mobile push, inbound notification events

## Objective

Build a cross-platform notification service that gives Docket one coherent way to create,
deliver, receive, audit, and manage notifications across web, email, phone/SMS, and future
mobile push.

This is not just a mail-sending abstraction. It is an attention system. Like Slack, the
service should give users a reliable sense of what needs their attention, sync read state
across devices, respect quiet hours and channel preferences, route replies back into the
product, and give staff safe tools for service-wide announcements.

## Existing Grounding

Docket already has several pieces that this service should absorb rather than bypass:

- `@docket/boundaries` exposes a `Mailer` port with SMTP and capture-mailer adapters.
- `apps/api` sends account, security, export, and daily-digest emails through that port.
- `/v1/notifications` exposes a cross-org web inbox backed by the existing `notification`
  table.
- Automations can create `automation` notifications.
- The broader notification service is still a backlog item, so the design can create the
  service boundary without fighting a mostly-built implementation.

The service should connect to these shipped surfaces first. It should not invent a parallel
notification world that leaves the existing inbox and mail paths stranded.

## Product Principles

1. **One event, many surfaces.** A notification intent is the source of truth. Web rows,
   emails, SMS messages, and future push messages are channel-specific deliveries derived
   from that intent.
2. **Attention is not delivery.** A provider accepting an email does not mean the user has
   seen the notification. Read state belongs to the user-facing notification, not to a
   transport receipt.
3. **Users control noise.** Preferences are by category, channel, organization, and quiet
   hours. Critical security and account notices may be locked, but everything else should
   be understandable and adjustable.
4. **Broad send is dangerous.** Service-wide announcements require preview, test send,
   audience estimate, suppression preview, audit trail, and approval for large or urgent
   audiences.
5. **Replies are product events.** Incoming SMS/email replies and provider webhooks are
   first-class inputs. They should create auditable inbound events rather than disappearing
   into provider dashboards.
6. **No arbitrary-address API.** Product APIs send to users, verified contact points, or
   audience snapshots. Staff-only test sends are the exception.
7. **Default to web inbox continuity.** If a notification is meaningful enough to send
   outside the app, it should normally have an in-app record too, so the user can return to
   a canonical source.

## Cross-Platform Complexity to Design For

Slack is the right mental reference because it shows how complicated "notify the user"
gets once the product exists on multiple surfaces. The system must separate these concerns:

1. **Message truth vs delivery truth.** The notification intent is product truth. Provider
   webhooks are transport truth. A provider can deliver an email while the product still
   shows the notification as unread.
2. **Unread state vs channel state.** Unread belongs to the user and the app. Channel state
   belongs to deliveries. Email opened, SMS delivered, and push tapped are useful signals,
   but they are not all equivalent to "read."
3. **Device and surface sync.** A user who reads a notification on the web should not keep
   seeing it as unread in mobile push later. The service needs a single read/action state
   that all first-party surfaces consume.
4. **Org/workspace boundaries.** Docket is cross-org. Preferences and inbox grouping must
   let users distinguish "Docket service notice" from "this org wants attention" from "an
   automation acted on my behalf."
5. **Urgency lanes.** Security, billing risk, human workflow, service announcement, digest,
   and marketing should not share the same interruption rules.
6. **Quiet hours and batching.** Routine work notifications can wait or digest. Account
   security and genuine incident notices may break through. The reason must be inspectable.
7. **Contact-point health.** Email bounces, SMS STOP, invalid push tokens, and unverified
   phone numbers change future eligibility. The service must learn from failed deliveries.
8. **Inbound messages.** Replies, STOP/HELP, unsubscribe clicks, and provider events come
   back through different protocols but need one normalized event log.
9. **Admin blast safety.** The most harmful action is a broad send with the wrong content
   or wrong audience. Preview, test, estimate, approval, audit, and cancellation are product
   requirements, not nice-to-have admin chrome.
10. **Privacy expectations.** Push lock screens, email open tracking, and SMS content have
    different privacy implications. The service should avoid exposing sensitive workflow
    details outside authenticated surfaces unless the category explicitly allows it.

## Concepts

### Notification Intent

A durable record that describes why Docket is trying to notify people.

```ts
type NotificationIntent = {
  id: string;
  senderType: 'system' | 'staff' | 'org' | 'automation';
  senderId?: string;
  organizationId?: string | null;
  category:
    | 'security'
    | 'account'
    | 'service_announcement'
    | 'workflow'
    | 'digest'
    | 'billing'
    | 'marketing';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  audience: Audience;
  channels: NotificationChannel[];
  subject: string;
  body: NotificationBody;
  status:
    | 'draft'
    | 'scheduled'
    | 'queued'
    | 'sending'
    | 'sent'
    | 'partially_failed'
    | 'failed'
    | 'canceled';
  scheduledAt?: string | null;
  createdAt: string;
  createdBy: string;
};
```

### Recipient Snapshot

The immutable expansion of an audience at send time. This is how Docket answers "who was
supposed to receive this?" even if org membership or user status changes later.

```ts
type NotificationRecipient = {
  id: string;
  notificationId: string;
  userId: string;
  organizationId?: string | null;
  reason: 'explicit' | 'org_member' | 'segment_match' | 'owner' | 'assignee';
  suppressions: SuppressionReason[];
  createdAt: string;
};
```

### Delivery

One attempt to reach one recipient through one channel.

```ts
type NotificationDelivery = {
  id: string;
  notificationId: string;
  recipientId: string;
  channel: 'web' | 'email' | 'sms' | 'push';
  destination: {
    type: 'in_app' | 'email' | 'phone' | 'push_token';
    valueMasked?: string;
    contactPointId?: string;
  };
  status:
    | 'suppressed'
    | 'queued'
    | 'sent'
    | 'delivered'
    | 'read'
    | 'acted'
    | 'failed'
    | 'bounced'
    | 'complained';
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  actedAt?: string | null;
};
```

### Contact Point

A verified destination owned by a user.

```ts
type ContactPoint = {
  id: string;
  userId: string;
  type: 'email' | 'phone' | 'push_token';
  valueMasked: string;
  status: 'pending' | 'active' | 'disabled' | 'bounced' | 'unsubscribed';
  primary: boolean;
  verifiedAt?: string | null;
  disabledAt?: string | null;
  createdAt: string;
};
```

### Inbound Event

A provider callback, user reply, or web action that returns to Docket.

```ts
type NotificationInboundEvent = {
  id: string;
  notificationId?: string | null;
  deliveryId?: string | null;
  channel: 'email' | 'sms' | 'web' | 'push';
  kind:
    | 'delivered'
    | 'opened'
    | 'clicked'
    | 'bounced'
    | 'complained'
    | 'replied'
    | 'unsubscribed'
    | 'action';
  from?: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
};
```

## Intended Behavior

### Creation

An internal caller, automation, org admin, or staff operator creates a notification intent
through REST. The caller chooses a category, audience, channels, message, priority, and
optional schedule.

The service validates:

- The sender is allowed to create that category.
- The requested audience is allowed for that sender.
- The requested channels are allowed for that category and audience.
- Required content exists for every requested channel.
- Broad audiences and urgent sends are not sent without review.
- Idempotency keys dedupe retried create/send calls.

Creation does not have to send immediately. Staff announcements should be draftable and
previewable. Product events can create and send in one call when the event is already
trusted, such as security notices or digest sweeps.

### Audience Expansion

At send time, the service expands the audience into recipient snapshots. Expansion is
transactional and auditable. If an org has 84 active members at send time, the notification
keeps those 84 recipient rows even if the org has 90 members tomorrow.

Supported initial audiences:

```ts
type Audience =
  | { type: 'user'; userId: string }
  | { type: 'users'; userIds: string[] }
  | { type: 'organization'; organizationId: string }
  | { type: 'all_users' }
  | {
      type: 'segment';
      segment:
        | 'active_users'
        | 'trial_users'
        | 'billing_admins'
        | 'users_with_bounced_email'
        | 'users_without_verified_phone';
    };
```

`all_users` and `segment` are staff-only. Org-authored sends can target only users in that
org and must be visibly branded as org-originated.

### Channel Selection

Requested channels are filtered by the user's preferences, contact-point status, quiet
hours, category policy, and suppression rules.

Default policy:

- `security`: web + email by default, SMS allowed if the user verified a phone. Not fully
  suppressible.
- `account`: web + email by default. User may reduce non-critical account updates.
- `service_announcement`: web + email by default for operational announcements. User may
  opt out of email but still sees web notices.
- `workflow`: web by default. Email/push controlled by per-org and per-category settings.
- `digest`: email by default only when the user opted into digest delivery.
- `billing`: web + email for billing admins. Some billing notices are non-optional.
- `marketing`: opt-in only and separate from service announcements.

Important distinction: web notification creation should usually happen even when email,
SMS, or push are suppressed. That preserves an in-product source of truth.

### Delivery

The dispatcher creates one delivery row per recipient per selected channel. Channel adapters
then perform the send:

- `web`: insert or update the app inbox projection.
- `email`: use the existing `Mailer` port.
- `sms`: use a future phone/SMS provider adapter.
- `push`: use a future push provider adapter for mobile/web push tokens.

Retries are per delivery, not per intent. A partial provider outage should not duplicate
successful deliveries.

### Read State

Read state is per user and syncs across web surfaces. Opening an email does not mark the
web notification as read. Clicking an authenticated deep link from email/SMS/push may mark
the related web notification read after the user lands in the app and the target is loaded.

This mirrors Slack's mental model: an external push or email nudges the user back to the
canonical app state, but the app owns whether something is still unread.

### Actions

Some notifications carry actions:

- Approve/reject an agent action.
- View a task or comment.
- Confirm a security change.
- Open billing settings.
- Acknowledge a service announcement.

Actions are channel-aware. Email/SMS should use signed, short-lived action links only for
low-risk actions. High-risk actions require an authenticated, fresh session in the app.

### Quiet Hours and Digesting

Users can configure quiet hours and preferred timezone. During quiet hours:

- `urgent` and locked security/account notices may still deliver immediately.
- Normal workflow notices are held for web/push/email delivery until quiet hours end.
- Low-priority workflow notices can be bundled into digest summaries.
- Service announcements scheduled by staff should respect the recipient's timezone unless
  explicitly marked as immediate operational notice.

The service should record whether a delivery was sent immediately, delayed, digested, or
suppressed so staff and support can explain what happened.

### Incoming Provider Events

Provider webhooks update delivery state:

- Email delivered, bounced, complained, opened, clicked.
- SMS delivered, failed, replied, STOP/START/HELP.
- Push delivered or invalid token.

The service must treat provider payloads as untrusted. Webhooks are verified by provider
signature, normalized into inbound events, and then applied to delivery/contact-point state.

### Incoming User Replies

Email and SMS replies should route back into Docket using opaque correlation tokens:

- A reply to a service announcement creates an inbound event visible to staff.
- A reply to an org-authored notification can route to org admins if enabled.
- A reply to an automation notification can create a workflow event for future automations.
- Unknown inbound replies are captured but not attached until staff/support triages them.

The user experience should never imply that every notification is conversational. The sender
can set `replyPolicy: "none" | "staff_inbox" | "org_admins" | "automation"`.

### Suppression

Suppressions are explicit and inspectable:

- User disabled channel for category.
- Quiet hours delayed delivery.
- No verified contact point.
- Contact point bounced.
- User unsubscribed from category.
- Category does not allow channel.
- Staff approval missing.
- Duplicate idempotency key.
- Legal/compliance suppression.

Suppressed web rows may still appear depending on category. Suppressed external deliveries
should never be silently counted as sent.

## User Experience

The UX is the most important part of this system. The service should make Docket feel calm,
trustworthy, and continuous across surfaces.

### User Mental Model

Users should learn one simple model:

> Docket keeps an inbox of things that may need my attention. Email, SMS, and push are ways
> Docket can bring me back to that inbox when something matters.

That means the web inbox is the canonical history. Email and SMS are not separate inboxes
with separate state. They are delivery channels.

### Web Inbox

The existing inbox should evolve into a Slack-like attention center:

- **All**: every notification the user can still reference.
- **Unread**: anything not yet read.
- **Needs action**: approvals, security confirmations, billing issues, failed connectors.
- **Mentions and assignments**: workflow attention.
- **Announcements**: service and org-wide notices.

Rows should be scannable:

- Icon and category.
- Sender context, such as "Docket", org name, automation name, or staff.
- Title.
- One-line summary.
- Timestamp.
- Origin chip when tied to an org.
- Delivery/channel hints only when useful, such as "Also emailed".
- Inline actions for common low-risk actions.

Rows should avoid provider language. Users should not see "SMTP accepted" or "delivery
event processed." They should see what happened and what they can do.

### Read and Action Behavior

Read should mean "I have looked at this." Action should mean "I handled it."

Examples:

- Opening an inbox row marks it read.
- Clicking "Approve" marks it acted and read.
- Opening a task from the notification marks the notification read.
- Receiving an email does not mark the notification read.
- Clicking a signed email link marks it read only after the user lands in the authenticated
  app route.

This keeps unread counts honest across web, email, SMS, and future mobile push.

### Notification Preferences

Preferences should not look like a developer matrix first. They should be grouped around
human questions:

- "How should Docket reach me for account and security?"
- "How should Docket reach me for work updates?"
- "How should Docket reach me for announcements?"
- "When should Docket avoid interrupting me?"
- "Which organizations can notify me outside the app?"

Advanced users can expand into the full category/channel matrix:

```json
{
  "service_announcement": {
    "web": true,
    "email": true,
    "sms": false,
    "push": false
  },
  "workflow": {
    "web": true,
    "email": false,
    "sms": false,
    "push": true
  },
  "security": {
    "web": true,
    "email": true,
    "sms": true,
    "push": true,
    "locked": true
  }
}
```

Locked categories must explain why they are locked. "Security notices cannot be turned off
because they protect your account" is acceptable. Silent lock icons are not.

### Contact Points

Settings should show verified destinations in plain language:

- Primary email from the account.
- Additional emails if supported later.
- Phone number for SMS.
- Future devices for push.

Each contact point shows status:

- Active.
- Pending verification.
- Disabled by the user.
- Bounced or unreachable.
- Unsubscribed.

If a phone number is added, verification is explicit. SMS is opt-in. The UI should explain
that SMS is for urgent or user-selected categories, not for routine chatter.

### Quiet Hours

Quiet hours should feel like a promise:

- Pick timezone.
- Pick days and hours.
- Choose whether urgent security/account notices can break through.
- Preview "What will still reach me immediately?"

Slack-like expectation: if the user says they are quiet, routine things wait. Breaking that
promise should be rare and visible.

### Email UX

Emails should be concise and action-oriented:

- Clear sender identity: Docket, org name, or automation.
- Subject that matches the web notification title.
- Body that explains why the user received it.
- Primary action button that deep links into Docket.
- Secondary plain-text fallback.
- Footer with notification settings and category-specific unsubscribe where allowed.

Service announcements should not look like marketing. They should be operational, short,
and easy to trust.

### SMS UX

SMS should be sparse:

- Reserved for urgent/security/account notices or explicit opt-in.
- Must identify Docket and the reason.
- Must include STOP/HELP compliance handling.
- Links should be short, signed, and low-risk.
- Replies should either be accepted and routed or clearly explain that replies are not
  monitored.

### Future Mobile Push UX

Push should behave like a faster web notification:

- Tap opens the relevant app route.
- Push respects quiet hours and preferences.
- Push invalid tokens are disabled automatically.
- Notification text is privacy-aware, especially on lock screens.

Push is a channel adapter, not a separate product model.

### Staff Announcement UX

Staff needs a safe broadcast console, not a raw API form.

Recommended flow:

1. **Compose**
   - Category: service announcement, security, billing, etc.
   - Title and summary.
   - Detailed body.
   - Reply policy.
2. **Audience**
   - Pick all users, active users, trial users, billing admins, users in an org, or explicit
     users.
   - Show estimated recipients before send.
   - Show suppressions: no email, quiet hours, bounced contact points.
3. **Channels**
   - Web is default.
   - Email can be selected for service announcements.
   - SMS requires high/urgent category and justification.
   - Push appears when available.
4. **Preview**
   - Render web, email, SMS, and push previews side by side.
   - Send test to self.
   - Validate links.
5. **Review**
   - Show final recipient count.
   - Show category and opt-out behavior.
   - Require approval for all-users, urgent, or SMS sends.
6. **Monitor**
   - Delivery progress.
   - Failures and bounces.
   - Replies.
   - Audit events.

The console should make broad sends feel consequential. A staff user should have to pause
before emailing everyone.

### Org Admin UX

Org-authored notifications should be narrower than staff announcements:

- Org admins can notify members of their org.
- They cannot bypass user preferences except for org-critical categories explicitly allowed
  by Docket policy.
- They see audience estimates for their org only.
- Messages are branded with the org and clearly distinguishable from Docket service notices.

This prevents org admins from becoming a spam vector.

### Developer UX

Internal engineers should not call `mailer.send` directly for product notifications once
this service exists. They should create notification intents:

```json
{
  "category": "security",
  "audience": { "type": "user", "userId": "usr_123" },
  "channels": ["web", "email"],
  "subject": "Your recovery codes were regenerated",
  "body": {
    "text": "Your Docket recovery codes were just regenerated.",
    "html": "<p>Your Docket recovery codes were just regenerated.</p>"
  },
  "source": {
    "type": "account_security",
    "id": "recovery_codes_regenerated"
  }
}
```

The service owns preferences, suppression, contact-point lookup, and delivery fan-out.

## REST API Surface

### User Inbox

The existing `/v1/notifications` can remain as a compatibility route, but the long-term
user-facing shape should be under `/v1/me`.

```http
GET  /v1/me/notifications
GET  /v1/me/notifications/count
GET  /v1/me/notifications/:id
POST /v1/me/notifications/:id/read
POST /v1/me/notifications/:id/act
POST /v1/me/notifications/read-all
```

Filters:

```http
GET /v1/me/notifications?unreadOnly=true&type=service_announcement&organizationId=org_123
```

### Preferences

```http
GET   /v1/me/notification-preferences
PATCH /v1/me/notification-preferences
```

Patch example:

```json
{
  "timezone": "America/Los_Angeles",
  "quietHours": {
    "enabled": true,
    "start": "18:00",
    "end": "08:00",
    "days": ["mon", "tue", "wed", "thu", "fri"]
  },
  "categories": {
    "service_announcement": { "email": false },
    "workflow": { "push": true, "email": false }
  }
}
```

### Contact Points

```http
GET    /v1/me/contact-points
POST   /v1/me/contact-points
POST   /v1/me/contact-points/:id/verify
POST   /v1/me/contact-points/:id/make-primary
DELETE /v1/me/contact-points/:id
```

Creation example:

```json
{
  "type": "phone",
  "value": "+17025550123",
  "purpose": "sms_notifications"
}
```

### Notification Intents

These are used by trusted internal callers, staff, org admins, and automations. Permissions
depend on sender type.

```http
POST /v1/notifications
GET  /v1/notifications/:id
GET  /v1/notifications/:id/recipients
GET  /v1/notifications/:id/deliveries
POST /v1/notifications/:id/send
POST /v1/notifications/:id/cancel
POST /v1/notifications/:id/test
```

Create example:

```json
{
  "senderType": "staff",
  "category": "service_announcement",
  "priority": "normal",
  "audience": { "type": "segment", "segment": "active_users" },
  "channels": ["web", "email"],
  "subject": "Scheduled maintenance tonight",
  "body": {
    "text": "Docket will be briefly unavailable tonight from 10:00 to 10:15 PM Pacific.",
    "html": "<p>Docket will be briefly unavailable tonight from 10:00 to 10:15 PM Pacific.</p>"
  },
  "scheduledAt": "2026-07-07T05:00:00.000Z",
  "replyPolicy": "staff_inbox",
  "idempotencyKey": "maint-2026-07-06"
}
```

### Staff/Admin Surface

Staff routes should live under the existing admin surface.

```http
GET  /admin/notifications
GET  /admin/notifications/:id
POST /admin/notifications/:id/approve
POST /admin/notifications/:id/reject
GET  /admin/notifications/:id/audit
GET  /admin/notifications/:id/inbound-events
```

### Internal Provider Events

Provider callbacks stay out of public `/v1`.

```http
POST /internal/notifications/events/email
POST /internal/notifications/events/sms
POST /internal/notifications/events/push
POST /internal/notifications/inbound/email
POST /internal/notifications/inbound/sms
```

These routes verify provider signatures, normalize payloads, record inbound events, and
update delivery/contact-point state.

## Permissions

### Sender Types

- `system`: trusted app code. Can send transactional categories.
- `staff`: staff operators. Can create service announcements and broad sends.
- `org`: org admins. Can send to members of their org within Docket policy.
- `automation`: user-authored automation rules. Can create workflow/web notifications and
  limited external sends when the user explicitly enabled them.

### Guardrails

- `all_users` is staff-only.
- SMS to more than one user requires staff approval and a high-value category.
- Security/account categories are system/staff only.
- Marketing is separate from service announcements and should require explicit consent.
- Test sends can target arbitrary staff-entered contact points only in admin context.
- Every broad send writes audit events: creator, approver, audience, channels, counts,
  content hash, schedule, cancel/send timestamps.

## Data Model

New or expanded tables:

- `notification_intent`
  - Durable source of truth.
  - Stores sender, category, priority, subject, body, audience, channel request, status,
    schedule, reply policy, idempotency key, and audit metadata.
- `notification_recipient`
  - Immutable audience snapshot.
  - Stores user id, org context, selection reason, suppression summary.
- `notification_delivery`
  - One row per recipient/channel attempt.
  - Stores destination metadata, channel, status, provider ids, errors, timestamps.
- `notification_preference`
  - User/category/channel/org settings plus quiet-hours data.
- `contact_point`
  - Verified email/phone/push-token destinations.
  - The existing auth email can be represented as the primary email contact point.
- `notification_inbound_event`
  - Normalized provider callbacks, replies, clicks, opens, unsubscribe events, and actions.
- `notification_template`
  - Optional second phase. Useful for repeatable security/account/digest templates.

Existing `notification` table options:

1. Keep it as the web-channel projection and attach it to `notification_delivery`.
2. Migrate it into `notification_delivery` with `channel = "web"`.

Recommendation: keep it as the web projection for the first implementation slice to avoid
rewriting the inbox all at once. Add references from new intent/delivery records, then fold
the schema later if it still feels beneficial.

## Delivery Architecture

### Services

- `NotificationIntentService`
  - Validates create/update/send requests.
  - Enforces permissions and category policy.
  - Creates drafts and schedules.
- `AudienceResolver`
  - Expands audiences into immutable recipient rows.
  - Explains recipient reasons.
- `PreferenceResolver`
  - Computes channel eligibility per recipient.
  - Applies category locks, quiet hours, org overrides, and suppressions.
- `NotificationDispatcher`
  - Creates delivery rows.
  - Calls channel adapters.
  - Handles idempotency and retries.
- `InboundNotificationService`
  - Verifies and normalizes provider callbacks/replies.
  - Updates deliveries, contact points, and staff/org reply queues.

### Channel Adapters

- `WebNotificationAdapter`
  - Writes the existing in-app notification projection.
- `EmailNotificationAdapter`
  - Uses the existing `Mailer` port.
- `SmsNotificationAdapter`
  - Future provider-backed adapter.
- `PushNotificationAdapter`
  - Future provider-backed adapter for mobile/web push.

Adapters should not know about audience rules. They receive delivery work already filtered
by policy.

## Error Handling and Reliability

- Create/send endpoints accept idempotency keys.
- Provider failures update delivery rows and enqueue retries with bounded backoff.
- Bounces mark the contact point as bounced and suppress future email to that point until
  corrected.
- Spam complaints unsubscribe or suppress the relevant category/channel.
- SMS STOP disables SMS contact delivery and records an inbound event.
- Invalid push tokens disable the push contact point.
- Partial failures do not roll back successful deliveries.
- Cancellation stops queued/future deliveries but does not delete sent history.

## Rollout Plan

### Phase 1: Web-first service spine

- Add intent, recipient, delivery, preference, and inbound-event schemas.
- Build REST create/send/read APIs for web channel.
- Keep existing `/v1/notifications` behavior working.
- Route automation `notification.send` through the service.

### Phase 2: Existing email flows move onto service

- Move auth/account/export/digest emails to notification intents where product-appropriate.
- Keep Better Auth mail edge where required, but record intent/delivery state for user-visible
  security/account events.
- Add contact-point representation for primary account email.

### Phase 3: Staff service announcements

- Add admin composer.
- Add test send, preview, audience estimate, approval, scheduling, cancellation, and monitoring.
- Launch service announcements over web + email.

### Phase 4: Phone/SMS

- Add phone contact points and verification.
- Add SMS preferences, STOP/START/HELP handling, provider webhooks, and inbound replies.
- Limit initial SMS use to security/account and staff-approved urgent notices.

### Phase 5: Push/mobile

- Add push contact points/tokens.
- Add push adapter and provider callbacks.
- Add lock-screen privacy controls.
- Reuse web notification read/action semantics.

## Non-Goals

- Building a marketing campaign platform.
- Letting org admins send arbitrary email campaigns.
- Replacing support tooling with a full shared inbox.
- Guaranteeing provider-level read/open tracking as product truth.
- Supporting every SMS/push provider on day one.
- Rewriting the whole existing inbox before the service spine proves itself.

## Acceptance Criteria

- A staff user can draft, preview, test, approve, schedule, send, cancel, and monitor a
  service announcement.
- A user receives the same notification in web and email without duplicate app inbox rows.
- Read state syncs in the app and is not falsely changed by email delivery/open events.
- User preferences suppress or delay external channels with visible reasons.
- Security/account notices can bypass selected preferences only according to explicit policy.
- Provider webhooks update delivery/contact-point state without exposing provider details to
  normal users.
- SMS replies and email replies become inbound events tied to the original notification when
  possible.
- Broad sends have immutable recipient snapshots and audit records.
- Existing notification inbox behavior remains available during migration.

## Open Product Questions

1. Should service announcements always create web inbox rows, even for signed-out or inactive
   users?
2. Should org-authored announcements be available in v1, or should v1 be staff/system only?
3. Should SMS be account/security only forever, or can users opt into workflow SMS later?
4. Should announcement replies go to staff by default, or should most announcements be no-reply?
5. Should email opens/clicks be tracked at all for service announcements, given privacy and
   trust concerns?
6. Should quiet hours apply to service announcements by default, or only to workflow notices?

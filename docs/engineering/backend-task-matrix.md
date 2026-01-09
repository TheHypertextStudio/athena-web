# Backend Task Matrix

Generated: 2026-01-05

## Priority alignment with user journeys and stories

- Sign-up/sign-in/account access: AUTH-003, AUTH-004, AUTH-005, AUTH-006, SEC-002, SEC-003, ACCT-002, ACCT-001.
- Onboarding + initial agenda: ONBOARD-002, AI-001, INT-002, INT-003, CALSYNC-001, CALSYNC-002, AGENDA-001.
- Agenda (home) daily planning: AGENDA-001..005, TASK-004, TASK-006, TIME-002..005, CAL-002..005, TB-001..002, SEARCH-001.
- Activity management + inbox signals: ACTIVITY-002..004, NOTIF-001..004, SYNC-002.
- Focus mode + time tracking: FOCUS-001..002, TIME-002..004.
- Subscriptions + billing + data control: BILL-001..002, ACCT-001..002.
- Settings + integrations: SETTINGS-002..004, INT-008..009, WS-001..003, NOTIF-001.
- AI assistant + tool actions: AI-001..006, MCP-001..004.
- Gaps: Inbox-specific backend tasks are not defined; likely composed from notifications + integrations + AI suggestions.

## Backend task matrix (non-completed tasks)

### auth

- **AUTH-003** SSO Integration (p1, backlog) deps: AUTH-001 files: apps/api/src/auth/saml.ts, apps/api/src/auth/oidc.ts
- **AUTH-004** Account Recovery (p1, backlog) deps: AUTH-001, AUTH-002 files: apps/api/src/auth/backup-codes.ts, apps/api/src/routes/auth/recovery.ts
- **AUTH-005** Session Management (p1, backlog) deps: AUTH-001 files: apps/api/src/routes/auth/sessions.ts
- **AUTH-006** Identity Provider Linking (p1, backlog) deps: AUTH-001 files: apps/api/src/routes/auth/link.ts

### account

- **ACCT-001** Data Export (p1, backlog) deps: DATA-001 files: apps/api/src/routes/account.ts, apps/api/src/workers/export.ts
- **ACCT-002** Account Deletion (p1, backlog) deps: AUTH-001 files: apps/api/src/routes/account.ts
- **ACCT-003** Encryption at Rest (p2, backlog) deps: DATA-001 files: apps/api/src/services/encryption.ts

### tasks

- **TASK-003** Recurring Tasks (RRULE) (p1, backlog) deps: TASK-001 files: apps/api/src/db/schema/core.ts, apps/api/src/lib/rrule.ts, apps/api/src/routes/tasks.ts
- **TASK-004** Time Estimation (p1, backlog) deps: TASK-001 files: apps/api/src/db/schema/core.ts
- **TASK-005** Soft Delete (p1, backlog) deps: TASK-001 files: apps/api/src/db/schema/core.ts
- **TASK-006** AI Time Estimation (p2, backlog) deps: TASK-004, AI-001

### projects

- **PROJ-003** Custom Project Statuses (p1, backlog) deps: PROJ-001, SETTINGS-001

### initiatives

- **INIT-102** AI-Assisted Initiative Creation (p1, backlog) deps: INIT-101, AI-001 files: apps/api/src/routes/initiatives.ts, apps/api/src/services/ai/initiative-generator.ts
- **INIT-103** Custom Initiative Statuses (p1, backlog) deps: INIT-101, SETTINGS-001

### calendar

- **CAL-002** Recurring Events (RRULE) (p1, backlog) deps: CAL-001 files: apps/api/src/db/schema/core.ts, apps/api/src/lib/rrule.ts
- **CAL-003** Timezone Support (p1, backlog) deps: CAL-001 files: apps/api/src/lib/timezone.ts
- **CAL-004** Multi-day Events (p1, backlog) deps: CAL-001
- **CAL-005** Event Source Filtering (p1, backlog) deps: CAL-001, INT-001

### time_blocks

- **TB-001** Time Blocks Entity (p1, backlog) deps: CAL-001 files: apps/api/src/db/schema/core.ts, apps/api/src/routes/time-blocks.ts, apps/api/src/schemas/time-blocks.ts
- **TB-002** Task-Time Block Association (p1, backlog) deps: TB-001, TASK-001

### calendar_sync

- **CALSYNC-001** Google Calendar OAuth (p1, backlog) deps: AUTH-001, CAL-001 files: apps/api/src/integrations/google/oauth.ts
- **CALSYNC-002** Google Calendar Sync (p1, backlog) deps: CALSYNC-001 files: apps/api/src/integrations/google/calendar.ts, apps/api/src/workers/google-calendar-sync.ts
- **CALSYNC-003** Outlook Calendar OAuth (p1, backlog) deps: AUTH-001, CAL-001 files: apps/api/src/integrations/microsoft/oauth.ts
- **CALSYNC-004** Outlook Calendar Sync (p1, backlog) deps: CALSYNC-003 files: apps/api/src/integrations/microsoft/calendar.ts
- **CALSYNC-005** iCloud Calendar Auth (p1, backlog) deps: AUTH-001, CAL-001 files: apps/api/src/integrations/apple/auth.ts
- **CALSYNC-006** iCloud Calendar Sync (p1, backlog) deps: CALSYNC-005 files: apps/api/src/integrations/caldav/client.ts
- **CALSYNC-007** Generic CalDAV Support (p2, backlog) deps: CALSYNC-006

### time_tracking

- **TIME-002** Active Timer (p1, backlog) deps: TIME-001 files: apps/api/src/db/schema/core.ts, apps/api/src/routes/time-tracking.ts
- **TIME-003** Manual Time Entry (p1, backlog) deps: TIME-001
- **TIME-004** Time Entry Editing (p1, backlog) deps: TIME-001
- **TIME-005** Time Tracking Analytics (p2, backlog) deps: TIME-001 files: apps/api/src/routes/time-tracking.ts

### agenda

- **AGENDA-001** Agenda Generation (p1, backlog) deps: TASK-001, CAL-001 files: apps/api/src/routes/agenda.ts, apps/api/src/schemas/agenda.ts
- **AGENDA-002** Agenda Reordering (p1, backlog) deps: AGENDA-001
- **AGENDA-003** AI Task Prioritization (p2, backlog) deps: AGENDA-001, AI-001 files: apps/api/src/services/ai/prioritization.ts
- **AGENDA-004** Day Utilization Metrics (p2, backlog) deps: AGENDA-001, TIME-001
- **AGENDA-005** Advance Planning (p2, backlog) deps: AGENDA-001

### ai

- **AI-001** AI Service Foundation (p1, backlog) deps: AUTH-001 files: apps/api/src/services/ai/provider.ts, apps/api/src/services/ai/providers/anthropic.ts, apps/api/src/services/ai/providers/openai.ts
- **AI-002** Chat Interface (p1, backlog) deps: AI-001 files: apps/api/src/db/schema/ai.ts, apps/api/src/routes/ai.ts
- **AI-003** Context Retrieval (p1, backlog) deps: AI-001 files: apps/api/src/services/ai/context.ts
- **AI-004** Tool Execution (p1, backlog) deps: AI-002 files: apps/api/src/services/ai/tools/index.ts, apps/api/src/services/ai/executor.ts
- **AI-005** Schedule Analysis (p2, backlog) deps: AI-001, CAL-001
- **AI-006** Action Item Extraction (p2, backlog) deps: AI-001, TASK-001

### integrations

- **INT-002** Linear Integration (p1, backlog) deps: INT-001 files: apps/api/src/integrations/linear/oauth.ts, apps/api/src/integrations/linear/client.ts, apps/api/src/integrations/linear/sync.ts, apps/api/src/webhooks/linear.ts
- **INT-003** GitHub Integration (p1, backlog) deps: INT-001 files: apps/api/src/integrations/github/oauth.ts, apps/api/src/integrations/github/client.ts
- **INT-008** Integration Sync Status (p1, backlog) deps: INT-001
- **INT-009** Integration Disconnection (p1, backlog) deps: INT-001
- **INT-004** Spotify Integration (p2, backlog) deps: INT-001, ACTIVITY-001 files: apps/api/src/integrations/spotify/oauth.ts, apps/api/src/integrations/spotify/sync.ts
- **INT-005** Todoist Integration (p2, backlog) deps: INT-001
- **INT-006** Toggl Integration (p2, backlog) deps: INT-001, TIME-001
- **INT-007** Notion Integration (p2, backlog) deps: INT-001

### activities

- **ACTIVITY-002** Manual Activity Logging (p1, backlog) deps: ACTIVITY-001
- **ACTIVITY-003** Activity Integration Ingestion (p1, backlog) deps: ACTIVITY-001, INT-001
- **ACTIVITY-004** Activity Export (p2, backlog) deps: ACTIVITY-001

### attachments

- **ATTACH-001** File Upload (p1, backlog) deps: AUTH-001 files: apps/api/src/services/storage/provider.ts, apps/api/src/services/storage/s3.ts, apps/api/src/services/storage/local.ts, apps/api/src/db/schema/core.ts, apps/api/src/routes/attachments.ts
- **ATTACH-002** Link Attachments (p1, backlog) deps: ATTACH-001 files: apps/api/src/lib/og-parser.ts
- **ATTACH-003** Entity-Attachment Association (p1, backlog) deps: ATTACH-001

### workspaces

- **WS-001** Workspace CRUD (p1, backlog) deps: AUTH-001 files: apps/api/src/db/schema/core.ts, apps/api/src/routes/workspaces.ts
- **WS-002** Workspace Scoping (p1, backlog) deps: WS-001
- **WS-003** Workspace Sharing (p2, backlog) deps: WS-001

### search

- **SEARCH-001** Full-text Search (p2, backlog) deps: TASK-001, PROJ-001 files: apps/api/src/routes/search.ts
- **SEARCH-002** Index Discovery (p2, backlog) deps: SEARCH-001, ATTACH-001

### settings

- **SETTINGS-002** Notification Preferences (p1, backlog) deps: SETTINGS-001, NOTIF-001
- **SETTINGS-003** AI Preferences (p1, backlog) deps: SETTINGS-001, AI-001
- **SETTINGS-004** Custom Statuses (p1, backlog) deps: SETTINGS-001 files: apps/api/src/db/schema/settings.ts, apps/api/src/routes/settings.ts

### notifications

- **NOTIF-001** Notification Service (p1, backlog) deps: AUTH-001 files: apps/api/src/services/notifications/provider.ts, apps/api/src/services/notifications/email.ts, apps/api/src/services/notifications/push.ts, apps/api/src/db/schema/notifications.ts
- **NOTIF-002** SMS Notifications (p2, backlog) deps: NOTIF-001
- **NOTIF-003** Slack Notifications (p2, backlog) deps: NOTIF-001, INT-001
- **NOTIF-004** Notification Snoozing (p2, backlog) deps: NOTIF-001

### sync

- **SYNC-001** WebSocket Server (p1, backlog) deps: AUTH-001 files: apps/api/src/ws/server.ts, apps/api/src/ws/auth.ts, apps/api/src/ws/rooms.ts
- **SYNC-002** SSE for Notifications (p1, backlog) deps: AUTH-001, NOTIF-001 files: apps/api/src/routes/sse.ts
- **SYNC-003** Offline Support (p1, backlog) deps: SYNC-001
- **SYNC-004** Conflict Resolution (p1, backlog) deps: SYNC-003

### mcp

- **MCP-001** MCP Server Foundation (p1, backlog) deps: AUTH-001, TASK-001, CAL-001 files: packages/mcp-server/src/index.ts
- **MCP-002** MCP Task Tools (p1, backlog) deps: MCP-001 files: packages/mcp-server/src/tools/tasks.ts
- **MCP-003** MCP Calendar Tools (p1, backlog) deps: MCP-001 files: packages/mcp-server/src/tools/calendar.ts
- **MCP-004** MCP Prompt Templates (p2, backlog) deps: MCP-001 files: packages/mcp-server/src/prompts/

### onboarding

- **ONBOARD-002** AI-Generated Initial Agenda (p1, backlog) deps: ONBOARD-001, AI-001, INT-001 files: apps/api/src/services/ai/onboarding.ts

### focus

- **FOCUS-001** Focus Session (p2, backlog) deps: TASK-001, TIME-002 files: apps/api/src/db/schema/core.ts, apps/api/src/routes/focus.ts
- **FOCUS-002** Focus Notes (p2, backlog) deps: FOCUS-001

### command_palette

- **CMD-001** Command Search API (p2, backlog) deps: SEARCH-001 files: apps/api/src/routes/commands.ts

### billing

- **BILL-001** Stripe Integration (p1, backlog) deps: AUTH-001 files: apps/api/src/services/stripe.ts, apps/api/src/routes/billing.ts, apps/api/src/webhooks/stripe.ts
- **BILL-002** Subscription Cancellation (p1, backlog) deps: BILL-001

### analytics

- **REPORT-001** Productivity Analytics (p2, backlog) deps: TIME-001, TASK-001 files: apps/api/src/routes/analytics.ts

### api_infra

- **INFRA-001** API Versioning (p1, backlog) files: apps/api/src/middleware/version.ts
- **INFRA-002** Rate Limiting (p1, backlog) files: apps/api/src/middleware/rate-limit.ts
- **INFRA-003** Request Logging (p1, backlog) files: apps/api/src/middleware/logging.ts

### testing

- **TEST-003** E2E Tests (p2, backlog) deps: WEB-001

### ops

- **OPS-002** Production Logging (p1, backlog) files: apps/api/src/lib/logger.ts
- **OPS-004** Database Connection Pooling (p1, backlog) deps: DATA-001

### security

- **SEC-001** Security Audit (p1, backlog) deps: AUTH-001, API-001
- **SEC-002** CORS Configuration (p1, backlog)
- **SEC-003** CSP Headers (p1, backlog)

### docs

- **DOC-001** API Documentation (p2, backlog) deps: API-001
- **DOC-002** Integration Guides (p2, backlog) deps: INT-001

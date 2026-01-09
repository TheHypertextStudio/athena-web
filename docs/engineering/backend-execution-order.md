# Backend Execution Order (Journey-First)

Date: 2026-01-05

This ordering prioritizes backend work that directly supports `docs/core/user-journeys.md` and `docs/core/user-stories.md`.

## Batch 1: Access + Onboarding + Agenda Core

- AUTH-003/004/005/006: SSO, recovery, session management, provider linking.
- CALSYNC-001/002: Google Calendar OAuth + sync (unblocks onboarding agenda).
- INT-002/003: Linear + GitHub integrations (onboarding data sources).
- AI-001: AI provider foundation (required for ONBOARD-002).
- ONBOARD-002: Initial agenda generation.
- AGENDA-001: Agenda endpoint + schema.
- CAL-002/003/004/005: Recurrence, timezone, multi-day, source filtering.
- TASK-003/004: Recurring tasks + time estimates.
- TIME-002/003/004: Active timer + manual/edited entries.
- TB-001/002: Time blocks + task association.

## Batch 2: Focus + Notifications + Settings

- FOCUS-001/002: Focus session + notes.
- NOTIF-001/002/003/004: Notification service + SMS/Slack/snooze.
- SETTINGS-002/003/004: Notification prefs, AI prefs, custom statuses.
- ACCT-001/002: Data export + account deletion (journey: data control).

## Batch 3: AI Assistant + Tooling

- AI-002/003/004/005/006: Chat, context retrieval, tools, schedule analysis, action extraction.
- MCP-001/002/003/004: MCP server + task/calendar tools + prompts.
- TASK-006, AGENDA-003: AI time estimation + task prioritization.

## Batch 4: Collaboration + Indexing + Attachments

- WS-001/002/003: Workspace CRUD, scoping, sharing.
- ATTACH-001/002/003: File uploads + link previews + association.
- SEARCH-001/002: Full-text search + index discovery.
- ACTIVITY-002/003/004: Manual logging, integration ingestion, export.

## Batch 5: Real-time + Offline Sync

- SYNC-001/002/003/004: WebSocket, SSE, offline sync, conflict resolution.

## Batch 6: Billing + Integrations (Extended)

- BILL-001/002: Stripe + cancellation.
- CALSYNC-003/004/005/006/007: Outlook/iCloud/CalDAV sync.
- INT-004/005/006/007/008/009: Spotify/Todoist/Toggl/Notion + sync status + disconnect.

## Batch 7: Infra, Security, Ops, Docs

- INFRA-001/002/003: API versioning, rate limiting, request logging.
- OPS-002/004: Production logging, DB pooling.
- SEC-001/002/003: Security audit + CORS + CSP.
- DOC-001/002: OpenAPI + integration guides.

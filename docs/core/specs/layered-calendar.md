# Layered Calendar Product Spec

> **Status**: Shipped (V1) — see "Shipped State And Known Follow-Ups" below for what landed
> differently than originally described here.
> **Area**: Calendar, agenda, tasks, connected accounts
> **Last Updated**: 2026-07-05

## Objective

Docket needs a calendar system that treats time as layered context for work, not as a flat list of
external events. Users should see calendar events from every connected account, edit events when the
provider permits it, create Docket-native time blocks, and attach many tasks to a calendar item
without turning the item itself into a task.

The first implementation ships with Google Calendar as the first provider, but the product model is
provider-neutral. Outlook, CalDAV, and other providers should plug into the same layer/item/task-link
contract later.

## Product Principles

- Calendar is user-scoped by default. A user's connected accounts and visible layers follow them
  across Docket workspaces.
- Tasks remain org-scoped. Calendar items relate to tasks only through explicit, permission-checked
  links.
- Calendar items and tasks are many-to-many. A conference can have many prep and follow-up tasks; a
  task can be related to multiple meetings or time blocks.
- Calendar views render layers. External provider calendars, Docket focus blocks, travel buffers,
  do-not-schedule blocks, and task timeboxes are different layers over the same day.
- Docket should never promise an edit that the provider or user's permission cannot honor. Read-only
  items remain useful, visible, and linkable.
- Provider events stay provider-owned unless the user creates a Docket-native block or task.

## User Stories

### Calendar Visibility

- As a user with several Google accounts, I can connect all of them and see selected calendars in
  Docket agenda views.
- As a user, I can toggle individual calendars/layers on or off without disconnecting the account.
- As a user, I can distinguish layers visually by name, color, provider, and editability.
- As a user, I can view a combined day/week calendar that includes external meetings, Docket-native
  blocks, and task timeboxes.

### Inline Editing

- As a user, I can drag or resize editable calendar items in calendar views when inline editing is
  enabled.
- As a user, I can edit core event fields from Docket: title, start/end/all-day, location, and
  description.
- As a user, I can edit Docket-native blocks immediately because Docket is the source of truth.
- As a user, I see read-only controls when an external item is not editable because of OAuth scope,
  calendar access role, attendee permissions, or provider limitations.
- As a user, if an external write conflicts with a provider change, Docket preserves my local intent,
  marks the item as conflicted, and gives me a way to review it.

### Event Workspaces And Tasks

- As a user, I can open a calendar item workspace from any calendar view.
- As a user, I can create several tasks from one item and classify them as prep, agenda, follow-up,
  outcome, or related work.
- As a user, I can link existing tasks to a calendar item.
- As a user, I can detach a task from a calendar item without deleting the task.
- As a user, I can open linked task detail pages from the item workspace.
- As a user, task links obey org permissions; Docket must not reveal a private task through a
  calendar item.

### Native Time Blocks

- As a user, I can create Docket-native blocks such as focus, travel, do-not-schedule, tentative
  hold, and planning.
- As a user, native blocks can carry task links but do not have to.
- As a user, native blocks can be edited even when no external provider is connected.
- As a user, native blocks appear in the same calendar views as provider events.

## Core Objects

### Calendar Layer

A layer is a renderable stream of time items. Examples:

- A Google calendar under one linked Google account.
- A Docket-native focus layer.
- A Docket task timebox layer backed initially by daily-plan timeboxes.
- Future availability, travel, or automation-generated layers.

Layers have visibility, color, provider/source metadata, editability, and sync health.

### Calendar Item

A calendar item is one visible time object. It can be:

- `provider_event`: an event synced from Google Calendar or a future provider.
- `native_block`: a Docket-owned time block.
- `task_timebox`: a Docket task scheduled onto a daily plan.
- `availability_block`: a provider or Docket block that affects scheduling but is not a meeting.

Every item has normalized time bounds, all-day support, title, optional description/location, layer
identity, permission summary, and sync/conflict state.

### Event Workspace

The item workspace is a detail drawer for a calendar item. It contains:

- Item header and core editable fields.
- Provider/account/layer metadata.
- Conflict or write-scope warnings.
- A linked task stack grouped by role.
- Actions to create, link, detach, and open tasks.

The workspace is the richer version of a simple linked-task stack. V1 should implement the workspace
shell even if some sections start compact.

## Permissions And Privacy

- Calendar account access is user-scoped and follows the signed-in user.
- External event editing requires all of:
  - the user's provider OAuth grant includes a write scope,
  - the provider calendar access role allows the edit,
  - the specific event allows the edit,
  - Docket's item permission resolver returns `canEditCore`.
- Task linking or task creation requires org membership and `contribute` on the target task/workspace.
- Calendar item reads may include task summaries only for tasks the user can view.
- If a calendar item is linked to tasks from several orgs, the item workspace filters the task stack
  per viewer permission.
- Provider-private fields should not be copied into org-scoped task link rows unless needed for a
  safe display snapshot.

## UI Surfaces

- Global agenda rail: continues to show the current day but renders layer-aware items.
- Calendar view: day/week timeline with layer controls, inline edit, drag/resize, and item
  workspace.
- Today page: can show "next up" from layered calendar items and task timeboxes.
- Task detail: shows linked calendar items as structured context, not only attachments.
- Google Calendar settings: expands from calendar visibility to account/layer/write-scope/sync health.
- Connected accounts: shows whether the Google grant is read-only calendar or editable calendar.

## V1 Scope

In scope:

- Provider-neutral layer/item/link model.
- Google Calendar as first provider.
- Read-only Google Calendar continues working for existing users.
- Write-backed core edits for Google events after re-consent to a write calendar scope.
- Docket-native blocks.
- Event workspace with multiple linked tasks.
- Layered agenda/calendar reads.
- Manual sync and scheduled/push-assisted sync.

Out of scope for V1:

- Full attendee management.
- Recurrence rule authoring UI.
- Conference link creation.
- Reminder editing.
- Outlook implementation, although the adapter contract must make it straightforward.

## Acceptance Criteria

- A user with multiple linked Google accounts can see selected calendars from all accounts in Docket.
- Existing read-only calendar users are not broken by the write-scope upgrade.
- Editable events can be changed inline and those edits are pushed to Google.
- Provider conflicts are visible and do not silently overwrite remote changes.
- Native blocks can be created, edited, and deleted without any external provider.
- A calendar item can link to many tasks, and a task can be linked to many calendar items.
- Calendar views can filter/toggle layers without blanking or fetching through ad-hoc client code.
- Task links never expose tasks the viewer cannot otherwise access.

## Shipped State And Known Follow-Ups

V1 shipped Tasks 1–10 of the implementation plan: provider-neutral layer/item/link schema, read
services with agenda compatibility, native blocks, task links, a Google sync engine with
write-back and conflict handling, push hints + scheduled sync, the web data layer, the full
calendar view + item workspace, incremental OAuth consent, primary navigation, and this e2e/docs
pass. One item from this spec's original V1 scope remains an explicit, tracked follow-up:

- **Task detail does not show linked calendar items.** "Task detail: shows linked calendar items
  as structured context, not only attachments" (UI Surfaces, above) needs a backend read for
  "calendar items linked to task X"; only the inverse (`GET /items/:id/tasks`, item → tasks)
  exists. Rather than fabricate this via client-side aggregation across unrelated endpoints, it
  was left unbuilt. `TaskAttachments.tsx` is unchanged.

Other known, deliberately-scoped simplifications (not gaps in the acceptance criteria, but worth
tracking): the full calendar view (`/calendar`) is reachable only by direct URL, not yet wired
into the app shell's primary navigation; the week view has no drag/resize (the day view does);
linking an existing task to a calendar item is by pasted task id (no search/picker component
exists in the codebase yet); the item workspace's provider-metadata line omits the linked
account's email.

## Source Notes

- Google incremental sync uses `syncToken` and requires a full sync after token invalidation:
  <https://developers.google.com/workspace/calendar/api/guides/sync>
- Google push notifications use watch channels that must be renewed and treated as hints:
  <https://developers.google.com/workspace/calendar/api/guides/push>
- Google Calendar write access requires broader scopes than the current read-only scope:
  <https://developers.google.com/workspace/calendar/api/auth>
- Google event writes use the Events update/patch API and provider concurrency metadata:
  <https://developers.google.com/workspace/calendar/api/v3/reference/events/update>
- Microsoft Graph has compatible delta and event update concepts for a future Outlook adapter:
  <https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0> and
  <https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0>

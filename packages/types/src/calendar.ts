/**
 * `@docket/types` — first-party Calendar DTOs.
 *
 * @remarks
 * Calendar is user-scoped: one Docket account can link multiple Google accounts, each
 * account exposes selectable calendars, and selected events can appear in any agenda
 * context without becoming imported integration tasks.
 */
import { z } from 'zod';

import {
  ActorId,
  CalendarConnectionId,
  CalendarEventId,
  CalendarItemId,
  CalendarLayerId,
  CalendarListId,
  DateString,
  OrganizationId,
  TaskId,
  TeamId,
} from './primitives';

/** Calendar providers supported by the layered-calendar domain. */
export const CalendarProvider = z.enum(['docket', 'google', 'microsoft', 'caldav']);
/** Calendar provider value. */
export type CalendarProvider = z.infer<typeof CalendarProvider>;

/** Connection lifecycle for one linked external calendar account. */
export const CalendarConnectionStatus = z.enum([
  'connected',
  'error',
  'disconnected',
  'reauth_required',
]);
/** Calendar connection status value. */
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatus>;

/**
 * A snapshot of the OAuth scopes actually granted for a calendar connection.
 *
 * @remarks
 * Captured after the OAuth handshake (and re-captured on reauth) so the app can tell
 * "connected but read-only" apart from "connected with write access" without re-parsing
 * raw provider scope strings on every request.
 */
export const CalendarScopeState = z
  .object({
    grantedScopes: z
      .array(z.string())
      .describe('Raw OAuth scope strings actually granted by the provider.'),
    calendarRead: z.boolean().describe('Whether the granted scopes include calendar read access.'),
    calendarWrite: z
      .boolean()
      .describe('Whether the granted scopes include calendar write access.'),
    capturedAt: z.string().describe('When this scope snapshot was captured (ISO 8601).'),
  })
  .meta({
    id: 'CalendarScopeState',
    description: 'A snapshot of the OAuth scopes actually granted for a calendar connection.',
  });
/** Calendar connection scope-state value. */
export type CalendarScopeState = z.infer<typeof CalendarScopeState>;

/** A linked Google account that contributes calendars to the user's agenda. */
export const CalendarConnectionOut = z
  .object({
    id: CalendarConnectionId.describe('Calendar connection id.'),
    provider: CalendarProvider.describe("Calendar provider; currently always 'google'."),
    externalAccountId: z.string().describe("Provider account id, e.g. Google's stable `sub`."),
    accountEmail: z.email().nullable().describe('Display email for the linked account.'),
    accountName: z.string().nullable().describe('Display name for the linked account.'),
    accountPictureUrl: z.url().nullable().describe('Avatar URL for the linked account.'),
    status: CalendarConnectionStatus.describe('Current sync/connectivity status.'),
    calendarsTotal: z.number().int().nonnegative().describe('Number of calendars discovered.'),
    calendarsEnabled: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of calendars selected for agenda visibility.'),
    lastSyncedAt: z.string().nullable().describe('Most recent successful sync timestamp.'),
    lastError: z.string().nullable().describe('Most recent sync/connectivity error, if any.'),
    createdAt: z.string().describe('Connection creation timestamp.'),
    updatedAt: z.string().describe('Connection update timestamp.'),
  })
  .meta({ id: 'CalendarConnectionOut', description: 'A linked Google Calendar account.' });
/** Linked calendar-account value. */
export type CalendarConnectionOut = z.infer<typeof CalendarConnectionOut>;

/** A selectable calendar under one linked account. */
export const CalendarListOut = z
  .object({
    id: CalendarListId.describe('Calendar list id.'),
    connectionId: CalendarConnectionId.describe('Owning calendar connection id.'),
    externalCalendarId: z.string().describe('Provider calendar id, e.g. `primary`.'),
    title: z.string().describe('Calendar display title.'),
    description: z.string().nullable().describe('Provider calendar description.'),
    timezone: z.string().nullable().describe('Calendar timezone id, when Google provides one.'),
    color: z.string().nullable().describe('Calendar color from the provider, usually hex.'),
    accessRole: z.string().nullable().describe('Provider access role for this calendar.'),
    primary: z.boolean().describe('Whether this is the primary calendar for the account.'),
    selected: z.boolean().describe('Whether this calendar appears in agenda contexts by default.'),
    visibleByDefault: z
      .boolean()
      .describe('Whether the global default visibility includes this calendar.'),
    lastSyncedAt: z.string().nullable().describe('Most recent successful event sync timestamp.'),
    lastError: z.string().nullable().describe('Most recent calendar-specific sync error, if any.'),
    updatedAt: z.string().describe('Calendar configuration update timestamp.'),
  })
  .meta({ id: 'CalendarListOut', description: 'A selectable Google calendar.' });
/** Selectable calendar value. */
export type CalendarListOut = z.infer<typeof CalendarListOut>;

/** Organizer details copied from a Google Calendar event. */
export const CalendarEventOrganizer = z
  .object({
    email: z.string().nullable().optional().describe('Organizer email, if available.'),
    displayName: z.string().nullable().optional().describe('Organizer display name, if available.'),
    self: z.boolean().optional().describe('Whether the organizer is the linked account.'),
  })
  .meta({ id: 'CalendarEventOrganizer', description: 'Google Calendar event organizer.' });
/** Calendar event organizer value. */
export type CalendarEventOrganizer = z.infer<typeof CalendarEventOrganizer>;

/** Attendee details copied from a Google Calendar event. */
export const CalendarEventAttendee = z
  .object({
    email: z.string().nullable().optional().describe('Attendee email, if available.'),
    displayName: z.string().nullable().optional().describe('Attendee display name, if available.'),
    responseStatus: z.string().nullable().optional().describe('Provider response status.'),
    optional: z.boolean().optional().describe('Whether the attendee is optional.'),
    self: z.boolean().optional().describe('Whether the attendee is the linked account.'),
  })
  .meta({ id: 'CalendarEventAttendee', description: 'Google Calendar event attendee.' });
/** Calendar event attendee value. */
export type CalendarEventAttendee = z.infer<typeof CalendarEventAttendee>;

/** Cached Google Calendar event, normalized for agenda use and task attachment provenance. */
export const CalendarEventOut = z
  .object({
    id: CalendarEventId.describe('Calendar event id.'),
    connectionId: CalendarConnectionId.describe('Owning linked Google account.'),
    calendarId: CalendarListId.describe('Owning selected calendar row.'),
    externalCalendarId: z.string().describe('Provider calendar id.'),
    externalEventId: z.string().describe('Provider event id.'),
    status: z.string().describe('Provider event status, e.g. confirmed/cancelled.'),
    title: z.string().describe('Event summary/title.'),
    description: z.string().nullable().describe('Event description/body, if present.'),
    location: z.string().nullable().describe('Event location, if present.'),
    htmlLink: z.url().nullable().describe('Provider deep link to the event.'),
    startsAt: z.string().nullable().describe('Timed event start timestamp; null for all-day.'),
    endsAt: z.string().nullable().describe('Timed event end timestamp; null for all-day.'),
    allDayStartDate: DateString.nullable().describe('All-day start date; null for timed events.'),
    allDayEndDate: DateString.nullable().describe(
      'All-day exclusive end date; null for timed events.',
    ),
    organizer: CalendarEventOrganizer.nullable().describe('Event organizer details.'),
    attendees: z.array(CalendarEventAttendee).describe('Event attendees copied from Google.'),
    updatedExternalAt: z.string().nullable().describe('Provider updated timestamp, if present.'),
    createdAt: z.string().describe('Local creation timestamp.'),
    updatedAt: z.string().describe('Local update timestamp.'),
  })
  .refine(
    (v) =>
      (v.startsAt !== null && v.endsAt !== null) ||
      (v.allDayStartDate !== null && v.allDayEndDate !== null),
    {
      path: ['startsAt'],
      message: 'A calendar event requires either timed bounds or all-day date bounds',
    },
  )
  .meta({ id: 'CalendarEventOut', description: 'A cached Google Calendar event.' });
/** Calendar event value. */
export type CalendarEventOut = z.infer<typeof CalendarEventOut>;

/** How a {@link CalendarLayerOut}'s items are populated. */
export const CalendarLayerSourceKind = z
  .enum(['provider_calendar', 'native_blocks', 'task_timeboxes', 'availability'])
  .meta({
    id: 'CalendarLayerSourceKind',
    description:
      "How a layer's items are populated: 'provider_calendar' (synced from a linked external provider calendar), 'native_blocks' (Docket-native time blocks), 'task_timeboxes' (derived from scheduled task timeboxes), or 'availability' (computed free/busy).",
  });
/** Calendar-layer source-kind value. */
export type CalendarLayerSourceKind = z.infer<typeof CalendarLayerSourceKind>;

/** The kind of time object a {@link CalendarItemOut} represents. */
export const CalendarItemKind = z
  .enum(['provider_event', 'native_block', 'task_timebox', 'availability_block'])
  .meta({
    id: 'CalendarItemKind',
    description:
      "The kind of time object a calendar item represents: 'provider_event' (synced from an external provider), 'native_block' (created directly in Docket), 'task_timebox' (a scheduled task instance), or 'availability_block' (a computed free/busy window).",
  });
/** Calendar-item-kind value. */
export type CalendarItemKind = z.infer<typeof CalendarItemKind>;

/** A calendar item's display/scheduling status. */
export const CalendarItemStatus = z
  .enum(['confirmed', 'tentative', 'cancelled', 'busy', 'free', 'held', 'conflicted'])
  .meta({
    id: 'CalendarItemStatus',
    description:
      "A calendar item's display/scheduling status: provider-style ('confirmed'/'tentative'/'cancelled'), availability-style ('busy'/'free'/'held'), or 'conflicted' when an unresolved local/provider write conflict exists.",
  });
/** Calendar-item-status value. */
export type CalendarItemStatus = z.infer<typeof CalendarItemStatus>;

/** A calendar item's outbox sync state relative to its provider, when provider-bound. */
export const CalendarItemSyncState = z
  .enum(['clean', 'local_dirty', 'push_pending', 'conflict', 'provider_error'])
  .meta({
    id: 'CalendarItemSyncState',
    description:
      "A calendar item's outbox sync state relative to its provider: 'clean' (no pending local changes), 'local_dirty' (edited locally, not yet queued), 'push_pending' (queued in the write outbox), 'conflict' (local and provider diverged), or 'provider_error' (the last push attempt failed).",
  });
/** Calendar-item-sync-state value. */
export type CalendarItemSyncState = z.infer<typeof CalendarItemSyncState>;

/** The role a linked task plays relative to a calendar item. */
export const CalendarItemTaskRole = z
  .enum(['prep', 'agenda', 'follow_up', 'outcome', 'related'])
  .meta({
    id: 'CalendarItemTaskRole',
    description:
      "The role a linked task plays relative to a calendar item: 'prep' (preparation work), 'agenda' (discussion topic), 'follow_up' (post-item action), 'outcome' (a result/decision captured from the item), or 'related' (loosely associated, no specific role).",
  });
/** Calendar-item-task-role value. */
export type CalendarItemTaskRole = z.infer<typeof CalendarItemTaskRole>;

/** A normalized per-item permission snapshot an adapter emits, independent of provider quirks. */
export const CalendarItemPermission = z
  .object({
    canEditCore: z
      .boolean()
      .describe("Whether the viewer may edit this item's core fields (title, time, location)."),
    canDelete: z.boolean().describe('Whether the viewer may delete/archive this item.'),
    readOnlyReason: z
      .enum([
        'provider_scope',
        'layer_access_role',
        'event_capability',
        'recurrence_unsupported',
        'conflict',
        'kind',
      ])
      .nullable()
      .describe('Why the item is read-only, or null when it is fully editable by the viewer.'),
  })
  .meta({
    id: 'CalendarItemPermission',
    description:
      'A normalized per-item permission snapshot an adapter emits, independent of provider quirks.',
  });
/** Calendar-item-permission value. */
export type CalendarItemPermission = z.infer<typeof CalendarItemPermission>;

/** A detected local/provider write conflict on a calendar item, captured for manual resolution. */
export const CalendarItemConflict = z
  .object({
    localPatch: z
      .record(z.string(), z.unknown())
      .describe('The local pending patch that could not be reconciled with the provider.'),
    providerSnapshot: z
      .record(z.string(), z.unknown())
      .describe('The provider-side snapshot the local patch conflicts with.'),
    detectedAt: z.string().describe('When the conflict was detected (ISO 8601).'),
  })
  .meta({
    id: 'CalendarItemConflict',
    description: 'A detected local/provider write conflict on a calendar item.',
  });
/** Calendar-item-conflict value. */
export type CalendarItemConflict = z.infer<typeof CalendarItemConflict>;

/** One renderable stream of calendar items — a provider calendar, native blocks, etc. */
export const CalendarLayerOut = z
  .object({
    id: CalendarLayerId.describe('Calendar layer id.'),
    connectionId: CalendarConnectionId.nullable().describe(
      'Owning linked account; null for Docket-native layers.',
    ),
    provider: CalendarProvider.nullable().describe(
      'Backing provider; null for Docket-native layers.',
    ),
    sourceKind: CalendarLayerSourceKind.describe("How this layer's items are populated."),
    externalLayerId: z
      .string()
      .nullable()
      .describe('Provider calendar id backing this layer; null for native layers.'),
    title: z.string().describe('Layer display title.'),
    description: z.string().nullable().describe('Layer description, if any.'),
    timezone: z.string().nullable().describe('Layer timezone id, when known.'),
    color: z.string().nullable().describe('Layer color, usually hex.'),
    accessRole: z
      .string()
      .nullable()
      .describe('Provider access role for this layer, if applicable.'),
    primary: z.boolean().describe("Whether this is the account's primary calendar layer."),
    selected: z.boolean().describe('Whether this layer is currently selected for rendering.'),
    visibleByDefault: z
      .boolean()
      .describe('Whether the global default visibility includes this layer.'),
    editableCore: z
      .boolean()
      .describe('Whether items on this layer support core-field edits (e.g. native layers).'),
    lastSyncedAt: z
      .string()
      .nullable()
      .describe('Most recent successful sync timestamp; null if never synced.'),
    lastError: z.string().nullable().describe('Most recent sync error, if any.'),
    watchExpiresAt: z
      .string()
      .nullable()
      .describe('Provider push-notification channel expiry, if subscribed.'),
    createdAt: z.string().describe('Layer creation timestamp.'),
    updatedAt: z.string().describe('Layer update timestamp.'),
  })
  .meta({
    id: 'CalendarLayerOut',
    description: 'One renderable stream of calendar items (provider calendar, native blocks, etc).',
  });
/** Calendar-layer value. */
export type CalendarLayerOut = z.infer<typeof CalendarLayerOut>;

/**
 * A safe per-viewer task summary for workspace/task-stack rendering next to a calendar item.
 *
 * @remarks
 * `done` mirrors the task's workflow-state category rather than the raw `state` key: the
 * owning team's `workflow_states` maps `state` onto a {@link WorkflowStateType}, and `done`
 * is true when that type is terminal (`completed` or `canceled`) — the same "doneish"
 * convention `TaskDetail.completedAt`/`canceledAt` derive from. Serializers can compute this
 * cheaply alongside a task read without exposing the full workflow config here.
 */
export const CalendarItemLinkedTaskOut = z
  .object({
    taskId: TaskId.describe('Linked task id.'),
    organizationId: OrganizationId.describe('Owning org of the linked task.'),
    role: CalendarItemTaskRole.describe('The role this task plays relative to the calendar item.'),
    sort: z.number().int().describe('Sort order among tasks linked to the same calendar item.'),
    note: z.string().nullable().describe('Optional note about the link.'),
    title: z.string().describe("Linked task's title, for display without a second fetch."),
    state: z.string().describe("Linked task's current workflow-state key."),
    done: z
      .boolean()
      .describe(
        "Whether the linked task's current state maps to a terminal workflow-state type ('completed' or 'canceled').",
      ),
  })
  .meta({
    id: 'CalendarItemLinkedTaskOut',
    description: 'A safe per-viewer task summary for workspace/task-stack rendering.',
  });
/** Calendar-item linked-task value. */
export type CalendarItemLinkedTaskOut = z.infer<typeof CalendarItemLinkedTaskOut>;

/** One visible time object on a calendar layer — a provider event, native block, or timebox. */
export const CalendarItemOut = z
  .object({
    id: CalendarItemId.describe('Calendar item id.'),
    layerId: CalendarLayerId.describe('Owning layer id.'),
    connectionId: CalendarConnectionId.nullable().describe(
      'Owning linked account; null for native/local items.',
    ),
    kind: CalendarItemKind.describe('The kind of time object this item represents.'),
    provider: CalendarProvider.nullable().describe(
      'Backing provider; null for Docket-native items.',
    ),
    externalCalendarId: z
      .string()
      .nullable()
      .describe('Provider calendar id; null for native items.'),
    externalEventId: z.string().nullable().describe('Provider event id; null for native items.'),
    recurringEventId: z
      .string()
      .nullable()
      .describe('Provider recurring-series id, if this instance belongs to one.'),
    recurrenceInstanceKey: z
      .string()
      .nullable()
      .describe('Provider key identifying this occurrence within a recurring series.'),
    status: CalendarItemStatus.describe('Display/scheduling status.'),
    title: z.string().describe('Item title.'),
    description: z.string().nullable().describe('Item description/body, if present.'),
    location: z.string().nullable().describe('Item location, if present.'),
    htmlLink: z.url().nullable().describe('Provider deep link to the item, if applicable.'),
    startsAt: z.string().nullable().describe('Timed item start timestamp; null for all-day.'),
    endsAt: z.string().nullable().describe('Timed item end timestamp; null for all-day.'),
    allDayStartDate: DateString.nullable().describe('All-day start date; null for timed items.'),
    allDayEndDate: DateString.nullable().describe(
      'All-day exclusive end date; null for timed items.',
    ),
    timezone: z.string().nullable().describe('Item timezone id, when known.'),
    organizer: CalendarEventOrganizer.nullable().describe('Item organizer details, if applicable.'),
    attendees: z.array(CalendarEventAttendee).describe('Item attendees, if applicable.'),
    permissions: CalendarItemPermission.describe(
      'Normalized per-item edit/delete permissions for the viewer.',
    ),
    syncState: CalendarItemSyncState.describe(
      'Outbox sync state relative to the provider, when provider-bound.',
    ),
    hasConflict: z
      .boolean()
      .describe('Whether this item currently has an unresolved local/provider write conflict.'),
    updatedExternalAt: z.string().nullable().describe('Provider updated timestamp, if present.'),
    archivedAt: z
      .string()
      .nullable()
      .describe('When this item was archived/soft-deleted; null while active.'),
    linkedTasks: z.array(CalendarItemLinkedTaskOut).describe('Tasks linked to this calendar item.'),
    createdAt: z.string().describe('Local creation timestamp.'),
    updatedAt: z.string().describe('Local update timestamp.'),
  })
  .refine(
    (v) =>
      (v.startsAt !== null && v.endsAt !== null) ||
      (v.allDayStartDate !== null && v.allDayEndDate !== null),
    {
      path: ['startsAt'],
      message: 'A calendar event requires either timed bounds or all-day date bounds',
    },
  )
  .meta({
    id: 'CalendarItemOut',
    description: 'One visible time object on a calendar layer.',
  });
/** Calendar-item value. */
export type CalendarItemOut = z.infer<typeof CalendarItemOut>;

/** A time-range query for calendar items across selected layers. */
export const CalendarRangeQuery = z
  .object({
    start: z.iso.datetime().describe('Range start (ISO 8601 datetime, inclusive).'),
    end: z.iso.datetime().describe('Range end (ISO 8601 datetime, exclusive).'),
    layerIds: z
      .array(CalendarLayerId)
      .optional()
      .describe('Restrict to these layer ids; omitted returns items across every selected layer.'),
    kinds: z
      .array(CalendarItemKind)
      .optional()
      .describe('Restrict to these item kinds; omitted returns every kind.'),
  })
  .refine((v) => v.end > v.start, {
    path: ['end'],
    message: '`end` must be after `start`',
  })
  .meta({
    id: 'CalendarRangeQuery',
    description: 'A time-range query for calendar items across selected layers.',
  });
/** Calendar-range-query value. */
export type CalendarRangeQuery = z.infer<typeof CalendarRangeQuery>;

/** Body for creating a Docket-native calendar block. */
export const CalendarItemCreate = z
  .object({
    kind: z
      .literal('native_block')
      .describe('Item kind; native-block creation always creates a `native_block` item.'),
    title: z.string().min(1).describe('Block title. Required, non-empty.'),
    description: z.string().optional().describe('Optional description/body for the block.'),
    location: z.string().optional().describe('Optional location for the block.'),
    timezone: z.string().optional().describe('Optional timezone id for the block.'),
    startsAt: z
      .string()
      .optional()
      .describe('Timed start timestamp; provide together with `endsAt` for a timed block.'),
    endsAt: z
      .string()
      .optional()
      .describe('Timed end timestamp; provide together with `startsAt` for a timed block.'),
    allDayStartDate: DateString.optional().describe(
      'All-day start date; provide together with `allDayEndDate` for an all-day block.',
    ),
    allDayEndDate: DateString.optional().describe(
      'All-day exclusive end date; provide together with `allDayStartDate` for an all-day block.',
    ),
    status: CalendarItemStatus.optional().describe(
      "Initial status; omitted defaults server-side (typically 'confirmed').",
    ),
    layerId: CalendarLayerId.optional().describe(
      "Target native layer id; omitted uses the caller's default native layer.",
    ),
  })
  .refine(
    (v) =>
      (v.startsAt !== undefined && v.endsAt !== undefined) ||
      (v.allDayStartDate !== undefined && v.allDayEndDate !== undefined),
    {
      path: ['startsAt'],
      message: 'A calendar event requires either timed bounds or all-day date bounds',
    },
  )
  .meta({ id: 'CalendarItemCreate', description: 'Create a Docket-native calendar block.' });
/** Validated calendar-item-create body. */
export type CalendarItemCreate = z.infer<typeof CalendarItemCreate>;

/**
 * Body for patching a calendar item's core fields.
 *
 * @remarks
 * For the clearable text fields (`description`, `location`) an empty string means "clear
 * the field" — the server maps `''` to `NULL`. A time-shape change must send the complete
 * new shape (both timed bounds, or both all-day dates); this schema validates only that at
 * least one field is present, not cross-field time consistency.
 */
export const CalendarItemUpdate = z
  .object({
    title: z.string().min(1).optional().describe('New title (non-empty). Omit to leave unchanged.'),
    description: z
      .string()
      .optional()
      .describe(
        'New description. An empty string clears it (mapped to NULL server-side). Omit to leave unchanged.',
      ),
    location: z
      .string()
      .optional()
      .describe(
        'New location. An empty string clears it (mapped to NULL server-side). Omit to leave unchanged.',
      ),
    timezone: z.string().optional().describe('New timezone id. Omit to leave unchanged.'),
    startsAt: z
      .string()
      .optional()
      .describe(
        'New timed start timestamp. Send together with `endsAt` to change the timed shape.',
      ),
    endsAt: z
      .string()
      .optional()
      .describe(
        'New timed end timestamp. Send together with `startsAt` to change the timed shape.',
      ),
    allDayStartDate: DateString.optional().describe(
      'New all-day start date. Send together with `allDayEndDate` to change the all-day shape.',
    ),
    allDayEndDate: DateString.optional().describe(
      'New all-day exclusive end date. Send together with `allDayStartDate` to change the all-day shape.',
    ),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.location !== undefined ||
      v.timezone !== undefined ||
      v.startsAt !== undefined ||
      v.endsAt !== undefined ||
      v.allDayStartDate !== undefined ||
      v.allDayEndDate !== undefined,
    { path: ['title'], message: 'At least one calendar item field is required' },
  )
  .meta({ id: 'CalendarItemUpdate', description: "Patch a calendar item's core fields." });
/** Validated calendar-item-update body. */
export type CalendarItemUpdate = z.infer<typeof CalendarItemUpdate>;

/** Body for updating a calendar layer's visibility or (for native layers) display settings. */
export const CalendarLayerUpdate = z
  .object({
    selected: z.boolean().optional().describe('Whether the layer is selected for rendering.'),
    visibleByDefault: z
      .boolean()
      .optional()
      .describe('Whether the global default visibility includes the layer.'),
    title: z
      .string()
      .min(1)
      .optional()
      .describe('New layer title. Only honored for native layers server-side.'),
    color: z
      .string()
      .optional()
      .describe('New layer color. Only honored for native layers server-side.'),
  })
  .refine(
    (v) =>
      v.selected !== undefined ||
      v.visibleByDefault !== undefined ||
      v.title !== undefined ||
      v.color !== undefined,
    { path: ['selected'], message: 'At least one calendar layer field is required' },
  )
  .meta({
    id: 'CalendarLayerUpdate',
    description: "Update a calendar layer's visibility or (for native layers) display settings.",
  });
/** Validated calendar-layer-update body. */
export type CalendarLayerUpdate = z.infer<typeof CalendarLayerUpdate>;

/** A link between a calendar item and a task. */
export const CalendarItemTaskLinkOut = z
  .object({
    calendarItemId: CalendarItemId.describe('Linked calendar item id.'),
    taskId: TaskId.describe('Linked task id.'),
    organizationId: OrganizationId.describe('Owning org of the linked task.'),
    role: CalendarItemTaskRole.describe('The role this task plays relative to the calendar item.'),
    sort: z.number().int().describe('Sort order among tasks linked to the same calendar item.'),
    note: z.string().nullable().describe('Optional note about the link.'),
    createdBy: ActorId.describe('Actor who created the link.'),
    createdAt: z.string().describe('Link creation timestamp.'),
  })
  .meta({
    id: 'CalendarItemTaskLinkOut',
    description: 'A link between a calendar item and a task.',
  });
/** Calendar-item task-link value. */
export type CalendarItemTaskLinkOut = z.infer<typeof CalendarItemTaskLinkOut>;

/**
 * Body for linking a task to a calendar item — either an existing task (`mode: 'link'`)
 * or a newly created one (`mode: 'create'`).
 */
export const CalendarItemTaskLinkCreate = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('link').describe('Link an existing task to the calendar item.'),
      organizationId: OrganizationId.describe(
        "Org owning the task to link. Must match the calendar item viewer's access.",
      ),
      taskId: TaskId.describe('Existing task id to link.'),
      role: CalendarItemTaskRole.optional().describe(
        "Role for the link; omitted defaults server-side (typically 'related').",
      ),
      note: z.string().optional().describe('Optional note about the link.'),
    }),
    z.object({
      mode: z.literal('create').describe('Create a new task and link it to the calendar item.'),
      organizationId: OrganizationId.describe('Org the new task is created in.'),
      teamId: TeamId.optional().describe('Team for the new task; omitted uses the default team.'),
      title: z
        .string()
        .min(1)
        .optional()
        .describe('Task title override; omitted derives from the calendar item title.'),
      note: z.string().optional().describe('Optional note about the link.'),
      role: CalendarItemTaskRole.optional().describe(
        "Role for the link; omitted defaults server-side (typically 'related').",
      ),
    }),
  ])
  .meta({
    id: 'CalendarItemTaskLinkCreate',
    description: 'Link an existing task, or create and link a new one, to a calendar item.',
  });
/** Validated calendar-item task-link-create body. */
export type CalendarItemTaskLinkCreate = z.infer<typeof CalendarItemTaskLinkCreate>;

/** Result of syncing linked calendar accounts/layers/items. */
export const CalendarSyncResultOut = z
  .object({
    connections: z.number().int().nonnegative().describe('Linked accounts processed.'),
    calendars: z.number().int().nonnegative().describe('Calendars processed.'),
    eventsCreated: z.number().int().nonnegative().describe('Events inserted locally.'),
    eventsUpdated: z.number().int().nonnegative().describe('Events updated locally.'),
    eventsDeleted: z.number().int().nonnegative().describe('Events removed or archived locally.'),
    errors: z.array(z.string()).describe('Non-fatal per-account or per-calendar sync errors.'),
    layers: z.number().int().nonnegative().describe('Calendar layers processed.'),
    itemsCreated: z.number().int().nonnegative().describe('Calendar items inserted locally.'),
    itemsUpdated: z.number().int().nonnegative().describe('Calendar items updated locally.'),
    itemsArchived: z
      .number()
      .int()
      .nonnegative()
      .describe('Calendar items removed or archived locally.'),
    writesApplied: z
      .number()
      .int()
      .nonnegative()
      .describe('Pending outbox writes successfully applied to the provider.'),
    writesPending: z
      .number()
      .int()
      .nonnegative()
      .describe('Outbox writes still queued (not yet applied or failed).'),
    conflicts: z
      .number()
      .int()
      .nonnegative()
      .describe('Calendar items left in an unresolved local/provider conflict state.'),
  })
  .meta({ id: 'CalendarSyncResultOut', description: 'Calendar sync summary.' });
/** Calendar sync result value. */
export type CalendarSyncResultOut = z.infer<typeof CalendarSyncResultOut>;

/** Body for updating selected/default visibility of calendars. */
export const CalendarListUpdate = z
  .object({
    selected: z.boolean().optional().describe('Whether the calendar appears in agenda contexts.'),
    visibleByDefault: z
      .boolean()
      .optional()
      .describe('Whether the global default visibility includes the calendar.'),
  })
  .refine((v) => v.selected !== undefined || v.visibleByDefault !== undefined, {
    path: ['selected'],
    message: 'At least one calendar visibility field is required',
  })
  .meta({ id: 'CalendarListUpdate', description: 'Update Google Calendar visibility settings.' });
/** Calendar visibility update body value. */
export type CalendarListUpdate = z.infer<typeof CalendarListUpdate>;

/** Response containing all linked calendar accounts and calendars. */
export const CalendarSettingsOut = z
  .object({
    connections: z.array(CalendarConnectionOut).describe('Linked Google Calendar accounts.'),
    calendars: z.array(CalendarListOut).describe('Calendars across every linked account.'),
    layers: z
      .array(CalendarLayerOut)
      .describe(
        'Every calendar layer for the signed-in user (provider-backed and Docket-native), selected or not.',
      ),
  })
  .meta({ id: 'CalendarSettingsOut', description: 'User-scoped Google Calendar settings.' });
/** Calendar settings value. */
export type CalendarSettingsOut = z.infer<typeof CalendarSettingsOut>;

/** List of calendar layers for the signed-in user. */
export const CalendarLayersOut = z
  .object({
    items: z
      .array(CalendarLayerOut)
      .describe('Every calendar layer for the signed-in user, selected or not.'),
  })
  .meta({
    id: 'CalendarLayersOut',
    description: 'List of calendar layers for the signed-in user.',
  });
/** Calendar-layers list value. */
export type CalendarLayersOut = z.infer<typeof CalendarLayersOut>;

/** Body for creating a task from one Google Calendar event. */
export const CalendarEventCreateTask = z
  .object({
    organizationId: OrganizationId.optional().describe(
      'Target organization for the created task; omitted uses the caller personal/default workspace.',
    ),
    teamId: TeamId.optional().describe('Target team for the task; omitted uses the default team.'),
    title: z
      .string()
      .min(1)
      .optional()
      .describe('Task title override; omitted derives from the event title.'),
    note: z.string().optional().describe('Optional note/comment for the created task.'),
  })
  .meta({
    id: 'CalendarEventCreateTask',
    description: 'Create a Docket task from a calendar event.',
  });
/** Calendar-event task creation body value. */
export type CalendarEventCreateTask = z.infer<typeof CalendarEventCreateTask>;

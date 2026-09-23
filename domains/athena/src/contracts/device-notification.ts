/**
 * `domain packages` — device notification sync: the wire contract between a phone that indexes its
 * own notifications and the server copy Athena reads.
 *
 * @remarks
 * The phone is the only writer. It registers itself as a source, uploads what it captured in
 * batches, and reads back the deletions made elsewhere. Every time on the wire is Unix
 * milliseconds, because that is what the phone records; the server stores them as timestamps.
 *
 * Batch items are validated one at a time. The request envelope ({@link DeviceNotificationBatchIn})
 * only checks the batch shape and that every item carries an id, so one malformed notification is
 * answered `invalid` in its own result instead of failing the other ninety-nine. The strict item
 * schemas, {@link DeviceNotificationIn} and {@link DeviceNotificationRemovalIn}, are what each item
 * is then held to.
 *
 * The Android client's copy of this contract is `docs/reference/notification-sync.md` in
 * docket-android; the server's is `docs/engineering/specs/device-notification-sync.md`.
 */
import { z } from 'zod';

/** Field and batch limits shared by the validators, the route prose, and the tests. */
export const DEVICE_NOTIFICATION_LIMITS = {
  /** Notifications in one upload batch. */
  notificationsPerBatch: 100,
  /** Removals in one upload batch. */
  removalsPerBatch: 200,
  /** Conversation messages carried by one notification. */
  messagesPerNotification: 100,
  /** Inbox-style lines carried by one notification. */
  linesPerNotification: 50,
  /** Characters in any one text field. */
  textLength: 4000,
  /** Shortest retention a device may report, in days. */
  retentionDaysMin: 1,
  /** Longest retention a device may report, in days (ten years). */
  retentionDaysMax: 3650,
  /** Default page size for the list. */
  listDefault: 50,
  /** Largest page size for the list. */
  listMax: 200,
} as const;

/** The largest Unix millisecond value accepted: the last millisecond of the year 9999. */
const MAX_EPOCH_MILLISECONDS = 253_402_300_799_999;

/** A Crockford base32 ULID; the phone mints every id it sends. */
const Ulid = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, 'Expected a 26-character ULID.');

/** A Unix time in milliseconds. */
const EpochMilliseconds = z.number().int().min(0).max(MAX_EPOCH_MILLISECONDS);

/** One bounded text field. */
const Text = z.string().max(DEVICE_NOTIFICATION_LIMITS.textLength);

/** One bounded text field that must say something. */
const RequiredText = Text.min(1);

/** An optional text field; `null` and absence mean the same thing. */
const OptionalText = Text.nullish().transform((value) => value ?? null);

/** The platforms a source can be. Android is the only one today. */
export const DeviceNotificationPlatform = z
  .enum(['android'])
  .meta({ id: 'DeviceNotificationPlatform', description: 'The platform a device runs.' });
/** Device platform value. */
export type DeviceNotificationPlatform = z.infer<typeof DeviceNotificationPlatform>;

/** What a notification is about, as the phone's extractor classified it. */
export const DeviceNotificationKind = z
  .enum([
    'message',
    'email',
    'call',
    'event',
    'reminder',
    'alarm',
    'social',
    'promotion',
    'status',
    'system',
    'other',
  ])
  .meta({ id: 'DeviceNotificationKind', description: 'What a synced notification is about.' });
/** Notification kind value. */
export type DeviceNotificationKind = z.infer<typeof DeviceNotificationKind>;

/** Why a notification left the phone's shade. */
export const DeviceNotificationRemovalReason = z
  .enum([
    'opened',
    'dismissed',
    'dismissed_all',
    'withdrawn_by_app',
    'expired',
    'snoozed',
    'other',
    'unknown',
  ])
  .meta({
    id: 'DeviceNotificationRemovalReason',
    description: 'Why a notification was removed from the device.',
  });
/** Removal reason value. */
export type DeviceNotificationRemovalReason = z.infer<typeof DeviceNotificationRemovalReason>;

/** The per-item outcome of an upload. */
export const DeviceNotificationItemStatus = z
  .enum(['stored', 'duplicate', 'deleted', 'expired', 'orphaned', 'invalid'])
  .meta({
    id: 'DeviceNotificationItemStatus',
    description:
      '`stored`: saved now. `duplicate`: already saved. `deleted`: a deletion made after it was captured covers it. `expired`: older than the device’s retention. `orphaned`: a removal whose notification the server does not hold. `invalid`: the item failed validation.',
  });
/** Item status value. */
export type DeviceNotificationItemStatus = z.infer<typeof DeviceNotificationItemStatus>;

/** The install's random id, as a path parameter. */
export const DeviceNotificationSourceParam = z.object({
  deviceId: Ulid.describe('The install’s random ULID. Never derived from hardware.'),
});
/** Source path parameter value. */
export type DeviceNotificationSourceParam = z.infer<typeof DeviceNotificationSourceParam>;

/** Register a device, or update its label or retention. */
export const DeviceNotificationSourceIn = z
  .object({
    platform: DeviceNotificationPlatform,
    label: RequiredText.describe('A friendly device name, such as the phone model.'),
    retentionDays: z
      .number()
      .int()
      .min(DEVICE_NOTIFICATION_LIMITS.retentionDaysMin)
      .max(DEVICE_NOTIFICATION_LIMITS.retentionDaysMax)
      .describe(
        'How long the device keeps entries, in days (1..3650). The server keeps its copy as long.',
      ),
    syncConsentedAt: EpochMilliseconds.describe('When the person turned sync on, Unix ms.'),
  })
  .meta({ id: 'DeviceNotificationSourceIn', description: 'Register a notification source.' });
/** Source registration value. */
export type DeviceNotificationSourceIn = z.infer<typeof DeviceNotificationSourceIn>;

/** A registered device. */
export const DeviceNotificationSourceOut = z
  .object({
    deviceId: z.string().describe('The install’s ULID.'),
    platform: DeviceNotificationPlatform,
    label: z.string(),
    retentionDays: z.number().int(),
    syncConsentedAt: z.number().int().describe('Unix ms.'),
    lastSeenAt: z.number().int().describe('When the device last registered or uploaded, Unix ms.'),
    createdAt: z.number().int().describe('Unix ms.'),
    updatedAt: z.number().int().describe('Unix ms.'),
  })
  .meta({ id: 'DeviceNotificationSourceOut', description: 'A registered notification source.' });
/** Source value. */
export type DeviceNotificationSourceOut = z.infer<typeof DeviceNotificationSourceOut>;

/** One conversation message carried by a messaging notification. */
export const DeviceNotificationMessageIn = z
  .object({
    id: Ulid,
    threadId: Text.describe('The conversation the message belongs to.'),
    sender: OptionalText,
    sentAt: EpochMilliseconds,
    text: Text,
    identity: RequiredText.describe(
      'A stable identity for the message across notifications. A message already stored with this identity is not stored again.',
    ),
  })
  .meta({ id: 'DeviceNotificationMessageIn', description: 'One conversation message.' });
/** Message input value. */
export type DeviceNotificationMessageIn = z.infer<typeof DeviceNotificationMessageIn>;

/** Android-specific fields of a notification. */
export const DeviceNotificationAndroidIn = z
  .object({
    channelId: OptionalText,
    category: OptionalText,
    whenAt: EpochMilliseconds.describe('The notification’s own `when`, Unix ms.'),
    shortcutId: OptionalText,
  })
  .meta({ id: 'DeviceNotificationAndroidIn', description: 'Android notification fields.' });
/** Android fields value. */
export type DeviceNotificationAndroidIn = z.infer<typeof DeviceNotificationAndroidIn>;

/** One captured notification, exactly as the phone indexed it. */
export const DeviceNotificationIn = z
  .object({
    id: Ulid,
    platform: DeviceNotificationPlatform,
    extractorVersion: z.number().int().min(1).max(1_000_000),
    appId: RequiredText.describe('The posting app’s package name.'),
    appName: Text,
    sourceKey: RequiredText.describe('The platform’s key for the notification.'),
    threadId: OptionalText,
    threadTitle: OptionalText,
    kind: DeviceNotificationKind,
    postedAt: EpochMilliseconds,
    capturedAt: EpochMilliseconds.describe('When the phone stored it; retention runs from here.'),
    title: OptionalText,
    subtitle: OptionalText,
    body: OptionalText,
    lines: z.array(Text).max(DEVICE_NOTIFICATION_LIMITS.linesPerNotification).default([]),
    redacted: z.boolean(),
    scrubbed: z.boolean(),
    backfilled: z.boolean(),
    contentHash: RequiredText,
    android: DeviceNotificationAndroidIn.nullish().transform((value) => value ?? null),
    messages: z
      .array(DeviceNotificationMessageIn)
      .max(DEVICE_NOTIFICATION_LIMITS.messagesPerNotification)
      .default([]),
  })
  .meta({ id: 'DeviceNotificationIn', description: 'One notification captured on a device.' });
/** Notification input value. */
export type DeviceNotificationIn = z.infer<typeof DeviceNotificationIn>;

/** One notification leaving the phone's shade. */
export const DeviceNotificationRemovalIn = z
  .object({
    id: Ulid,
    notificationId: Ulid,
    removedAt: EpochMilliseconds,
    reason: DeviceNotificationRemovalReason,
    platformReason: z
      .number()
      .int()
      .nullish()
      .transform((value) => value ?? null)
      .describe('The platform’s own reason code, when it gave one.'),
  })
  .meta({ id: 'DeviceNotificationRemovalIn', description: 'One notification removal.' });
/** Removal input value. */
export type DeviceNotificationRemovalIn = z.infer<typeof DeviceNotificationRemovalIn>;

/**
 * The minimum every batch item must carry so its result can name it.
 *
 * @remarks
 * Offered as the second branch of each item's union, after the full schema, so an item that fails
 * its schema still parses here and is answered `invalid` rather than failing the whole batch. The
 * published reference therefore shows the full schema a client should send.
 */
const BatchItemEnvelope = z.looseObject({ id: z.string().min(1).max(64) }).meta({
  id: 'DeviceNotificationUnreadableItem',
  description:
    'An item that does not satisfy the full schema. It is answered `invalid` in its own result instead of failing the batch.',
});

/**
 * One upload batch.
 *
 * @remarks
 * The request is parsed leniently: each item is its full schema or, failing that, anything with an
 * `id`. The upload then holds each notification to {@link DeviceNotificationIn} and each removal to
 * {@link DeviceNotificationRemovalIn} one at a time, so one malformed item cannot fail the others.
 */
export const DeviceNotificationBatchIn = z
  .object({
    deviceId: Ulid.describe('The registered source uploading this batch.'),
    notifications: z
      .array(z.union([DeviceNotificationIn, BatchItemEnvelope]))
      .max(DEVICE_NOTIFICATION_LIMITS.notificationsPerBatch)
      .default([])
      .describe('At most 100 notifications.'),
    removals: z
      .array(z.union([DeviceNotificationRemovalIn, BatchItemEnvelope]))
      .max(DEVICE_NOTIFICATION_LIMITS.removalsPerBatch)
      .default([])
      .describe('At most 200 removals.'),
  })
  .meta({ id: 'DeviceNotificationBatchIn', description: 'One notification upload batch.' });
/** Batch input value. */
export type DeviceNotificationBatchIn = z.infer<typeof DeviceNotificationBatchIn>;

/** One item's outcome. */
export const DeviceNotificationItemResult = z
  .object({ id: z.string(), status: DeviceNotificationItemStatus })
  .meta({ id: 'DeviceNotificationItemResult', description: 'One upload item’s outcome.' });
/** Item result value. */
export type DeviceNotificationItemResult = z.infer<typeof DeviceNotificationItemResult>;

/** One result per item, in request order. */
export const DeviceNotificationBatchOut = z
  .object({
    notifications: z.array(DeviceNotificationItemResult),
    removals: z.array(DeviceNotificationItemResult),
  })
  .meta({ id: 'DeviceNotificationBatchOut', description: 'Per-item upload results.' });
/** Batch result value. */
export type DeviceNotificationBatchOut = z.infer<typeof DeviceNotificationBatchOut>;

/** One app's deletion time. */
export const DeviceNotificationAppDeletion = z
  .object({
    appId: z.string(),
    deletedBefore: z.number().int().describe('Entries captured at or before this, Unix ms.'),
  })
  .meta({ id: 'DeviceNotificationAppDeletion', description: 'One app’s deletion time.' });
/** App deletion value. */
export type DeviceNotificationAppDeletion = z.infer<typeof DeviceNotificationAppDeletion>;

/** The deletions a phone applies locally. */
export const DeviceNotificationDeletionsOut = z
  .object({
    deletedBefore: z
      .number()
      .int()
      .nullable()
      .describe('Everything captured at or before this was deleted, Unix ms; null if never.'),
    apps: z.array(DeviceNotificationAppDeletion),
  })
  .meta({ id: 'DeviceNotificationDeletionsOut', description: 'Server-side deletions.' });
/** Deletions value. */
export type DeviceNotificationDeletionsOut = z.infer<typeof DeviceNotificationDeletionsOut>;

/** Which synced entries to delete. */
export const DeviceNotificationDeleteQuery = z
  .object({
    appId: RequiredText.optional().describe('Delete only this app’s entries. Omit to delete all.'),
  })
  .meta({ id: 'DeviceNotificationDeleteQuery', description: 'Which entries to delete.' });
/** Delete query value. */
export type DeviceNotificationDeleteQuery = z.infer<typeof DeviceNotificationDeleteQuery>;

/** How many notifications a delete removed. */
export const DeviceNotificationDeleteOut = z
  .object({ deleted: z.number().int().min(0).describe('Notifications deleted.') })
  .meta({ id: 'DeviceNotificationDeleteOut', description: 'The result of a delete.' });
/** Delete result value. */
export type DeviceNotificationDeleteOut = z.infer<typeof DeviceNotificationDeleteOut>;

/** Filters and paging for the list. */
export const DeviceNotificationListQuery = z
  .object({
    appId: RequiredText.optional().describe('Only this app’s entries.'),
    cursor: z.string().optional().describe('`nextCursor` from the previous page.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(DEVICE_NOTIFICATION_LIMITS.listMax)
      .default(DEVICE_NOTIFICATION_LIMITS.listDefault)
      .describe('Page size, 1..200 (default 50).'),
  })
  .meta({ id: 'DeviceNotificationListQuery', description: 'List synced notifications.' });
/** List query value. */
export type DeviceNotificationListQuery = z.infer<typeof DeviceNotificationListQuery>;

/** A stored conversation message. */
export const DeviceNotificationMessageOut = z
  .object({
    id: z.string(),
    threadId: z.string(),
    sender: z.string().nullable(),
    sentAt: z.number().int(),
    text: z.string(),
    identity: z.string(),
  })
  .meta({ id: 'DeviceNotificationMessageOut', description: 'A stored conversation message.' });
/** Message value. */
export type DeviceNotificationMessageOut = z.infer<typeof DeviceNotificationMessageOut>;

/** A stored removal. */
export const DeviceNotificationRemovalOut = z
  .object({
    id: z.string(),
    removedAt: z.number().int(),
    reason: DeviceNotificationRemovalReason,
    platformReason: z.number().int().nullable(),
  })
  .meta({ id: 'DeviceNotificationRemovalOut', description: 'A stored removal.' });
/** Removal value. */
export type DeviceNotificationRemovalOut = z.infer<typeof DeviceNotificationRemovalOut>;

/** A stored notification with the messages stored with it and its removal. */
export const DeviceNotificationOut = z
  .object({
    id: z.string(),
    deviceId: z.string(),
    platform: DeviceNotificationPlatform,
    extractorVersion: z.number().int(),
    appId: z.string(),
    appName: z.string(),
    sourceKey: z.string(),
    threadId: z.string().nullable(),
    threadTitle: z.string().nullable(),
    kind: DeviceNotificationKind,
    postedAt: z.number().int(),
    capturedAt: z.number().int(),
    title: z.string().nullable(),
    subtitle: z.string().nullable(),
    body: z.string().nullable(),
    lines: z.array(z.string()),
    redacted: z.boolean(),
    scrubbed: z.boolean(),
    backfilled: z.boolean(),
    contentHash: z.string(),
    android: z
      .object({
        channelId: z.string().nullable(),
        category: z.string().nullable(),
        whenAt: z.number().int(),
        shortcutId: z.string().nullable(),
      })
      .nullable(),
    messages: z
      .array(DeviceNotificationMessageOut)
      .describe(
        'Messages first stored with this notification, oldest first. A message already stored with an earlier notification is not repeated.',
      ),
    removal: DeviceNotificationRemovalOut.nullable(),
    receivedAt: z.number().int().describe('When the server stored it, Unix ms.'),
    expiresAt: z.number().int().describe('When the server deletes it, Unix ms.'),
  })
  .meta({ id: 'DeviceNotificationOut', description: 'A synced notification.' });
/** Notification value. */
export type DeviceNotificationOut = z.infer<typeof DeviceNotificationOut>;

/** One page of synced notifications, newest first. */
export const DeviceNotificationListOut = z
  .object({
    items: z.array(DeviceNotificationOut).describe('Newest capture first.'),
    nextCursor: z
      .string()
      .nullable()
      .describe('Pass as `cursor` for the next page; null at the end.'),
  })
  .meta({ id: 'DeviceNotificationListOut', description: 'A page of synced notifications.' });
/** List value. */
export type DeviceNotificationListOut = z.infer<typeof DeviceNotificationListOut>;

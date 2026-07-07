/** Editable staff announcement draft fields. */
export interface NotificationAnnouncementDraft {
  /** Subject/title shared by the web and email previews. */
  readonly subject: string;
  /** Plain-text body used by web, email, SMS, and push previews. */
  readonly bodyText: string;
  /** Audience selector currently chosen by staff. */
  readonly audienceType: 'user' | 'users' | 'all_users' | 'segment';
  /** User id, comma-separated user ids, or segment key depending on {@link audienceType}. */
  readonly audienceValue: string;
  /** Requested delivery channels. */
  readonly channels: readonly ('web' | 'email' | 'sms' | 'push')[];
  /** Urgency lane. */
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  /** Reply routing policy. */
  readonly replyPolicy: 'none' | 'staff_inbox' | 'org_admins' | 'automation';
  /** Optional datetime-local value interpreted as the scheduled UTC send time. */
  readonly scheduledAt: string;
}

/** Create body sent to `/v1/notifications` by the staff console. */
export interface NotificationIntentCreateBody {
  /** Staff creates service announcements from this console. */
  readonly senderType: 'staff';
  /** Console v1 sends Docket service announcements only. */
  readonly category: 'service_announcement';
  /** Delivery urgency lane. */
  readonly priority: NotificationAnnouncementDraft['priority'];
  /** Audience selector. */
  readonly audience:
    | { readonly type: 'user'; readonly userId: string }
    | { readonly type: 'users'; readonly userIds: string[] }
    | { readonly type: 'all_users' }
    | { readonly type: 'segment'; readonly segment: NotificationAudienceSegment };
  /** Requested delivery channels. */
  readonly channels: NotificationAnnouncementDraft['channels'][number][];
  /** Shared notification title. */
  readonly subject: string;
  /** Shared plain-text notification body. */
  readonly body: { readonly text: string };
  /** Reply routing behavior. */
  readonly replyPolicy: NotificationAnnouncementDraft['replyPolicy'];
  /** Optional scheduled send time. */
  readonly scheduledAt?: string;
}

/** Convert form state into the notification intent create payload. */
export function notificationDraftToCreateInput(
  draft: NotificationAnnouncementDraft,
): NotificationIntentCreateBody {
  return {
    senderType: 'staff',
    category: 'service_announcement',
    priority: draft.priority,
    audience: audienceFromDraft(draft),
    channels: [...draft.channels],
    subject: draft.subject.trim(),
    body: { text: draft.bodyText.trim() },
    replyPolicy: draft.replyPolicy,
    ...(draft.scheduledAt.trim()
      ? { scheduledAt: datetimeLocalAsUtcIso(draft.scheduledAt.trim()) }
      : {}),
  };
}

function audienceFromDraft(
  draft: NotificationAnnouncementDraft,
): NotificationIntentCreateBody['audience'] {
  if (draft.audienceType === 'all_users') return { type: 'all_users' };
  if (draft.audienceType === 'segment') {
    return { type: 'segment', segment: segmentFromDraft(draft.audienceValue) };
  }
  if (draft.audienceType === 'users') {
    return {
      type: 'users',
      userIds: draft.audienceValue
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    };
  }
  return { type: 'user', userId: draft.audienceValue.trim() };
}

function segmentFromDraft(value: string): NotificationAudienceSegment {
  const trimmed = value.trim();
  return notificationAudienceSegments.includes(trimmed as NotificationAudienceSegment)
    ? (trimmed as NotificationAudienceSegment)
    : 'active_users';
}

function datetimeLocalAsUtcIso(value: string): string {
  const withSeconds = value.length === 'YYYY-MM-DDTHH:MM'.length ? `${value}:00` : value;
  return new Date(`${withSeconds}.000Z`).toISOString();
}
/** Staff-selectable audience segments for service announcements. */
export const notificationAudienceSegments = [
  'active_users',
  'trial_users',
  'billing_admins',
  'users_with_bounced_email',
  'users_without_verified_phone',
] as const;

type NotificationAudienceSegment = (typeof notificationAudienceSegments)[number];

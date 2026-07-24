import type { contactPoint as contactPointTable, Database } from '@docket/db';
import { contactPoint, notificationPreference } from '@docket/db';
import {
  categoryAllowsChannel,
  lockedPreference,
  notificationPreferenceAllowsChannel,
  notificationQuietHoursActive,
  type NotificationChannel,
  type NotificationChannelDecision,
  type NotificationDestinationType,
  type NotificationPreferenceResolutionInput,
  type NotificationResolvedDestination,
  type NotificationSuppression,
} from '@docket/notifications';
import { eq } from 'drizzle-orm';

type ContactPointRow = typeof contactPointTable.$inferSelect;

/** How channel resolution treats user-managed notification preference toggles. */
export type NotificationPreferenceMode = 'respect_user_preferences' | 'skip_user_preferences';

/** Resolves channel preferences and destination health for one notification recipient. */
export async function resolveNotificationPreferences(
  db: Database,
  input: NotificationPreferenceResolutionInput,
  mode: NotificationPreferenceMode = 'respect_user_preferences',
): Promise<readonly NotificationChannelDecision[]> {
  const [preference] = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, input.userId))
    .limit(1);
  const contactPoints = await db
    .select()
    .from(contactPoint)
    .where(eq(contactPoint.userId, input.userId));
  const timezone = preference?.timezone ?? 'UTC';
  const quietHoursActive = notificationQuietHoursActive(
    preference?.quietHours,
    timezone,
    input.now ?? new Date(),
  );

  return Object.freeze(
    input.channels.map((channel) =>
      resolveChannel({
        input,
        channel,
        preference,
        contactPoints,
        quietHoursActive,
        mode,
      }),
    ),
  );
}

function resolveChannel({
  input,
  channel,
  preference,
  contactPoints,
  quietHoursActive,
  mode,
}: {
  readonly input: NotificationPreferenceResolutionInput;
  readonly channel: NotificationChannel;
  readonly preference: typeof notificationPreference.$inferSelect | undefined;
  readonly contactPoints: readonly ContactPointRow[];
  readonly quietHoursActive: boolean;
  readonly mode: NotificationPreferenceMode;
}): NotificationChannelDecision {
  if (!categoryAllowsChannel(input.category, channel)) {
    return suppressed(channel, null, 'category_disallows_channel');
  }

  const preferenceAllows =
    mode === 'skip_user_preferences' ||
    notificationPreferenceAllowsChannel({
      category: input.category,
      channel,
      organizationId: input.organizationId,
      preferences: preference
        ? { categories: preference.categories, organizations: preference.organizations }
        : null,
    });
  if (!preferenceAllows) return suppressed(channel, null, 'user_disabled_channel');

  const destination = resolveDestination(channel, contactPoints);
  if (destination.decision) return destination.decision;

  if (mode === 'respect_user_preferences' && quietHoursActive && !canBypassQuietHours(input)) {
    return {
      channel,
      decision: 'delay',
      destination: destination.destination,
      suppression: { reason: 'quiet_hours', channel, detail: 'Held by quiet hours' },
    };
  }

  return { channel, decision: 'send', destination: destination.destination };
}

function resolveDestination(
  channel: NotificationChannel,
  contactPoints: readonly ContactPointRow[],
):
  | { readonly destination: NotificationResolvedDestination; readonly decision?: undefined }
  | {
      readonly destination: NotificationResolvedDestination | null;
      readonly decision: NotificationChannelDecision;
    } {
  if (channel === 'web') return { destination: { type: 'in_app' } };

  const type = contactPointTypeForChannel(channel);
  const matching = contactPoints.filter((point) => point.type === type);
  const active = matching.find((point) => point.status === 'active' && point.verifiedAt);
  if (active) return { destination: destinationFor(channel, active) };

  const bounced = matching.find((point) => point.status === 'bounced');
  if (bounced) {
    const destination = destinationFor(channel, bounced);
    return {
      destination,
      decision: suppressed(channel, destination, 'contact_point_bounced'),
    };
  }

  const unsubscribed = matching.find((point) => point.status === 'unsubscribed');
  if (unsubscribed) {
    const destination = destinationFor(channel, unsubscribed);
    return {
      destination,
      decision: suppressed(channel, destination, 'user_unsubscribed'),
    };
  }

  return {
    destination: null,
    decision: suppressed(channel, null, 'no_verified_contact_point'),
  };
}

function contactPointTypeForChannel(
  channel: Exclude<NotificationChannel, 'web'>,
): ContactPointRow['type'] {
  if (channel === 'email') return 'email';
  if (channel === 'sms') return 'phone';
  return 'push_token';
}

function destinationFor(
  channel: Exclude<NotificationChannel, 'web'>,
  point: ContactPointRow,
): NotificationResolvedDestination {
  return {
    type: destinationTypeForChannel(channel),
    contactPointId: point.id,
    valueMasked: point.valueMasked,
  };
}

function destinationTypeForChannel(
  channel: Exclude<NotificationChannel, 'web'>,
): NotificationDestinationType {
  if (channel === 'email') return 'email';
  if (channel === 'sms') return 'phone';
  return 'push_token';
}

function suppressed(
  channel: NotificationChannel,
  destination: NotificationResolvedDestination | null,
  reason: NotificationSuppression['reason'],
): NotificationChannelDecision {
  return {
    channel,
    decision: 'suppress',
    destination,
    suppression: { reason, channel },
  };
}

function canBypassQuietHours(input: NotificationPreferenceResolutionInput): boolean {
  return input.priority === 'urgent' || lockedPreference(input.category);
}

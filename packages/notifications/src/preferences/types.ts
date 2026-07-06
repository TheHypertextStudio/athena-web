import type {
  NotificationCategory,
  NotificationCategoryPreferences,
  NotificationChannel,
  NotificationDestinationType,
  NotificationPriority,
  NotificationOrganizationPreferences,
  NotificationQuietHours,
  NotificationSuppression,
} from '../schemas';

/** Stored notification preferences needed by channel resolution. */
export interface NotificationPreferenceSettings {
  /** Per-category channel settings. */
  readonly categories: NotificationCategoryPreferences;
  /** Per-organization category overrides. */
  readonly organizations: NotificationOrganizationPreferences;
}

/** Input for resolving one category/channel preference. */
export interface NotificationPreferenceAllowsChannelInput {
  /** Notification category being delivered. */
  readonly category: NotificationCategory;
  /** Requested delivery channel. */
  readonly channel: NotificationChannel;
  /** Organization context, when the notification is org-scoped. */
  readonly organizationId?: string | null;
  /** User preference settings. */
  readonly preferences?: Partial<NotificationPreferenceSettings> | null;
}

/** Quiet-hours settings accepted by resolver helpers, including readonly DB jsonb arrays. */
export interface NotificationQuietHoursSettings {
  /** Whether quiet hours are active. */
  readonly enabled: boolean;
  /** Local start time in HH:MM. */
  readonly start: string;
  /** Local end time in HH:MM. */
  readonly end: string;
  /** Local weekdays where quiet hours apply. */
  readonly days: readonly NotificationQuietHours['days'][number][];
  /** Whether urgent notifications may bypass quiet hours. */
  readonly allowUrgent?: boolean;
}

/** Input for quiet-hours evaluation. */
export interface NotificationQuietHoursInput {
  /** Quiet-hours window to evaluate. */
  readonly quietHours: NotificationQuietHoursSettings | null | undefined;
  /** IANA timezone used to interpret the user's local clock. */
  readonly timezone: string;
  /** Instant to evaluate. */
  readonly now: Date;
}

/** Destination selected for a resolved notification channel. */
export interface NotificationResolvedDestination {
  /** Destination type used by the eventual delivery row. */
  readonly type: NotificationDestinationType;
  /** Masked destination shown in operational views. */
  readonly valueMasked?: string;
  /** Contact point used by the delivery, when applicable. */
  readonly contactPointId?: string;
}

/** Per-channel result produced by preference/contact-point resolution. */
export interface NotificationChannelDecision {
  /** Requested delivery channel. */
  readonly channel: NotificationChannel;
  /** Whether the delivery can send now, is delayed, or is suppressed. */
  readonly decision: 'send' | 'delay' | 'suppress';
  /** Destination selected for the delivery, if any. */
  readonly destination: NotificationResolvedDestination | null;
  /** Explicit reason when a delivery is delayed or suppressed. */
  readonly suppression?: NotificationSuppression;
}

/** Input for resolving channel decisions for one recipient. */
export interface NotificationPreferenceResolutionInput {
  /** Recipient user id. */
  readonly userId: string;
  /** Organization context, when the notification is org-scoped. */
  readonly organizationId?: string | null;
  /** Product category being delivered. */
  readonly category: NotificationCategory;
  /** Delivery urgency lane. */
  readonly priority: NotificationPriority;
  /** Requested channels to resolve. */
  readonly channels: readonly NotificationChannel[];
  /** Instant used for quiet-hours evaluation. */
  readonly now?: Date;
}

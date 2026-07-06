import type { Database } from '@docket/db';
import { notificationPreference } from '@docket/db';
import {
  defaultNotificationChannelPreference,
  lockedPreference,
  NotificationCategory,
  type NotificationCategoryPreferences,
  type NotificationChannelPreference,
  type NotificationOrganizationPreferences,
  type NotificationPreferenceOut,
  type NotificationPreferencePatch,
} from '@docket/notifications';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

type PreferenceRow = typeof notificationPreference.$inferSelect;
type PreferenceInsert = typeof notificationPreference.$inferInsert;

/** Database-backed service for caller-owned notification preferences. */
export class NotificationPreferenceService {
  constructor(private readonly db: Database) {}

  /** Return the caller's preferences, materializing the default row on first read. */
  async get(userId: string): Promise<z.input<typeof NotificationPreferenceOut>> {
    return toPreferenceOut(await this.ensurePreference(userId));
  }

  /** Patch caller-owned preferences and return the full materialized preference view. */
  async patch(
    userId: string,
    patch: z.input<typeof NotificationPreferencePatch>,
  ): Promise<z.input<typeof NotificationPreferenceOut>> {
    const current = await this.ensurePreference(userId);
    const next: PreferenceInsert = {
      userId,
      timezone: patch.timezone ?? current.timezone,
      quietHours: patch.quietHours ?? current.quietHours,
      categories: mergeCategoryPreferences(current.categories, patch.categories),
      organizations: mergeOrganizationPreferences(current.organizations, patch.organizations),
      updatedAt: new Date(),
    };

    const [updated] = await this.db
      .update(notificationPreference)
      .set(next)
      .where(eq(notificationPreference.userId, userId))
      .returning();
    if (!updated) throw new Error('Failed to update notification preferences');
    return toPreferenceOut(updated);
  }

  private async ensurePreference(userId: string): Promise<PreferenceRow> {
    const [existing] = await this.db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db.insert(notificationPreference).values({ userId }).returning();
    if (!created) throw new Error('Failed to create notification preferences');
    return created;
  }
}

function toPreferenceOut(row: PreferenceRow): z.input<typeof NotificationPreferenceOut> {
  return {
    userId: row.userId,
    timezone: row.timezone,
    quietHours: row.quietHours ? { ...row.quietHours, days: [...row.quietHours.days] } : null,
    categories: materializeCategoryPreferences(row.categories),
    organizations: sanitizeOrganizationPreferences(row.organizations),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function materializeCategoryPreferences(
  stored: NotificationCategoryPreferences,
): NotificationCategoryPreferences {
  return Object.fromEntries(
    NotificationCategory.options.map((category) => [
      category,
      lockedPreference(category)
        ? defaultNotificationChannelPreference(category)
        : {
            ...defaultNotificationChannelPreference(category),
            ...(stored[category] ?? {}),
          },
    ]),
  );
}

function mergeCategoryPreferences(
  current: NotificationCategoryPreferences,
  patch: NotificationCategoryPreferences | undefined,
): NotificationCategoryPreferences {
  const next = sanitizeCategoryPreferences(current);
  for (const [category, preference] of Object.entries(patch ?? {})) {
    const parsed = NotificationCategory.safeParse(category);
    if (!parsed.success || lockedPreference(parsed.data)) continue;
    next[parsed.data] = mergeChannelPreference(next[parsed.data], preference);
  }
  return next;
}

function mergeOrganizationPreferences(
  current: NotificationOrganizationPreferences,
  patch: NotificationOrganizationPreferences | undefined,
): NotificationOrganizationPreferences {
  const next = sanitizeOrganizationPreferences(current);
  for (const [organizationId, categories] of Object.entries(patch ?? {})) {
    const merged = mergeCategoryPreferences(next[organizationId] ?? {}, categories);
    if (Object.keys(merged).length > 0) next[organizationId] = merged;
  }
  return next;
}

function sanitizeOrganizationPreferences(
  preferences: NotificationOrganizationPreferences,
): NotificationOrganizationPreferences {
  return Object.fromEntries(
    Object.entries(preferences).flatMap(([organizationId, categories]) => {
      const sanitized = sanitizeCategoryPreferences(categories);
      return Object.keys(sanitized).length > 0 ? [[organizationId, sanitized]] : [];
    }),
  );
}

function sanitizeCategoryPreferences(
  preferences: NotificationCategoryPreferences,
): NotificationCategoryPreferences {
  return Object.fromEntries(
    Object.entries(preferences).flatMap(([category, preference]) => {
      const parsed = NotificationCategory.safeParse(category);
      if (!parsed.success || lockedPreference(parsed.data)) return [];
      return [[parsed.data, mergeChannelPreference(undefined, preference)]];
    }),
  );
}

function mergeChannelPreference(
  current: NotificationChannelPreference | undefined,
  patch: NotificationChannelPreference,
): NotificationChannelPreference {
  const safePatch = { ...patch };
  delete safePatch.locked;
  return { ...(current ?? {}), ...safePatch };
}

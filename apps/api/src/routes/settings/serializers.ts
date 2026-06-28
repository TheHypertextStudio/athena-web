/**
 * Settings route serializers.
 *
 * @packageDocumentation
 */

import type { userSettings } from '../../db/schema/index.js';

type UserSettingsRow = typeof userSettings.$inferSelect;

export function toSettingsResponse(settings: UserSettingsRow) {
  return {
    id: settings.id,
    userId: settings.userId,
    preferredName: settings.preferredName,
    timezone: settings.timezone,
    dailyPlanningTime: settings.dailyPlanningTime,
    dailyReviewTime: settings.dailyReviewTime,
    encryptionEnabled: settings.encryptionEnabled,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

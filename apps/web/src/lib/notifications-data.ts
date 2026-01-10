/**
 * Server-side data fetching for notification settings.
 *
 * @packageDocumentation
 */

import { cookies } from 'next/headers';
import { mapResponseToError } from './api-errors';

const API_BASE = process.env['API_URL'] ?? 'http://localhost:4000';

async function fetchWithAuth<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('better-auth.session_token');

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Cookie: sessionCookie ? `better-auth.session_token=${sessionCookie.value}` : '',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw await mapResponseToError(res);
  }

  return res.json() as Promise<T>;
}

// Types
export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  slackEnabled: boolean;
  inAppEnabled: boolean;
  emailAddress?: string;
  phoneNumber?: string;
  slackWebhookUrl?: string;
  slackChannel?: string;
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
  taskDeadlineReminders: boolean;
  taskAssignmentNotifications: boolean;
  taskCompletionNotifications: boolean;
  eventReminders: boolean;
  dailyPlanningReminder: boolean;
  weeklyReviewReminder: boolean;
}

// Data fetchers
export async function getNotificationPreferences(): Promise<{ data: NotificationPreferences }> {
  return fetchWithAuth('/api/notifications/preferences');
}

/**
 * Server-side data fetching for account settings.
 *
 * These functions run on the server and fetch data directly,
 * enabling streaming with Suspense boundaries.
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
export interface UserSettings {
  preferredName: string | null;
  timezone: string;
  dailyPlanningTime: string | null;
  dailyReviewTime: string | null;
  encryptionEnabled: boolean;
}

export interface AccountOverview {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  stats: {
    initiatives: number;
    projects: number;
    tasks: number;
    events: number;
  };
}

// Data fetchers
export async function getUserSettings(): Promise<{ data: UserSettings }> {
  return fetchWithAuth('/api/settings');
}

export async function getAccountOverview(): Promise<{ data: AccountOverview }> {
  return fetchWithAuth('/api/account');
}

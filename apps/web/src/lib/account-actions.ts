'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

const API_BASE = process.env['API_URL'] ?? 'http://localhost:4000';

async function fetchWithAuth<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('better-auth.session_token');

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: sessionCookie ? `better-auth.session_token=${sessionCookie.value}` : '',
  };

  // Merge additional headers if provided
  if (options?.headers) {
    const additionalHeaders = new Headers(options.headers);
    additionalHeaders.forEach((value, key) => {
      baseHeaders[key] = value;
    });
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: baseHeaders,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${String(res.status)}`);
  }

  return res.json() as Promise<T>;
}

export interface UpdateSettingsInput {
  preferredName?: string | null;
  timezone?: string;
  dailyPlanningTime?: string | null;
  dailyReviewTime?: string | null;
}

export async function updateSettings(data: UpdateSettingsInput) {
  await fetchWithAuth('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

  revalidatePath('/settings/account');
}

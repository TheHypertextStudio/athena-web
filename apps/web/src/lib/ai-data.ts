/**
 * Server-side data fetching for AI settings.
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
export type AIProvider = 'openai' | 'anthropic';

export interface AIPreferences {
  preferredProvider: AIProvider | null;
}

export interface AIProvidersInfo {
  providers: AIProvider[];
  default: AIProvider;
}

// Data fetchers
export async function getAIPreferences(): Promise<{ data: AIPreferences }> {
  return fetchWithAuth('/api/ai/preferences');
}

export async function getAIProviders(): Promise<{ data: AIProvidersInfo }> {
  return fetchWithAuth('/api/ai/providers');
}

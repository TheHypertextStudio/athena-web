/**
 * Server-side data fetching for integrations settings.
 *
 * @packageDocumentation
 */

import { cookies } from 'next/headers';
import { mapResponseToError } from './api-errors';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

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
export interface LinkedIntegration {
  id: string;
  provider: string;
  accountId: string;
  displayName: string | null;
  metadata: Record<string, unknown> | null;
  scopes: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// Data fetchers
export async function getIntegrations(): Promise<{ data: LinkedIntegration[] }> {
  return fetchWithAuth('/api/integrations');
}

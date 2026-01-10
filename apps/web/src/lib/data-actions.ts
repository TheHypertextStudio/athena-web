'use server';

import { cookies } from 'next/headers';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

async function fetchWithAuth<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('better-auth.session_token');

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: sessionCookie ? `better-auth.session_token=${sessionCookie.value}` : '',
  };

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

const ACCOUNT_DELETE_CONFIRMATION = 'DELETE_MY_ACCOUNT' as const;

export async function deleteAccount(confirmation: string) {
  if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    throw new Error('Invalid confirmation');
  }

  await fetchWithAuth('/api/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirmation }),
  });
}

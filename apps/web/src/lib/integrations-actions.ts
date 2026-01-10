'use server';

import { revalidatePath } from 'next/cache';
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

export async function disconnectIntegration(integrationId: string) {
  await fetchWithAuth(`/api/integrations/${integrationId}`, {
    method: 'DELETE',
  });

  revalidatePath('/settings/integrations');
}

export async function getOAuthUrl(
  provider: string,
  redirectUri: string,
): Promise<{ authorizationUrl: string }> {
  const result = await fetchWithAuth<{ data: { authorizationUrl: string } }>(
    `/api/integrations/oauth/${provider}/authorize?redirectUri=${encodeURIComponent(redirectUri)}`,
  );
  return { authorizationUrl: result.data.authorizationUrl };
}

/**
 * Server-side data fetching for security settings.
 *
 * These functions run on the server and fetch data directly,
 * enabling streaming with Suspense boundaries.
 *
 * @packageDocumentation
 */

import { cookies } from 'next/headers';
import { mapStatusToError } from './api-errors';

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
    throw mapStatusToError(res.status);
  }

  return res.json() as Promise<T>;
}

// Types
export interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
}

export interface Passkey {
  id: string;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
}

export interface BackupCodesInfo {
  hasBackupCodes: boolean;
  remainingCount: number;
  totalCount: number;
  lastGeneratedAt: string | null;
}

export interface Settings {
  encryptionEnabled: boolean;
}

// Data fetchers
export async function getSessions(): Promise<{ sessions: Session[]; count: number }> {
  return fetchWithAuth('/api/auth/sessions');
}

export async function getLinkedAccounts(): Promise<{ accounts: LinkedAccount[]; count: number }> {
  return fetchWithAuth('/api/auth/linked-accounts');
}

export async function getPasskeys(): Promise<{ passkeys: Passkey[]; count: number }> {
  return fetchWithAuth('/api/auth/passkeys');
}

export async function getBackupCodesInfo(): Promise<BackupCodesInfo> {
  return fetchWithAuth('/api/auth/backup-codes');
}

export async function getSettings(): Promise<{ data: Settings }> {
  return fetchWithAuth('/api/settings');
}

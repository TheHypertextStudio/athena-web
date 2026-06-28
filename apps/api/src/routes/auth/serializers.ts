/**
 * Auth route serializers.
 *
 * @packageDocumentation
 */

import type { accounts, passkeys, sessions } from '../../db/schema/auth.js';
import { getSessionStatus } from './helpers.js';

type SessionRow = typeof sessions.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;
type PasskeyRow = typeof passkeys.$inferSelect;
type SessionSummary = Pick<
  SessionRow,
  'id' | 'token' | 'ipAddress' | 'userAgent' | 'createdAt' | 'expiresAt' | 'lastActiveAt'
>;
type AccountSummary = Pick<AccountRow, 'id' | 'providerId' | 'accountId' | 'createdAt'>;
type PasskeySummary = Pick<PasskeyRow, 'id' | 'name' | 'deviceType' | 'backedUp' | 'createdAt'>;

interface BackupCodesInfo {
  hasBackupCodes: boolean;
  remainingCount: number;
  totalCount: number;
  generatedAt: Date | null;
}

export function toBackupCodesInfo(info: BackupCodesInfo) {
  return {
    hasBackupCodes: info.hasBackupCodes,
    remainingCount: info.remainingCount,
    totalCount: info.totalCount,
    generatedAt: info.generatedAt,
  };
}

export function toSession(session: SessionSummary, currentSessionToken: string | null) {
  const isCurrent = currentSessionToken !== null && session.token === currentSessionToken;

  return {
    id: session.id,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastActiveAt: session.lastActiveAt,
    status: getSessionStatus(session.lastActiveAt, isCurrent),
    isCurrent,
  };
}

export function buildSessionsResponse(
  userSessions: SessionSummary[],
  currentSessionToken: string | null,
) {
  const sessions = userSessions.map((session) => toSession(session, currentSessionToken));
  return { sessions, count: sessions.length };
}

export function toLinkedAccount(account: AccountSummary) {
  return {
    id: account.id,
    providerId: account.providerId,
    accountId: account.accountId,
    createdAt: account.createdAt,
  };
}

export function toPasskey(passkey: PasskeySummary) {
  return {
    id: passkey.id,
    name: passkey.name ?? null,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt,
  };
}

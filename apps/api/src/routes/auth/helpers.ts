/**
 * Auth route helpers.
 *
 * @packageDocumentation
 */

import { createHash, randomBytes } from 'crypto';

const INACTIVE_THRESHOLD_DAYS = 7;

export type SessionStatus = 'current' | 'recent' | 'inactive';

export function getSessionStatus(lastActiveAt: Date, isCurrent: boolean): SessionStatus {
  if (isCurrent) return 'current';

  const now = new Date();
  const diffDays = (now.getTime() - lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= INACTIVE_THRESHOLD_DAYS ? 'inactive' : 'recent';
}

/**
 * Generate a secure recovery token.
 * Returns the plain token (for the user) and the hashed version (for storage).
 */
export function generateRecoveryToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Calendar sync route helpers.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { env } from '../../lib/env.js';

export type CalendarSyncProvider = 'google' | 'outlook' | 'icloud' | 'caldav';

export const OAUTH_STATE_COOKIE = 'calendar_oauth_state';
const OAUTH_STATE_TTL_MINUTES = 10;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
export const OAUTH_STATE_TTL_SECONDS = OAUTH_STATE_TTL_MINUTES * SECONDS_PER_MINUTE;
const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_SECONDS * MILLISECONDS_PER_SECOND;
const OAUTH_STATE_NONCE_BYTES = 16;

export const ERROR_INVALID_STATE_TOKEN = 'Invalid state token';
export const ERROR_STATE_TOKEN_EXPIRED = 'State token expired';

interface OAuthStatePayload {
  provider: CalendarSyncProvider;
  issuedAt: number;
  nonce: string;
}

function getOAuthStateSecret(): string {
  return env.CALENDAR_OAUTH_STATE_SECRET ?? env.BETTER_AUTH_SECRET;
}

export function createOAuthState(provider: CalendarSyncProvider): string {
  const payload: OAuthStatePayload = {
    provider,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(OAUTH_STATE_NONCE_BYTES).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(state: string, provider: CalendarSyncProvider): void {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  const expectedSignature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encoded)
    .digest('base64url');

  const signatureValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  if (!signatureValid) {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as OAuthStatePayload;
  } catch {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  if (payload.provider !== provider) {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  if (Date.now() - payload.issuedAt > OAUTH_STATE_TTL_MS) {
    throw new Error(ERROR_STATE_TOKEN_EXPIRED);
  }
}

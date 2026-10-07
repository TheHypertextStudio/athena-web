/** Test signup request pacing against the real authentication rate limit. */
import type { Response } from '@playwright/test';

/** Only the response fields needed to pace and read a test signup request. */
type SignupCodeResponse = Pick<Response, 'status' | 'headers' | 'json'>;

/** Honor both Retry-After forms and allow the server's window to expire before retrying. */
function retryDelay(response: SignupCodeResponse): number {
  const header = response.headers()['retry-after'];
  const seconds = header === undefined || header.trim() === '' ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000 + 1_000;
  const until = header === undefined ? Number.NaN : Date.parse(header);
  return (Number.isFinite(until) ? Math.max(0, until - Date.now()) : 60_000) + 1_000;
}

/**
 * Read the local signup code, retrying the same request once after HTTP 429.
 * @param request - Repeat the unchanged browser submission and return its intercepted response.
 * @param pause - Wait for the server's Retry-After window.
 * @returns the development code, or undefined when a successful response does not echo one.
 */
export async function requestSignupCodeWithRateLimit(
  request: () => Promise<SignupCodeResponse>,
  pause: (milliseconds: number) => Promise<void>,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request();
    if (response.status() === 429) {
      if (attempt === 1) throw new Error('Signup stayed rate-limited after Retry-After elapsed.');
      await pause(retryDelay(response));
      continue;
    }
    const body: unknown = await response.json().catch(() => undefined);
    return typeof body === 'object' &&
      body !== null &&
      'devCode' in body &&
      typeof body.devCode === 'string'
      ? body.devCode
      : undefined;
  }
  return undefined;
}

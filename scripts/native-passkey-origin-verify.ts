/** Verify that deployed auth accepts every configured Android WebAuthn application origin. */
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const NATIVE_ORIGIN_PATTERN = /^android:apk-key-hash:[A-Za-z0-9_-]+$/;

/** Configuration for the deployed native-origin verification. */
export interface NativePasskeyOriginVerificationOptions {
  readonly apiOrigin: string;
  readonly nativeOrigins: readonly string[];
}

/** Sanitized result for one configured Android origin. */
export interface NativePasskeyOriginCheck {
  readonly origin: string;
  readonly passed: boolean;
  readonly status: number | null;
  readonly code: string;
}

/** Sanitized aggregate result for the native passkey origin verification. */
export interface NativePasskeyOriginVerificationReport {
  readonly passed: boolean;
  readonly checks: readonly NativePasskeyOriginCheck[];
}

/**
 * Parse and validate the deployment's native WebAuthn origin allowlist.
 *
 * @param raw - Comma-separated Android application origins.
 * @returns Trimmed, unique native origins.
 * @throws When the allowlist is empty or contains a non-Android origin.
 */
export function parseNativePasskeyOrigins(raw: string): string[] {
  const origins = raw.split(',').map((origin) => origin.trim());
  if (origins.length === 1 && origins[0] === '') {
    throw new Error('Expected at least one native passkey origin');
  }
  for (const origin of origins) {
    if (!NATIVE_ORIGIN_PATTERN.test(origin)) {
      throw new Error(`Invalid native passkey origin: ${origin === '' ? '(empty)' : origin}`);
    }
  }
  return [...new Set(origins)];
}

function responseCode(responseBody: string): string {
  try {
    const body: unknown = JSON.parse(responseBody);
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
      return body.code;
    }
  } catch {
    // A non-JSON response is represented by a stable code below, never copied into the report.
  }
  return 'UNEXPECTED_RESPONSE';
}

function cookiePair(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  const pair = setCookie?.split(';', 1)[0]?.trim();
  return pair?.includes('=') === true ? pair : null;
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 60_000);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyOrigin(
  fetcher: Fetcher,
  apiOrigin: string,
  origin: string,
): Promise<NativePasskeyOriginCheck> {
  const generateUrl = `${apiOrigin}/api/auth/passkey/generate-authenticate-options`;
  const verifyUrl = `${apiOrigin}/api/auth/passkey/verify-authentication`;
  try {
    const challenge = await fetchWithTimeout(fetcher, generateUrl, {
      headers: { 'user-agent': 'Docket native passkey origin verification' },
    });
    const challengeCookie = cookiePair(challenge);
    if (challenge.status !== 200 || challengeCookie === null) {
      return {
        origin,
        passed: false,
        status: challenge.status,
        code: challengeCookie === null ? 'CHALLENGE_COOKIE_MISSING' : 'CHALLENGE_REQUEST_FAILED',
      };
    }

    const verification = await fetchWithTimeout(fetcher, verifyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: challengeCookie,
        origin,
        'user-agent': 'Docket native passkey origin verification',
      },
      body: JSON.stringify({ response: { id: 'docket-native-origin-deployment-probe' } }),
    });
    const code = responseCode(await verification.text());
    return {
      origin,
      passed: verification.status === 401 && code === 'PASSKEY_NOT_FOUND',
      status: verification.status,
      code,
    };
  } catch {
    return { origin, passed: false, status: null, code: 'NETWORK_ERROR' };
  }
}

/**
 * Prove each configured Android origin passes Better Auth's request-origin middleware and reaches
 * the passkey lookup. A deliberately nonexistent credential makes the probe read-only with respect
 * to user accounts while still traversing the deployed authentication path.
 *
 * @param fetcher - Fetch implementation. Tests supply a deterministic boundary double.
 * @param options - Deployed API origin and validated Android origins.
 * @returns A sanitized report that never contains cookies or provider response messages.
 */
export async function verifyNativePasskeyOrigins(
  fetcher: Fetcher,
  options: NativePasskeyOriginVerificationOptions,
): Promise<NativePasskeyOriginVerificationReport> {
  const apiOrigin = options.apiOrigin.replace(/\/$/, '');
  const checks: NativePasskeyOriginCheck[] = [];
  for (const origin of options.nativeOrigins) {
    checks.push(await verifyOrigin(fetcher, apiOrigin, origin));
  }
  return { passed: checks.length > 0 && checks.every((check) => check.passed), checks };
}

async function main(): Promise<void> {
  const apiOrigin = process.env['API_URL'];
  if (!apiOrigin) throw new Error('API_URL is required');
  const nativeOrigins = parseNativePasskeyOrigins(
    process.env['BETTER_AUTH_PASSKEY_NATIVE_ORIGINS'] ?? '',
  );
  const report = await verifyNativePasskeyOrigins(fetch, { apiOrigin, nativeOrigins });
  for (const result of report.checks) {
    const status = result.status === null ? 'no response' : `HTTP ${String(result.status)}`;
    process.stdout.write(
      `${result.passed ? 'PASS' : 'FAIL'}\tnative-passkey-origin\t${result.origin}\t${status}\t${result.code}\n`,
    );
  }
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();

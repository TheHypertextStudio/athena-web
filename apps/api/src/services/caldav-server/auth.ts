/**
 * CalDAV/CardDAV Basic Auth middleware.
 *
 * Native calendar apps (iOS Calendar, macOS Calendar.app, etc.) use HTTP Basic Auth
 * with app-specific passwords. This middleware validates those credentials.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import * as crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { appPasswords, users } from '../../db/schema/index.js';
import { eq, and, or, isNull, gt } from 'drizzle-orm';

const SCRYPT_PARAMS = {
  N: 131072, // 2^17 - recommended for high-security scenarios
  r: 8,
  p: 1,
};

const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/**
 * Promisified scrypt with options support.
 */
function scryptAsync(
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Result from successful DAV authentication.
 */
export interface DavAuthResult {
  userId: string;
  email: string;
  scopes: string[];
  appPasswordId: string;
}

/**
 * Hash a password using scrypt.
 *
 * Format: `scrypt:N:r:p:salt:hash`
 * - N=2^17 (131072) - CPU/memory cost parameter
 * - r=8 - block size
 * - p=1 - parallelization
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const keylen = 64;

  const hash = await scryptAsync(password, salt, keylen, {
    ...SCRYPT_PARAMS,
    maxmem: SCRYPT_MAXMEM,
  });

  return [
    'scrypt',
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(':');
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const NStr = parts[1];
  const rStr = parts[2];
  const pStr = parts[3];
  const saltB64 = parts[4];
  const hashB64 = parts[5];

  if (!NStr || !rStr || !pStr || !saltB64 || !hashB64) {
    return false;
  }

  const N = parseInt(NStr, 10);
  const r = parseInt(rStr, 10);
  const p = parseInt(pStr, 10);
  const salt = Buffer.from(saltB64, 'base64');
  const expectedHash = Buffer.from(hashB64, 'base64');

  const hash = await scryptAsync(password, salt, expectedHash.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });

  return crypto.timingSafeEqual(hash, expectedHash);
}

/**
 * Generate an app-specific password.
 *
 * Format: xxxx-xxxx-xxxx-xxxx (lowercase alphanumeric for easy typing)
 */
export function generateAppPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const segments: string[] = [];

  for (let s = 0; s < 4; s++) {
    let segment = '';
    for (let c = 0; c < 4; c++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      const char = chars[randomIndex];
      if (char) {
        segment += char;
      }
    }
    segments.push(segment);
  }

  return segments.join('-');
}

/**
 * Authenticate a DAV request using Basic Auth.
 *
 * @returns Auth result if valid, null if invalid credentials
 */
export async function authenticateDav(c: Context): Promise<DavAuthResult | null> {
  const authHeader = c.req.header('authorization');

  if (!authHeader?.startsWith('Basic ')) {
    return null;
  }

  // Decode Base64 credentials
  const base64 = authHeader.slice(6);
  let decoded: string;
  try {
    decoded = Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return null;
  }

  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const email = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  // Find user by email
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    return null;
  }

  // Find valid app passwords for this user (not expired)
  const passwords = await db.query.appPasswords.findMany({
    where: and(
      eq(appPasswords.userId, user.id),
      or(isNull(appPasswords.expiresAt), gt(appPasswords.expiresAt, new Date())),
    ),
  });

  // Check each password (users typically have few app passwords)
  for (const appPass of passwords) {
    const valid = await verifyPassword(password, appPass.passwordHash);

    if (valid) {
      // Update last used timestamp (fire and forget - don't block auth)
      const clientIp = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
      db.update(appPasswords)
        .set({
          lastUsedAt: new Date(),
          lastUsedIp: clientIp ?? null,
        })
        .where(eq(appPasswords.id, appPass.id))
        .execute()
        .catch(() => {
          // Ignore update failures - don't break auth for audit logging
        });

      return {
        userId: user.id,
        email: user.email,
        scopes: appPass.scopes,
        appPasswordId: appPass.id,
      };
    }
  }

  return null;
}

/**
 * Middleware that requires DAV authentication with a specific scope.
 *
 * @param requiredScope - The scope required for access ('caldav' or 'carddav')
 */
export function requireDavAuth(requiredScope: 'caldav' | 'carddav') {
  return async (c: Context, next: Next): Promise<void> => {
    const auth = await authenticateDav(c);

    if (!auth) {
      throw new HTTPException(401, {
        message: 'Unauthorized',
        res: new Response('Unauthorized', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Athena"',
            DAV: '1, 2, 3, calendar-access',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }),
      });
    }

    if (!auth.scopes.includes(requiredScope)) {
      throw new HTTPException(403, {
        message: 'Forbidden - insufficient scope',
      });
    }

    // Attach auth result to context for handlers
    c.set('davAuth', auth);
    c.set('userId', auth.userId);

    await next();
  };
}

/**
 * Get the DAV auth result from context.
 *
 * @throws HTTPException if not authenticated
 */
export function getDavAuth(c: Context): DavAuthResult {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  if (!auth) {
    throw new HTTPException(401, { message: 'Not authenticated' });
  }
  return auth;
}

/**
 * Authentication middleware for protected routes.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and, lt } from 'drizzle-orm';
import { auth } from '../lib/auth.js';
import { db } from '../db/index.js';
import { sessions } from '../db/schema/auth.js';

export interface AuthContext {
  userId: string;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
}

/** Minimum interval between lastActiveAt updates (5 minutes) */
const ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Update session's lastActiveAt if enough time has passed.
 * Only updates if lastActiveAt is older than the threshold to reduce database writes.
 */
async function updateSessionActivity(sessionId: string): Promise<void> {
  const now = new Date();
  const threshold = new Date(now.getTime() - ACTIVITY_UPDATE_INTERVAL_MS);

  // Only update if lastActiveAt is older than threshold (avoids write on every request)
  await db
    .update(sessions)
    .set({ lastActiveAt: now })
    .where(and(eq(sessions.id, sessionId), lt(sessions.lastActiveAt, threshold)));
}

/**
 * Middleware that requires authentication.
 * Attaches user info to context variables.
 */
export async function requireAuth(c: Context, next: Next): Promise<void> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  c.set('userId', session.user.id);
  c.set('session', session);

  // Update session activity (fire-and-forget, don't block the request)
  void updateSessionActivity(session.session.id);

  await next();
}

/**
 * Get the authenticated user ID from context.
 */
export function getUserId(c: Context): string {
  const userId = c.get('userId') as string | undefined;
  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  return userId;
}

/**
 * Get the current session from context.
 */
export function getSession(c: Context): Awaited<ReturnType<typeof auth.api.getSession>> {
  const session = c.get('session') as Awaited<ReturnType<typeof auth.api.getSession>> | undefined;
  if (!session) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  return session;
}

/**
 * Get the session token from the request.
 * Better Auth stores the session token in a cookie named 'better-auth.session_token'.
 * The cookie value format is `{token}.{signature}` - we extract just the token part.
 */
export function getSessionToken(c: Context): string | null {
  const cookieHeader = c.req.header('cookie');
  if (!cookieHeader) {
    return null;
  }

  // Parse cookies to find the session token
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith('better-auth.session_token=')) {
      let rawValue = cookie.slice('better-auth.session_token='.length);
      // Decode URL-encoded cookie value
      try {
        rawValue = decodeURIComponent(rawValue);
      } catch {
        // Use raw value if decoding fails
      }
      // Extract just the token part (before the signature)
      // Cookie format: {token}.{signature}
      const dotIndex = rawValue.indexOf('.');
      if (dotIndex !== -1) {
        return rawValue.substring(0, dotIndex);
      }
      return rawValue;
    }
  }

  return null;
}

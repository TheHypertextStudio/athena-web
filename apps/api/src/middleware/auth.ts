/**
 * Authentication middleware for protected routes.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../lib/auth.js';

export interface AuthContext {
  userId: string;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
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

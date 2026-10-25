import { Hono } from 'hono';

import type { AppEnv } from '../context';

/**
 * Create the public domain ownership endpoint for the configured deployment.
 * @param token - The runtime challenge value; absent or empty disables verification.
 */
export function createOpenaiAppsChallengeRoutes(token: string | undefined): Hono<AppEnv> {
  return new Hono<AppEnv>().get('/.well-known/openai-apps-challenge', (c) => {
    c.header('Cache-Control', 'no-store');
    if (!token) return c.body(null, 404);
    return c.text(token);
  });
}

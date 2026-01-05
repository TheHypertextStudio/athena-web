/**
 * Authentication routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { auth } from '../lib/auth.js';

const authRoutes = new Hono();

/**
 * Handle all Better Auth requests.
 * Routes: /api/auth/*
 */
authRoutes.on(['GET', 'POST'], '/*', (c) => {
  return auth.handler(c.req.raw);
});

export { authRoutes };

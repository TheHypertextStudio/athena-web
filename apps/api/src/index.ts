/**
 * Athena API Server
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './lib/logger.js';
import { env } from './lib/env.js';
import { authRoutes } from './routes/auth.js';

const app = new Hono();

// CORS middleware
app.use(
  '*',
  cors({
    origin: [env.FRONTEND_URL],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Root endpoint
app.get('/', (c) => c.json({ message: 'Welcome to Athena API', version: '0.0.0' }));

// Mount auth routes
app.route('/api/auth', authRoutes);

const port = env.PORT;

logger.info(`Starting Athena API server on port ${String(port)}`);

export default {
  port,
  fetch: app.fetch,
};

export { app };

/**
 * Athena API Server
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { logger } from './lib/logger.js';
import { env } from './lib/env.js';

const app = new Hono();

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes will be added here
app.get('/', (c) => c.json({ message: 'Welcome to Athena API', version: '0.0.0' }));

const port = env.PORT;

logger.info(`Starting Athena API server on port ${String(port)}`);

export default {
  port,
  fetch: app.fetch,
};

export { app };

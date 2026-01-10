/**
 * Athena API Server
 *
 * @packageDocumentation
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { logger } from './lib/logger.js';
import { env } from './lib/env.js';
import { type AppEnv, setupOpenAPIDocs } from './lib/openapi.js';
import {
  requestLogger,
  securityHeaders,
  versionMiddleware,
  rateLimit,
  rateLimits,
} from './middleware/index.js';
import { authRoutes } from './routes/auth.js';
import { initiativeRoutes } from './routes/initiatives.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { eventRoutes } from './routes/events.js';
import { momentRoutes } from './routes/moments.js';
import { activityRoutes } from './routes/activities.js';
import { tagRoutes } from './routes/tags.js';
import { settingsRoutes } from './routes/settings.js';
import { billingRoutes } from './routes/billing.js';
import { timeTrackingRoutes } from './routes/time-tracking.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { agendaRoutes } from './routes/agenda.js';
import { accountRoutes } from './routes/account.js';
import { integrationRoutes } from './routes/integrations.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { aiRoutes } from './routes/ai.js';
import notificationRoutes from './routes/notifications.js';
import attachmentRoutes from './routes/attachments.js';
import searchRoutes from './routes/search.js';
import analyticsRoutes from './routes/analytics.js';
import bulkRoutes from './routes/bulk.js';
import webhooksRoutes from './routes/webhooks.js';
import auditRoutes from './routes/audit.js';
import calendarSyncRoutes from './routes/calendar-sync.js';
import mcpRoutes from './routes/mcp.js';
import { timeBlockRoutes } from './routes/time-blocks.js';
import { riscRoutes } from './routes/risc.js';
import { initializeRISCStream } from './services/risc/index.js';

const app = new OpenAPIHono<AppEnv>();

// Security headers (first, before any response)
app.use('*', securityHeaders('api'));

// Request logging (early to capture all requests)
app.use('*', requestLogger);

// API versioning
app.use('/api/*', versionMiddleware);

// CORS middleware
app.use(
  '*',
  cors({
    origin: [env.FRONTEND_URL],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept-Version', 'X-Request-ID'],
    exposeHeaders: [
      'X-Request-ID',
      'X-API-Version',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    credentials: true,
  }),
);

// Rate limiting (disabled in development)
if (env.NODE_ENV === 'production') {
  // Global rate limiting (100 requests per minute)
  app.use('/api/*', rateLimit(rateLimits.standard));

  // Stricter rate limits for auth endpoints
  app.use('/api/auth/*', rateLimit(rateLimits.auth));

  // Stricter rate limits for AI endpoints (expensive API calls)
  app.use('/api/ai/*', rateLimit(rateLimits.ai));
}

// Health check endpoint (no rate limiting)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Root endpoint
app.get('/', (c) => c.json({ message: 'Welcome to Athena API', version: '0.0.0' }));

// Mount routes
app.route('/api/auth', authRoutes);
app.route('/api/initiatives', initiativeRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/events', eventRoutes);
app.route('/api/moments', momentRoutes);
app.route('/api/activities', activityRoutes);
app.route('/api/tags', tagRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/billing', billingRoutes);
app.route('/api/time-tracking', timeTrackingRoutes);
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/agenda', agendaRoutes);
app.route('/api/account', accountRoutes);
app.route('/api/integrations', integrationRoutes);
app.route('/api/onboarding', onboardingRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/attachments', attachmentRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/bulk', bulkRoutes);
app.route('/api/webhooks', webhooksRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/calendar-sync', calendarSyncRoutes);
app.route('/api/time-blocks', timeBlockRoutes);
app.route('/api/risc', riscRoutes);
app.route('/mcp', mcpRoutes);

// Setup OpenAPI documentation endpoints
// - /api/openapi.json - Raw OpenAPI spec
// - /api/docs - Scalar interactive documentation
setupOpenAPIDocs(app);

const port = env.PORT;
const shouldServe = process.env['NODE_ENV'] !== 'test' && !process.env['VITEST'];

if (shouldServe) {
  logger.info(`Starting Athena API server on port ${String(port)}`);

  serve({
    fetch: app.fetch,
    port,
  });

  // Initialize RISC stream for Cross-Account Protection
  // This registers our webhook with Google and enables security event notifications
  if (env.riscConfig) {
    initializeRISCStream()
      .then(() => {
        logger.info('[RISC] Stream initialized successfully');
      })
      .catch((err: unknown) => {
        logger.error(
          { error: err instanceof Error ? err.message : 'Unknown error' },
          '[RISC] Stream initialization failed',
        );
      });
  }
}

export default {
  port,
  fetch: app.fetch,
};

export { app };

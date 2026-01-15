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
import { handleError, notFoundHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { initiativeRoutes } from './routes/initiatives.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { taskStatusRoutes } from './routes/task-statuses.js';
import { initiativeStatusRoutes } from './routes/initiative-statuses.js';
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
import { davRoutes } from './routes/dav.js';
import { appPasswordRoutes } from './routes/app-passwords.js';
import { googleCalendarWebhookRoutes } from './routes/webhooks/google-calendar.js';
import { outlookCalendarWebhookRoutes } from './routes/webhooks/outlook-calendar.js';

const app = new OpenAPIHono<AppEnv>();

// Centralized error handling for all routes
app.onError((error, c) => handleError(error, c));

// Security headers (first, before any response)
app.use('*', securityHeaders('api'));

// Request logging (early to capture all requests)
app.use('*', requestLogger);

// API versioning
app.use('/api/*', versionMiddleware);

// CORS middleware - applied to non-DAV routes only
// DAV routes handle their own CORS/OPTIONS with CalDAV-specific headers
const corsConfig = {
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
};

// Apply CORS to API routes
app.use('/api/*', cors(corsConfig));

// Apply CORS to auth routes (outside /api namespace)
app.use('/auth/*', cors(corsConfig));

// Apply CORS to well-known routes
app.use('/.well-known/*', cors(corsConfig));

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
app.get('/', (c) => {
  const accept = c.req.header('accept') ?? '';
  const auth = c.req.header('authorization');

  // CalDAV clients requesting calendar data
  if (accept.includes('text/calendar') || accept.includes('text/vcard')) {
    // If credentials provided, redirect to DAV endpoint which handles auth
    if (auth?.startsWith('Basic ')) {
      return c.redirect('/dav/', 307); // 307 preserves method and headers
    }
    // No credentials - prompt for auth
    return c.text('Authentication required', 401, {
      'WWW-Authenticate': 'Basic realm="Athena CalDAV"',
      DAV: '1, 2, 3, calendar-access',
    });
  }

  return c.json({ message: 'Welcome to Athena API', version: '0.0.0' }, 200, {
    DAV: '1, 2, 3, calendar-access',
  });
});

// Root OPTIONS - Required for CalDAV client discovery (RFC 6764)
app.options('/', (c) => {
  return c.text('', 200, {
    DAV: '1, 2, 3, calendar-access',
    Allow: 'OPTIONS, GET, HEAD, PROPFIND',
    'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PROPFIND',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth',
    'Access-Control-Allow-Origin': '*',
  });
});

// Root PROPFIND - CalDAV discovery (RFC 6764)
// Use 308 (Permanent Redirect) to preserve the PROPFIND method
app.on('PROPFIND', '/', (c) => {
  return c.redirect('/dav/', 308);
});

// CalDAV/CardDAV well-known redirects (RFC 6764)
// These allow calendar apps to discover the DAV endpoint from just the domain
// Handle both GET and PROPFIND as some clients use either method
// GET uses 301 (permanent redirect), PROPFIND uses 308 (preserves method)
app.get('/.well-known/caldav', (c) => c.redirect('/dav/', 301));
app.get('/.well-known/carddav', (c) => c.redirect('/dav/', 301));
app.on('PROPFIND', '/.well-known/caldav', (c) => c.redirect('/dav/', 308));
app.on('PROPFIND', '/.well-known/carddav', (c) => c.redirect('/dav/', 308));

// Fallback CalDAV discovery paths (various calendar clients try these)
// /principals/* - Some clients look for principals at root level
app.on('PROPFIND', '/principals/*', (c) => {
  const subPath = c.req.path.replace('/principals', '');
  return c.redirect(`/dav/principals${subPath}`, 308);
});
app.on('PROPFIND', '/principals', (c) => c.redirect('/dav/principals/', 308));

// /calendar/* - Some clients (like macOS Calendar.app) try this pattern
app.on('PROPFIND', '/calendar/*', (c) => c.redirect('/dav/', 308));
app.on('PROPFIND', '/calendar', (c) => c.redirect('/dav/', 308));

// /calendars/* - Direct calendar access attempts
app.on('PROPFIND', '/calendars/*', (c) => {
  const subPath = c.req.path.replace('/calendars', '');
  return c.redirect(`/dav/calendars${subPath}`, 308);
});
app.on('PROPFIND', '/calendars', (c) => c.redirect('/dav/calendars/', 308));

// Mount CalDAV routes (uses its own Basic Auth, not session auth)
app.route('/dav', davRoutes);

// Mount inbound webhook receivers for external calendar providers (no auth required)
// These receive push notifications from Google Calendar and Microsoft Outlook
app.route('/webhooks/google-calendar', googleCalendarWebhookRoutes);
app.route('/webhooks/outlook-calendar', outlookCalendarWebhookRoutes);

// Mount routes
app.route('/api/auth', authRoutes);
app.route('/api/initiatives', initiativeRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/task-statuses', taskStatusRoutes);
app.route('/api/initiative-statuses', initiativeStatusRoutes);
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
app.route('/api/app-passwords', appPasswordRoutes);
app.route('/mcp', mcpRoutes);

// Setup OpenAPI documentation endpoints
// - /api/openapi.json - Raw OpenAPI spec
// - /api/docs - Scalar interactive documentation
setupOpenAPIDocs(app);

// 404 handler for unmatched routes
app.notFound(notFoundHandler());

const port = env.PORT;
const shouldServe = process.env.NODE_ENV !== 'test' && !process.env.VITEST;

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

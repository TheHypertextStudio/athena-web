#!/usr/bin/env tsx
/**
 * Generate OpenAPI spec to a JSON file.
 *
 * This script creates a minimal OpenAPIHono app with just the route definitions
 * (no middleware, no database) to extract the OpenAPI specification.
 *
 * Usage: pnpm generate:openapi
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAPIHono } from '@hono/zod-openapi';

// Import only the route DEFINITIONS (not the full routes with handlers)
// These have no runtime dependencies
import * as taskRouteDefinitions from '../src/routes/tasks.openapi.js';
import * as projectRouteDefinitions from '../src/routes/projects.openapi.js';
import * as eventRouteDefinitions from '../src/routes/events.openapi.js';
import * as initiativeRouteDefinitions from '../src/routes/initiatives.openapi.js';
import * as timeBlockRouteDefinitions from '../src/routes/time-blocks.openapi.js';
import * as settingsRouteDefinitions from '../src/routes/settings.openapi.js';
import * as accountRouteDefinitions from '../src/routes/account.openapi.js';
import * as billingRouteDefinitions from '../src/routes/billing.openapi.js';
import * as authRouteDefinitions from '../src/routes/auth.openapi.js';
import * as notificationsRouteDefinitions from '../src/routes/notifications.openapi.js';
import * as integrationsRouteDefinitions from '../src/routes/integrations.openapi.js';
import * as calendarSyncRouteDefinitions from '../src/routes/calendar-sync.openapi.js';
import * as tagsRouteDefinitions from '../src/routes/tags.openapi.js';
import * as aiRouteDefinitions from '../src/routes/ai.openapi.js';
import * as searchRouteDefinitions from '../src/routes/search.openapi.js';
import * as agendaRouteDefinitions from '../src/routes/agenda.openapi.js';
import * as activitiesRouteDefinitions from '../src/routes/activities.openapi.js';
import * as analyticsRouteDefinitions from '../src/routes/analytics.openapi.js';
import * as attachmentsRouteDefinitions from '../src/routes/attachments.openapi.js';
import * as auditRouteDefinitions from '../src/routes/audit.openapi.js';
import * as bulkRouteDefinitions from '../src/routes/bulk.openapi.js';
import * as momentsRouteDefinitions from '../src/routes/moments.openapi.js';
import * as onboardingRouteDefinitions from '../src/routes/onboarding.openapi.js';
import * as timeTrackingRouteDefinitions from '../src/routes/time-tracking.openapi.js';
import * as webhooksRouteDefinitions from '../src/routes/webhooks.openapi.js';
import * as workspacesRouteDefinitions from '../src/routes/workspaces.openapi.js';
import * as riscRouteDefinitions from '../src/routes/risc.openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper to prefix route paths
function prefixRoute<T extends { path: string }>(route: T, prefix: string): T {
  return {
    ...route,
    path: `${prefix}${route.path}`,
  };
}

// Helper to register all routes from a module with a given prefix
function registerRoutes(
  app: OpenAPIHono,
  routeDefinitions: Record<string, unknown>,
  prefix: string,
) {
  for (const [, route] of Object.entries(routeDefinitions)) {
    if (typeof route === 'object' && route !== null && 'method' in route && 'path' in route) {
      const prefixedRoute = prefixRoute(route as { path: string }, prefix);
      // Register a dummy handler - we only care about the route definition for the spec
      app.openapi(prefixedRoute, (c) => c.json({}) as never);
    }
  }
}

// Create a minimal app to register routes for spec extraction
const app = new OpenAPIHono();

// Register all route definitions with their prefixes
registerRoutes(app, taskRouteDefinitions, '/api/tasks');
registerRoutes(app, projectRouteDefinitions, '/api/projects');
registerRoutes(app, eventRouteDefinitions, '/api/events');
registerRoutes(app, initiativeRouteDefinitions, '/api/initiatives');
registerRoutes(app, timeBlockRouteDefinitions, '/api/time-blocks');
registerRoutes(app, settingsRouteDefinitions, '/api/settings');
registerRoutes(app, accountRouteDefinitions, '/api/account');
registerRoutes(app, billingRouteDefinitions, '/api/billing');
registerRoutes(app, authRouteDefinitions, '/api/auth');
registerRoutes(app, notificationsRouteDefinitions, '/api/notifications');
registerRoutes(app, integrationsRouteDefinitions, '/api/integrations');
registerRoutes(app, calendarSyncRouteDefinitions, '/api/calendar-sync');
registerRoutes(app, tagsRouteDefinitions, '/api/tags');
registerRoutes(app, aiRouteDefinitions, '/api/ai');
registerRoutes(app, searchRouteDefinitions, '/api/search');
registerRoutes(app, agendaRouteDefinitions, '/api/agenda');
registerRoutes(app, activitiesRouteDefinitions, '/api/activities');
registerRoutes(app, analyticsRouteDefinitions, '/api/analytics');
registerRoutes(app, attachmentsRouteDefinitions, '/api/attachments');
registerRoutes(app, auditRouteDefinitions, '/api/audit');
registerRoutes(app, bulkRouteDefinitions, '/api/bulk');
registerRoutes(app, momentsRouteDefinitions, '/api/moments');
registerRoutes(app, onboardingRouteDefinitions, '/api/onboarding');
registerRoutes(app, timeTrackingRouteDefinitions, '/api/time');
registerRoutes(app, webhooksRouteDefinitions, '/api/webhooks');
registerRoutes(app, workspacesRouteDefinitions, '/api/workspaces');
registerRoutes(app, riscRouteDefinitions, '/api/risc');

// Register OpenAPI document
app.doc('/api/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Athena API',
    version: '1.0.0',
    description: 'REST API for Project Athena - Personal productivity and task management',
  },
  tags: [
    { name: 'Auth', description: 'Authentication and session management' },
    { name: 'Tasks', description: 'Task management' },
    { name: 'Projects', description: 'Project management' },
    { name: 'Events', description: 'Calendar events and scheduling' },
    { name: 'Initiatives', description: 'High-level initiative tracking' },
    { name: 'Time Blocks', description: 'Time block scheduling' },
    { name: 'Tags', description: 'Tag management' },
    { name: 'Settings', description: 'User settings and preferences' },
    { name: 'Account', description: 'Account management' },
    { name: 'Billing', description: 'Subscription and billing' },
    { name: 'Integrations', description: 'Third-party integrations' },
    { name: 'Notifications', description: 'Push notifications' },
    { name: 'Calendar Sync', description: 'Calendar synchronization' },
    { name: 'AI', description: 'AI-powered features' },
    { name: 'Search', description: 'Global search functionality' },
    { name: 'Agenda', description: 'Daily and weekly agenda views' },
    { name: 'Activities', description: 'Activity streams and tracking' },
    { name: 'Analytics', description: 'Productivity metrics and analytics' },
    { name: 'Attachments', description: 'File attachments and uploads' },
    { name: 'Audit', description: 'Audit logs and tracking' },
    { name: 'Bulk', description: 'Bulk operations on tasks' },
    { name: 'Moments', description: 'Moment capture and journaling' },
    { name: 'Onboarding', description: 'User onboarding flow' },
    { name: 'Time Tracking', description: 'Time tracking and timers' },
    { name: 'Webhooks', description: 'Webhook management' },
    { name: 'Workspaces', description: 'Workspace management' },
    { name: 'RISC', description: 'Google Cross-Account Protection' },
  ],
});

// Extract the OpenAPI spec
const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: {
    title: 'Athena API',
    version: '1.0.0',
    description: 'REST API for Project Athena - Personal productivity and task management',
  },
});

// Write to file
const outputPath = resolve(__dirname, '../openapi.json');
writeFileSync(outputPath, JSON.stringify(spec, null, 2));

console.log(`✓ OpenAPI spec written to ${outputPath}`);

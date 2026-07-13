/**
 * `@docket/api` — the chained route compositions that define the RPC contracts.
 *
 * @remarks
 * Two separate typed surfaces, never mixed:
 * - **`AppType`** — the public product API under `/v1`, consumed by `apps/web` (and any
 *   future public client) via `hc<AppType>`.
 * - **`AdminAppType`** — the internal staff back-office under `/admin`, consumed ONLY by
 *   `apps/admin` via `hc<AdminAppType>`. Kept off `/v1` so it is neither in the public RPC
 *   type nor the public Scalar spec.
 *
 * Each method chain must never be broken — `*AppType = typeof routes` is what the Next apps
 * consume. Cross-cutting concerns (CORS, session, `/api/auth/*`, `/internal/*` machine edges,
 * health, openapi, docs) live in `server.ts` OUTSIDE these `routes` consts so they don't
 * pollute the typed client contracts.
 */
import { db } from '@docket/db';
import { Hono } from 'hono';

import agenda from './routes/agenda';
import config from './routes/config';
import connectedApps from './routes/connected-apps';
import { createContactPointRoutes } from './routes/contact-points';
import type { AppEnv } from './context';
import dailyPlan from './routes/daily-plan';
import hubRouter from './routes/hub';
import meAccount from './routes/me-account';
import meCalendar from './routes/me-calendar';
import meIdentities from './routes/me-identities';
import { createMeNotificationsRoutes } from './routes/me-notifications';
import meRecovery from './routes/me-recovery';
import meSessions from './routes/me-sessions';
import time from './routes/time';
import { createAdminRoutes } from './routes/admin';
import { createAdminNotificationRoutes } from './routes/admin-notifications';
import { createNotificationPreferenceRoutes } from './routes/notification-preferences';
import { createNotificationsRoutes } from './routes/notifications';
import oauthClients from './routes/oauth-clients';
import orgs from './routes/orgs';
import { requireAuth } from './permissions/require-auth';
import { AdminNotificationService } from './services/notifications/admin-service';
import { NotificationContactPointService } from './services/notifications/contact-point-service';
import { NotificationInboxService } from './services/notifications/inbox';
import { NotificationIntentService } from './services/notifications/intent-service';
import { NotificationPreferenceService } from './services/notifications/preference-service';

/** The `/v1` app instance (shared with `server.ts` for mounting + non-RPC routes). */
export const app = new Hono<AppEnv>().basePath('/v1');

/** The type of the `/v1` {@link app} instance (used to type the OpenAPI generator input). */
export type AppInstance = typeof app;

// Defense-in-depth authentication: gate EVERY `/v1` route on a session (except the public
// allowlist) before the route chain, so auth is opt-out, not opt-in. Registered before the
// `.route()` chain so it applies to all children; it does not participate in the `AppType`
// chain (membership/capability authz still layer on top per-route).
app.use('*', requireAuth);

const notificationInbox = new NotificationInboxService(db);
const notificationIntents = new NotificationIntentService(db);
const notificationPreferences = new NotificationPreferenceService(db);
const notificationContactPoints = new NotificationContactPointService(db);

/** The chained route tree; its type is the public RPC contract (consumed only via `typeof`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const routes = app
  .route('/config', config)
  .route('/orgs', orgs)
  .route('/notifications', createNotificationsRoutes(notificationInbox, notificationIntents))
  .route('/daily-plan', dailyPlan)
  .route('/agenda', agenda)
  .route('/time', time)
  .route('/hub', hubRouter)
  .route('/me/connected-apps', connectedApps)
  .route('/me/calendar', meCalendar)
  .route('/me/identities', meIdentities)
  .route('/me/notifications', createMeNotificationsRoutes(notificationInbox))
  .route(
    '/me/notification-preferences',
    createNotificationPreferenceRoutes(notificationPreferences),
  )
  .route('/me/contact-points', createContactPointRoutes(notificationContactPoints))
  .route('/me/account', meAccount)
  .route('/me/recovery-codes', meRecovery)
  .route('/me/sessions', meSessions)
  .route('/oauth/clients', oauthClients);

/** The public Hono RPC contract consumed by the web app via `hc<AppType>`. */
export type AppType = typeof routes;

/**
 * The internal staff back-office app, mounted at `/admin` (NOT `/v1`). It is gated by the
 * admin router's own `staffMiddleware` (session + staff role), so it needs no `requireAuth`.
 * Mounted on the root server in `server.ts`; excluded from the public `/v1` spec.
 */
export const adminApp = new Hono<AppEnv>();

/** The type of the {@link adminApp} instance (used to type its own OpenAPI generator input). */
export type AdminInstance = typeof adminApp;

const adminNotifications = new AdminNotificationService(db, notificationIntents);

/** The directly-composed staff router used by the root server and route-level tests. */
export const adminRouter = createAdminRoutes(createAdminNotificationRoutes(adminNotifications));

/** The chained admin route tree; its type is the admin RPC contract (`apps/admin` only). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const adminRoutes = adminApp.route('/admin', adminRouter);

/** The internal admin RPC contract consumed by `apps/admin` via `hc<AdminAppType>`. */
export type AdminAppType = typeof adminRoutes;

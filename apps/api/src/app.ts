/**
 * `@docket/api` — the chained route compositions that define the RPC contracts.
 *
 * @remarks
 * Two separate typed surfaces, never mixed:
 * - **`AppType`** — the public product API under `/v1`, consumed by `apps/web` (and any
 *   future public client) via `hc<AppType>` and `@docket/api/rpc-contract`.
 * - **`AdminAppType`** — the internal staff back-office under `/admin`, consumed ONLY by
 *   `apps/admin` via `hc<AdminAppType>` and `@docket/api/rpc-contract`. Kept off `/v1` so it is
 *   neither in the public RPC type nor the public Scalar spec.
 *
 * Each method chain must never be broken — `*AppType = typeof routes` is what the Next apps
 * consume. Cross-cutting concerns (CORS, session, `/api/auth/*`, `/internal/*` machine edges,
 * health, openapi, docs) live in `server.ts` OUTSIDE these `routes` consts so they don't
 * pollute the typed client contracts.
 */
import { db } from '@docket/db';
import { Hono } from 'hono';

import agenda from './routes/agenda';
import athenaMail from './routes/athena-mail';
import config from './routes/config';
import connectedApps from './routes/connected-apps';
import { createContactPointRoutes } from './routes/contact-points';
import { createPhoneNumberRoutes } from './routes/phone-numbers';
import { PhoneVerificationService } from './routes/phone-verification';
import { createVoiceRoutes } from './routes/voice-sessions';
import { getContainer } from './container';
import type { AppEnv } from './context';
import { bodyLimit } from 'hono/body-limit';
import { etag } from 'hono/etag';

import { cachePolicy } from './lib/cache-policy';
import { MAX_REQUEST_BYTES, rejectOversizedBody, safeMethodsOnly } from './lib/http-limits';
import { mediaTypes } from './lib/media-types';
import { idempotency } from './lib/idempotency';
import { preconditions } from './lib/preconditions';
import dailyPlan from './routes/daily-plan';
import scheduleWeek from './routes/schedule-week';
import directiveFeed from './routes/schedule-week-directive';
import hubRouter from './routes/hub';
import meAccount from './routes/me-account';
import elicitations, { webPushRoutes } from './routes/elicitations';
import meAthena from './routes/me-athena';
import meCalendar from './routes/me-calendar';
import meIdentities from './routes/me-identities';
import { createMeNotificationsRoutes } from './routes/me-notifications';
import meRecovery from './routes/me-recovery';
import meSessions from './routes/me-sessions';
import workLocation from './routes/work-location';
import lattice from './routes/lattice';
import personalAthena from './routes/personal-athena';
import mcpAppHostRoutes from './mcp/apps/host-routes';
import time from './routes/time';
import { createAdminRoutes } from './routes/admin';
import { createAdminNotificationRoutes } from './routes/admin-notifications';
import { createNotificationPreferenceRoutes } from './routes/notification-preferences';
import { createNotificationsRoutes } from './routes/notifications';
import oauthClients from './routes/oauth-clients';
import orgs from './routes/orgs';
import { authoritativeSessionMiddleware, sessionMiddleware } from './auth/session-middleware';
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

// Sessions are normally served from a signed cookie that can outlive the row by up to the cache
// window (see `SESSION_COOKIE_CACHE_MAX_AGE_S`). On these surfaces that staleness would be the
// bug rather than a momentary lag — signing a device out, deleting the account, minting recovery
// codes — so they re-resolve against the database. Registered BEFORE `requireAuth` so the gate
// below sees the authoritative answer too, and scoped narrowly: everything else keeps the cache.
for (const path of [
  '/me/sessions',
  '/me/sessions/*',
  '/me/account',
  '/me/account/*',
  '/me/recovery-codes',
  '/me/recovery-codes/*',
]) {
  app.use(path, authoritativeSessionMiddleware);
}

// Entity tags for every response, and `304` for a matching `If-None-Match`. Hono's own
// middleware rather than a hand-rolled one in the output helper: it hashes the finished body so
// it covers streaming and binary handlers too, and it strips the headers RFC 9110 §15.4.5 says a
// `304` must not carry — which the version this replaced did not. Scoped to safe methods,
// because `If-None-Match` on a `POST` must not turn a create into a `304`.
app.use('*', safeMethodsOnly(etag()));

// Reject a body larger than anything this API legitimately accepts, before it is buffered.
app.use('*', bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: rejectOversizedBody }));

// Negotiate before doing any work: a body this API cannot read, or an `Accept` it cannot
// satisfy, is the client's to fix and should not reach a handler as a 500.
app.use('*', mediaTypes);

// Every `/v1` body is one person's view of one workspace, and now carries an `ETag`. Saying so
// — `private, no-cache` plus a `Vary` naming the credentials — is what stops a cache from
// applying a heuristic lifetime to a validator-bearing response and reusing it for someone else.
app.use('*', cachePolicy);

// Defense-in-depth authentication: gate EVERY `/v1` route on a session (except the public
// allowlist) before the route chain, so auth is opt-out, not opt-in. Registered before the
// `.route()` chain so it applies to all children; it does not participate in the `AppType`
// chain (membership/capability authz still layer on top per-route).
app.use('*', requireAuth);

// Retry safety for creates. Registered after `requireAuth` because keys are scoped to the
// authenticated user, and before the route chain so every `POST` on `/v1` honors the
// `Idempotency-Key` header the published reference has always promised. A request without the
// header is unaffected.
app.use('*', idempotency);

/**
 * The `/v1` app behind the session middleware, for the precondition sub-request.
 *
 * @remarks
 * `sessionMiddleware` is registered on the **root server**, so `app.request(...)` on its own
 * enters `/v1` with no session and `requireAuth` rejects it — which the precondition middleware
 * would read as a stale tag and turn into a `412` for every conditional write outside the few
 * prefixes carrying `authoritativeSessionMiddleware` above.
 *
 * Built on first use rather than here, because `.route()` copies the sub-app's routes at call
 * time and the chain below has not been assembled yet.
 */
let selfWithSession: Hono<AppEnv> | undefined;

// Optimistic concurrency for writes. Resolves the target's current `ETag` by asking this same
// app for it, so the tag a write is checked against is the one a read actually hands out, for
// every resource, with no per-handler code. Only a request that sends `If-Match` pays for it.
app.use(
  '*',
  preconditions(async (url, init) => {
    selfWithSession ??= new Hono<AppEnv>().use('*', sessionMiddleware).route('/', app);
    return selfWithSession.request(url, init);
  }),
);

const notificationInbox = new NotificationInboxService(db);
const notificationIntents = new NotificationIntentService(db);
const notificationPreferences = new NotificationPreferenceService(db);
const notificationContactPoints = new NotificationContactPointService(db);
// Phone verification and voice both resolve their boundary adapters from the one container, so
// local runs use the capturing SMS double and the fixture realtime provider with no accounts.
// The port is passed as a thunk, like `createVoiceRoutes(() => getContainer().voice)` below:
// `sms` is a lazy container value specifically so a deploy that never sends SMS isn't blocked by
// credentials it doesn't have, and resolving it any earlier than the send itself would hand that
// failure to every caller — including the ones that only read a challenge back.
const createPhoneVerification = () =>
  new PhoneVerificationService({ sms: () => getContainer().sms });

/** The chained route tree; its type is the public RPC contract (consumed only via `typeof`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const routes = app
  .route('/config', config)
  .route('/orgs', orgs)
  .route('/notifications', createNotificationsRoutes(notificationInbox, notificationIntents))
  .route('/daily-plan', dailyPlan)
  .route('/schedule-week', scheduleWeek)
  .route('/directive', directiveFeed)
  .route('/agenda', agenda)
  .route('/time', time)
  .route('/hub', hubRouter)
  .route('/me/connected-apps', connectedApps)
  .route('/me/calendar', meCalendar)
  .route('/me/work-location', workLocation)
  .route('/me/identities', meIdentities)
  .route('/me/notifications', createMeNotificationsRoutes(notificationInbox))
  .route(
    '/me/notification-preferences',
    createNotificationPreferenceRoutes(notificationPreferences),
  )
  .route('/me/contact-points', createContactPointRoutes(notificationContactPoints))
  .route('/me/phone-numbers', createPhoneNumberRoutes(createPhoneVerification))
  // Registered before `/me/athena` so the more specific voice prefix is matched first.
  .route(
    '/me/athena/voice',
    createVoiceRoutes(() => getContainer().voice),
  )
  .route('/me/account', meAccount)
  .route('/me/athena', meAthena)
  .route('/me/elicitations', elicitations)
  .route('/me/web-push', webPushRoutes)
  .route('/me/recovery-codes', meRecovery)
  .route('/me/sessions', meSessions)
  .route('/me/athena', personalAthena)
  .route('/me/athena', lattice)
  // Athena's own inbox. Mounted at the same `/me/athena` prefix as the two routers above (Hono
  // composes sibling sub-apps on one prefix) so a received message reads as part of Athena rather
  // than as a separate mail product.
  .route('/me/athena/mail', athenaMail)
  // Docket's MCP Apps host: the browser asks these for a connected server's widget document and
  // for the tool calls a rendered widget issues, so no remote credential ever leaves this process.
  .route('/me/athena/mcp-apps', mcpAppHostRoutes)
  .route('/oauth/clients', oauthClients);

/** The public Hono RPC contract exported through `@docket/api/rpc-contract`. */
export type AppType = typeof routes;

/**
 * The internal staff back-office app, mounted at `/admin` (NOT `/v1`). It is gated by the
 * admin router's own `staffMiddleware` (session + staff role), so it needs no `requireAuth`.
 * Mounted on the root server in `server.ts`; excluded from the public `/v1` spec.
 */
export const adminApp = new Hono<AppEnv>();

// The staff back-office gets the same protocol treatment as the product surface: its data is no
// more cacheable than a tenant's own, and its requests negotiate the same way.
adminApp.use('*', safeMethodsOnly(etag()));
adminApp.use('*', bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: rejectOversizedBody }));
adminApp.use('*', mediaTypes);
adminApp.use('*', cachePolicy);

/** The type of the {@link adminApp} instance (used to type its own OpenAPI generator input). */
export type AdminInstance = typeof adminApp;

const adminNotifications = new AdminNotificationService(db, notificationIntents);

/** The directly-composed staff router used by the root server and route-level tests. */
export const adminRouter = createAdminRoutes(createAdminNotificationRoutes(adminNotifications));

/** The chained admin route tree; its type is the admin RPC contract (`apps/admin` only). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const adminRoutes = adminApp.route('/admin', adminRouter);

/** The internal admin RPC contract exported through `@docket/api/rpc-contract`. */
export type AdminAppType = typeof adminRoutes;

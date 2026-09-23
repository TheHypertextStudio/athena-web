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
import type { MiddlewareHandler } from 'hono';

import agenda from './routes/agenda';
import athenaMail from './routes/athena-mail';
import config from './routes/config';
import connectedApps from './routes/connected-apps';
import { createContactPointRoutes } from './routes/contact-points';
import { createPhoneNumberRoutes } from './routes/phone-numbers';
import { PhoneVerificationService } from './routes/phone-verification';
import { phoneVerificationEnabled } from './services/phone-verification-rollout';
import { createVoiceRoutes } from './routes/voice-sessions';
import { getContainer } from './container';
import { env } from './env';
import type { AppEnv } from './context';
import { bodyLimit } from 'hono/body-limit';

import { cachePolicy } from './lib/cache-policy';
import { finiteEtag } from './lib/finite-etag';
import { operationContractForRequest } from './lib/api-operation-contract';
import {
  MAX_DEVICE_NOTIFICATION_BATCH_BYTES,
  MAX_OBJECT_COMMAND_BYTES,
  MAX_REQUEST_BYTES,
  rejectOversizedBody,
  safeMethodsOnly,
} from './lib/http-limits';
import { mediaTypes } from './lib/media-types';
import { provenanceMiddleware } from './lib/provenance/rest-middleware';
import { idempotency } from './lib/idempotency';
import { conditionalWriteFor } from './lib/work-schedule-conditional';
import dailyPlan from './routes/daily-plan';
import dailyPlanReview from './routes/daily-plan-review';
import scheduleWeek from './routes/schedule-week';
import directiveFeed from './routes/schedule-week-directive';
import hubRouter from './routes/hub';
import meAccount from './routes/me-account';
import elicitations, { webPushRoutes } from './routes/elicitations';
import meAthena from './routes/me-athena';
import meCalendar from './routes/me-calendar';
import meIdentities from './routes/me-identities';
import { createMeNotificationsRoutes } from './routes/me-notifications';
import mePasskeys from './routes/me-passkeys';
import meDrafts from './routes/me-drafts';
import {
  meDeviceNotifications,
  meDeviceNotificationSources,
} from './routes/me-device-notifications';
import mePlans from './routes/me-plans';
import meRecovery from './routes/me-recovery';
import meSessions from './routes/me-sessions';
import workLocation from './routes/work-location';
import lattice from './routes/lattice';
import personalAthena from './routes/personal-athena';
import mcpAppHostRoutes from './mcp/apps/host-routes';
import time from './routes/time';
import { createAdminRoutes } from './routes/admin';
import { createAdminNotificationRoutes } from './routes/admin-notifications';
import { createNotificationIntentRoutes } from './routes/notification-intent-routes';
import { createNotificationPreferenceRoutes } from './routes/notification-preferences';
import oauthClients from './routes/oauth-clients';
import orgs from './routes/orgs';
import {
  authoritativeSessionMiddleware,
  replayOwnerSessionMiddleware,
} from './auth/session-middleware';
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
  '/me/passkeys',
  '/me/passkeys/*',
]) {
  app.use(path, authoritativeSessionMiddleware);
}

// Hash only completed finite representations. An SSE response stays open by design, so cloning
// it to compute a digest would hold the response until disconnect and prevent the first event
// from reaching the client. Weak If-None-Match comparison remains valid for these strong tags.
app.use('*', safeMethodsOnly(finiteEtag));

// Reject a body larger than anything this API legitimately accepts, before it is buffered.
app.use('*', bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: () => rejectOversizedBody() }));
app.use(
  '/orgs/:orgId/object-commands',
  bodyLimit({
    maxSize: MAX_OBJECT_COMMAND_BYTES,
    onError: () => rejectOversizedBody(MAX_OBJECT_COMMAND_BYTES),
  }),
);
// A phone answers 413 by halving its batch; see `MAX_DEVICE_NOTIFICATION_BATCH_BYTES`.
app.use(
  '/me/device-notifications/batches',
  bodyLimit({
    maxSize: MAX_DEVICE_NOTIFICATION_BATCH_BYTES,
    onError: () => rejectOversizedBody(MAX_DEVICE_NOTIFICATION_BATCH_BYTES),
  }),
);

// Every `/v1` body is one person's view of one workspace, and now carries an `ETag`. Saying so
// — `private, no-cache` plus a `Vary` naming the credentials — is what stops a cache from
// applying a heuristic lifetime to a validator-bearing response and reusing it for someone else.
app.use('*', cachePolicy);

// A queue-eligible live attempt or replay names its captured account. Resolve that claim against
// the live session before authentication, idempotency, or route authorization can use a cached identity.
// Headerless traffic stays on the normal signed-cookie cache path.
app.use('*', replayOwnerSessionMiddleware);

// Defense-in-depth authentication: gate EVERY `/v1` route on a session (except the public
// allowlist) before the route chain, so auth is opt-out, not opt-in. Registered before the
// `.route()` chain so it applies to all children; it does not participate in the `AppType`
// chain (membership/capability authz still layer on top per-route).
app.use('*', requireAuth);

// Every write below here records where it came from: the app surface for a session, the client
// for an OAuth token.
app.use('*', provenanceMiddleware);

// Strict contracts negotiate at their route-local declaration after org/resource guards. This
// temporary global adapter covers only declarations Task 4 has not migrated yet.
app.use('*', mediaTypes);

// Strict contracts install their declared receipt adapter after route guards. Legacy declarations
// retain the old global behavior only until Task 4 gives them an explicit policy.
const legacyIdempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (operationContractForRequest(c)) {
    return next();
  }
  return idempotency(c, next);
};
app.use('*', legacyIdempotency);

const transactionalScheduleWrite = /^\/v1\/me\/work-location\/schedule(?:\/dates\/[^/]+)?$/u;

// Work-schedule handlers compare the validator while holding their aggregate revision lock.
// Every other legacy declaration rejects If-Match instead of running the old self-GET check,
// whose read and mutation could race.
const legacyConditionalWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (operationContractForRequest(c)) {
    return next();
  }
  if (c.req.method === 'PUT' && transactionalScheduleWrite.test(c.req.path)) return next();
  return conditionalWriteFor(false)(c, next);
};
app.use('*', legacyConditionalWrites);

const notificationInbox = new NotificationInboxService(db);
const notificationIntents = new NotificationIntentService(db);
const notificationPreferences = new NotificationPreferenceService(db);
const notificationContactPoints = new NotificationContactPointService(db);
// Phone verification and voice resolve their boundary adapters from the one container. Local runs
// use capture providers, while production resolves Twilio only when a request needs it.
const createPhoneVerification = () =>
  new PhoneVerificationService({ provider: () => getContainer().phoneVerification });

function verificationAvailability(identity: {
  readonly email: string;
  readonly emailVerified: boolean;
}): {
  readonly available: boolean;
  readonly reason: 'rollout_restricted' | 'temporarily_unavailable' | null;
} {
  if (
    env.APP_MODE === 'production' &&
    !phoneVerificationEnabled(
      env.PHONE_VERIFICATION_ENABLED,
      env.PHONE_VERIFICATION_CANARY_EMAILS,
      identity,
    )
  ) {
    return { available: false, reason: 'rollout_restricted' };
  }
  try {
    createPhoneVerification().assertAvailable();
    return { available: true, reason: null };
  } catch {
    return { available: false, reason: 'temporarily_unavailable' };
  }
}

/** The chained route tree; its type is the public RPC contract (consumed only via `typeof`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const routes = app
  .route('/config', config)
  .route('/orgs', orgs)
  .route('/daily-plan', dailyPlan)
  .route('/daily-plan', dailyPlanReview)
  .route('/schedule-week', scheduleWeek)
  .route('/directive', directiveFeed)
  .route('/agenda', agenda)
  .route('/time', time)
  .route('/hub', hubRouter)
  .route('/me/connected-apps', connectedApps)
  .route('/me/calendar', meCalendar)
  .route('/me/work-location', workLocation)
  .route('/me/identities', meIdentities)
  .route('/me/passkeys', mePasskeys)
  .route(
    '/me/notifications/preferences',
    createNotificationPreferenceRoutes(notificationPreferences),
  )
  .route('/me/notifications', createMeNotificationsRoutes(notificationInbox))
  .route('/me/contact-points', createContactPointRoutes(notificationContactPoints))
  .route(
    '/me/phone-numbers',
    createPhoneNumberRoutes(createPhoneVerification, {
      telephony: () => getContainer().telephony,
      athenaNumber: () => env.TWILIO_PHONE_NUMBER ?? null,
      verificationAvailability,
    }),
  )
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
  .route('/me/plans', mePlans)
  .route('/me/drafts', meDrafts)
  .route('/me/device-notification-sources', meDeviceNotificationSources)
  .route('/me/device-notifications', meDeviceNotifications)
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
adminApp.use('*', safeMethodsOnly(finiteEtag));
adminApp.use('*', bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: () => rejectOversizedBody() }));
adminApp.use('*', mediaTypes);
adminApp.use('*', cachePolicy);

/** The type of the {@link adminApp} instance (used to type its own OpenAPI generator input). */
export type AdminInstance = typeof adminApp;

const adminNotifications = new AdminNotificationService(db, notificationIntents);

/** The directly-composed staff router used by the root server and route-level tests. */
export const adminRouter = createAdminRoutes(
  createAdminNotificationRoutes(adminNotifications).route(
    '/',
    createNotificationIntentRoutes(notificationIntents),
  ),
);

/** The chained admin route tree; its type is the admin RPC contract (`apps/admin` only). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const adminRoutes = adminApp.route('/admin', adminRouter);

/** The internal admin RPC contract exported through `@docket/api/rpc-contract`. */
export type AdminAppType = typeof adminRoutes;

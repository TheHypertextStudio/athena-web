/**
 * `@docket/api` — the chained route composition that defines the RPC `AppType`.
 *
 * @remarks
 * The method chain must never be broken — `AppType = typeof routes` is what the Next
 * apps consume via `hc<AppType>`. Cross-cutting concerns (CORS, session, `/api/auth/*`,
 * health, openapi, docs) live in `server.ts` OUTSIDE this `routes` const so they don't
 * pollute the typed client contract.
 */
import { Hono } from 'hono';

import admin from './routes/admin';
import config from './routes/config';
import connectedApps from './routes/connected-apps';
import type { AppEnv } from './context';
import dailyPlan from './routes/daily-plan';
import hubRouter from './routes/hub';
import meAccount from './routes/me-account';
import meIdentities from './routes/me-identities';
import meRecovery from './routes/me-recovery';
import notifications from './routes/notifications';
import orgs from './routes/orgs';

/** The `/v1` app instance (shared with `server.ts` for mounting + non-RPC routes). */
export const app = new Hono<AppEnv>().basePath('/v1');

/** The type of the `/v1` {@link app} instance (used to type the OpenAPI generator input). */
export type AppInstance = typeof app;

/** The chained route tree; its type is the RPC contract (consumed only via `typeof`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const routes = app
  .route('/config', config)
  .route('/orgs', orgs)
  .route('/notifications', notifications)
  .route('/daily-plan', dailyPlan)
  .route('/hub', hubRouter)
  .route('/admin', admin)
  .route('/me/connected-apps', connectedApps)
  .route('/me/identities', meIdentities)
  .route('/me/account', meAccount)
  .route('/me/recovery-codes', meRecovery);

/** The Hono RPC contract consumed by clients via `hc<AppType>`. */
export type AppType = typeof routes;

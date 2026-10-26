/**
 * `@docket/api` — what the deployment consumes and what it costs, for the operator back-office.
 *
 * @remarks
 * Groups the platform resource report, the Athena token report and the cost ledger under one mount
 * so the admin router composes one sub-router for the whole usage area.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../context';

import { adminAthenaUsageRoutes } from './admin-athena-usage-routes';
import { adminCostRoutes } from './admin-cost-routes';
import { adminResourceRoutes } from './admin-resource-routes';

/**
 * Sub-router for resource usage, Athena usage and cost.
 *
 * @remarks
 * Mounted under `/admin`, so every route here already runs behind `staffMiddleware`.
 */
export const adminUsageRoutes = new Hono<AppEnv>()
  .route('/resources', adminResourceRoutes)
  .route('/athena-usage', adminAthenaUsageRoutes)
  .route('/costs', adminCostRoutes);

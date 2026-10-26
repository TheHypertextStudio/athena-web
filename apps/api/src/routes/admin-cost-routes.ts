/**
 * `@docket/api` — what the deployment costs per person and workspace, and the prices behind it
 * (mounted at `/costs`).
 *
 * @remarks
 * Reads the usage ledger and prices it from the rate card at request time, so a changed price
 * reprices history. Every route needs the finance tier: these are the figures the business is run
 * on, and the rate card changes what every other figure says.
 */
import { db, usageRate } from '@docket/db';
import { desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  AdminCostDetailOut,
  AdminCostQuery,
  AdminCostsOut,
  AdminRate,
  AdminRatesOut,
  CreateRateBody,
} from '../admin-cost-dto';
import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';
import { buildCostDetail, buildCostReport, monthOf } from '../services/usage-cost/report';

import { audit } from './admin-serializers';

/** The holder key in a path. */
const holderParam = z.object({ key: z.string().min(1).max(200) });

/** A stored rate in the response shape. */
function toRate(row: typeof usageRate.$inferSelect): AdminRate {
  return {
    id: row.id,
    resource: row.resource,
    dimension: row.dimension,
    microsPerMillionUnits: row.microsPerMillionUnits,
    effectiveFrom: row.effectiveFrom.toISOString(),
    note: row.note,
  };
}

/**
 * Sub-router for usage cost.
 *
 * @remarks
 * Mounted under `/admin`, so every route here already runs behind `staffMiddleware`.
 */
export const adminCostRoutes = new Hono<AppEnv>()
  .get(
    '/',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Rank usage cost by person',
      response: AdminCostsOut,
      description: `Returns what the deployment's metered usage cost over one UTC month, grouped by who it belongs to and ranked largest first.

**Lens.** \`lens=caused\` groups by the person whose activity produced the usage; usage with no recorded person groups under its workspace, and usage with neither groups under \`unattributed\`. \`lens=pays\` groups by billing owner: AI usage belongs to the person who owns the session, and everything else in a workspace is split equally among the workspace's owners.

**Pricing.** Cost is computed now from the rate card in effect on each day. Usage with no applicable rate adds nothing to \`costMicros\` and sets \`hasUnpriced\`, so a figure with \`hasUnpriced\` is a floor.

**Meters.** \`meters\` reports when each ledger pass last completed. A stale meter means the figures above are missing recent usage.

**Access.** Finance tier or above. Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None.

**Related.** \`GET /admin/costs/holders/{key}\` for one holder's breakdown; \`GET /admin/costs/rates\` for the prices applied.`,
    }),
    zQuery(AdminCostQuery),
    async (c) => {
      const { month, lens } = c.req.valid('query');
      return ok(c, AdminCostsOut, await buildCostReport(month ?? monthOf(new Date()), lens));
    },
  )
  .get(
    '/holders/:key',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Get one holder usage cost',
      response: AdminCostDetailOut,
      description: `Returns one holder's cost for a month by resource, by workspace and by day, plus their cost across every day recorded.

**Key.** The \`key\` from \`GET /admin/costs\`: \`user:<id>\`, \`workspace:<id>\` or \`unattributed\`. A key with no recorded usage → \`404\`.

**Lens and pricing.** As \`GET /admin/costs\`.

**Access.** Finance tier or above. Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None.`,
    }),
    zParam(holderParam),
    zQuery(AdminCostQuery),
    async (c) => {
      const { key } = c.req.valid('param');
      const { month, lens } = c.req.valid('query');
      const detail = await buildCostDetail(key, month ?? monthOf(new Date()), lens);
      if (!detail) throw new NotFoundError('No usage recorded for this holder');
      return ok(c, AdminCostDetailOut, detail);
    },
  )
  .get(
    '/rates',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'List usage rates',
      response: AdminRatesOut,
      description: `Returns every price on the rate card, newest first.

**Behavior.** A rate is the price of one resource, optionally for one model, table or store, from \`effectiveFrom\` forward. The rate applied to a day of usage is the latest one in effect that day for the exact dimension, else the resource's general rate.

**Access.** Finance tier or above. Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None.`,
    }),
    async (c) => {
      const rows = await db.select().from(usageRate).orderBy(desc(usageRate.effectiveFrom));
      return ok(c, AdminRatesOut, { rates: rows.map(toRate) });
    },
  )
  .post(
    '/rates',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Add a usage rate',
      response: AdminRate,
      description: `Adds a price to the rate card.

**Behavior.** Rates are append-only. To correct a price, add a rate for the same resource and dimension with a later \`effectiveFrom\`; earlier days keep the price they were computed with. A rate with the same resource, dimension and \`effectiveFrom\` as an existing one → \`409\`.

**Access.** Finance tier or above. Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** Writes a \`usage_rate.created\` operator audit event.`,
    }),
    zJson(CreateRateBody),
    async (c) => {
      const body = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const rows = await db
        .insert(usageRate)
        .values({
          resource: body.resource,
          dimension: body.dimension,
          microsPerMillionUnits: body.microsPerMillionUnits,
          effectiveFrom: new Date(body.effectiveFrom),
          note: body.note ?? null,
          createdBy: staffUserId,
        })
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      if (!row)
        throw new ConflictError('A rate already exists for this resource, dimension and date');
      await audit(db, staffUserId, 'usage_rate.created', 'usage_rate', row.id, {
        resource: row.resource,
        dimension: row.dimension,
        microsPerMillionUnits: row.microsPerMillionUnits,
        effectiveFrom: row.effectiveFrom.toISOString(),
      });
      return created(c, AdminRate, toRate(row), null);
    },
  );

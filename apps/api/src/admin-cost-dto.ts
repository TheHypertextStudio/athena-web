/**
 * `@docket/api` — request and response shapes for the operator cost reports.
 *
 * @remarks
 * Costs are reported in millionths of a US dollar so no figure passes through floating point on the
 * way to the screen. A cost the rate card cannot price is reported alongside `hasUnpriced`, never as
 * zero.
 */
import { USAGE_METERS, USAGE_RESOURCES } from '@docket/db';
import { z } from 'zod';

/** Which question a cost report answers. */
export const CostLensParam = z
  .enum(['caused', 'pays'])
  .describe(
    '`caused` groups by the person whose activity produced the cost; `pays` by the billing owner.',
  );

/** Query for the cost reports. */
export const AdminCostQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .describe('UTC month as `YYYY-MM`. Defaults to the current month.'),
  lens: CostLensParam.default('caused'),
});
/** Validated cost query. */
export type AdminCostQuery = z.infer<typeof AdminCostQuery>;

const Resource = z.enum(USAGE_RESOURCES).describe('The metered resource.');

/** Who a cost is assigned to. */
export const AdminCostHolder = z.object({
  key: z.string().describe('Opaque key: `user:<id>`, `workspace:<id>` or `unattributed`.'),
  kind: z.enum(['user', 'workspace', 'unattributed']).describe('What the key names.'),
  name: z.string().nullable().describe('The person or workspace name, when known.'),
  email: z.string().nullable().describe('The person email, for a user.'),
  costMicros: z.number().int().describe('Priced cost in millionths of a US dollar.'),
  hasUnpriced: z
    .boolean()
    .describe('Whether some usage had no rate, so `costMicros` is a floor and not the total.'),
  unmeasuredEvents: z.number().int().describe('Events that could not be quantified.'),
  topResource: Resource.nullable().describe('The resource with the largest priced cost.'),
});
/** Validated cost holder. */
export type AdminCostHolder = z.infer<typeof AdminCostHolder>;

/** How fresh one meter is. */
export const AdminCostMeter = z.object({
  meter: z.enum(USAGE_METERS).describe('The pass that fills part of the ledger.'),
  lastSuccessAt: z.string().nullable().describe('When it last completed, ISO-8601.'),
  failed: z.boolean().describe('Whether its latest attempt failed.'),
  stale: z.boolean().describe('Whether it has not completed in the last 48 hours.'),
});
/** Validated meter status. */
export type AdminCostMeter = z.infer<typeof AdminCostMeter>;

/** The ranked cost report. */
export const AdminCostsOut = z.object({
  month: z.string().describe('The UTC month covered, `YYYY-MM`.'),
  lens: CostLensParam,
  totalCostMicros: z.number().int().describe('Priced cost across every holder.'),
  hasUnpriced: z.boolean().describe('Whether any usage in the month had no rate.'),
  holders: z.array(AdminCostHolder).describe('Holders, largest cost first.'),
  meters: z.array(AdminCostMeter).describe('Freshness of each meter feeding the ledger.'),
});
/** Validated cost report. */
export type AdminCostsOut = z.infer<typeof AdminCostsOut>;

/** One resource line in a holder's detail. */
export const AdminCostLine = z.object({
  resource: Resource,
  dimension: z.string().describe('The model, table or store; empty when none.'),
  quantity: z.number().describe('Units consumed or held.'),
  costMicros: z.number().int().nullable().describe('Cost, or null when no rate applies.'),
  unmeasuredEvents: z.number().int().describe('Events that could not be quantified.'),
});
/** Validated cost line. */
export type AdminCostLine = z.infer<typeof AdminCostLine>;

/** One holder's cost, by resource, workspace and day. */
export const AdminCostDetailOut = z.object({
  month: z.string().describe('The UTC month covered, `YYYY-MM`.'),
  lens: CostLensParam,
  holder: AdminCostHolder,
  lifetimeCostMicros: z.number().int().describe('Priced cost across every day recorded.'),
  lines: z.array(AdminCostLine).describe('The month by resource and dimension.'),
  workspaces: z
    .array(
      z.object({
        organizationId: z.string().nullable(),
        name: z.string().nullable(),
        costMicros: z.number().int(),
      }),
    )
    .describe('The month by workspace.'),
  daily: z
    .array(z.object({ day: z.string(), costMicros: z.number().int() }))
    .describe('Priced cost for each day of the month with usage.'),
});
/** Validated cost detail. */
export type AdminCostDetailOut = z.infer<typeof AdminCostDetailOut>;

/** One price on the rate card. */
export const AdminRate = z.object({
  id: z.string(),
  resource: Resource,
  dimension: z.string().describe('A model, table or store; empty for the resource rate.'),
  microsPerMillionUnits: z.number().int().describe('Millionths of a US dollar per million units.'),
  effectiveFrom: z.string().describe('First instant the price applies, ISO-8601.'),
  note: z.string().nullable().describe('Where the price came from.'),
});
/** Validated rate. */
export type AdminRate = z.infer<typeof AdminRate>;

/** The rate card. */
export const AdminRatesOut = z.object({
  rates: z.array(AdminRate).describe('Every rate, newest first.'),
});
/** Validated rate card. */
export type AdminRatesOut = z.infer<typeof AdminRatesOut>;

/** Body for adding a rate. */
export const CreateRateBody = z.object({
  resource: Resource,
  dimension: z
    .string()
    .max(200)
    .default('')
    .describe('A model, table or store; empty for the resource rate.'),
  microsPerMillionUnits: z
    .number()
    .int()
    .min(0)
    .describe('Millionths of a US dollar per million units.'),
  effectiveFrom: z.iso.datetime().describe('First instant the price applies, ISO-8601.'),
  note: z.string().max(500).optional().describe('Where the price came from.'),
});
/** Validated rate body. */
export type CreateRateBody = z.infer<typeof CreateRateBody>;

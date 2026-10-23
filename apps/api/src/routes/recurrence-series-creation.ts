/** Atomic series creation receipts followed by resumable initial work materialization. */
import { db } from '@docket/db';
import type { Context, MiddlewareHandler } from 'hono';
import { RecurrenceSeriesCreate, RecurrenceSeriesOut } from '../contracts/recurrence';
import type { AppEnv } from '../context';
import { completeIdempotencyInTransaction } from '../lib/idempotency';
import { memberUrl } from '../lib/ok';
import { materializeScheduledProcess } from '../lib/recurrence/authoring';
import {
  createRecurrenceSeriesInTransaction,
  loadRecurrenceSeries,
} from '../lib/recurrence/series';

/**
 * Commit a series and its optional response receipt in the same transaction.
 * @param c - Authorized workspace context with an optional claimed retry identity.
 * @param body - Validated series authoring input.
 * @returns The validated series response retained for retries.
 */
export async function createSeriesWithReceipt(
  c: Context<AppEnv>,
  body: RecurrenceSeriesCreate,
): Promise<RecurrenceSeriesOut> {
  const { orgId, actorId } = c.get('actorCtx');
  const claim = c.get('idempotencyClaim');
  const series = await db.transaction(async (tx) => {
    const id = await createRecurrenceSeriesInTransaction(tx, {
      organizationId: orgId,
      actorId,
      series: body,
    });
    const response = RecurrenceSeriesOut.parse(await loadRecurrenceSeries(tx, orgId, id));
    if (claim) {
      await completeIdempotencyInTransaction(tx, claim, {
        organizationId: orgId,
        responseStatus: 201,
        responseBody: response,
        responseHeaders: { location: memberUrl(c, id), 'content-type': 'application/json' },
      });
    }
    return response;
  });
  if (claim) c.set('idempotencyCompleted', true);
  return series;
}

/**
 * Ensure initial work after either creation or receipt replay, with current series authorization.
 * The receipt commits first because materialization owns transactions and post-commit effects.
 * A failed materialization retains the receipt so a retry resumes the same series.
 */
export const materializeCreatedSeries: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.status !== 201) return;
  const series = RecurrenceSeriesOut.parse(await c.res.clone().json());
  const { orgId, actorId } = c.get('actorCtx');
  await materializeScheduledProcess(
    db,
    {
      organizationId: orgId,
      actorId,
      series: RecurrenceSeriesCreate.parse(await c.req.json()),
      // A retry on another date must resume the original initial window.
      now: new Date(series.createdAt),
    },
    series.id,
  );
};

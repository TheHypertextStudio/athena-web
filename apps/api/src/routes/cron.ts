/**
 * `@docket/api` — the lifecycle-sweep cron handler (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /v1/cron/lifecycle-sweep` runs the idempotent org data-lifecycle sweep
 * ({@link sweepLifecycle}): orgs past their export-window deadline advance
 * `export_window → pending_deletion → deleted`. It is guarded by a shared
 * `CRON_SECRET` bearer (matching the platform scheduler's `Authorization: Bearer …`
 * or an `x-cron-secret` header); a missing/incorrect secret 401s. Non-RPC, so it
 * lives in `server.ts` alongside `/api/auth` rather than the typed app. `now` is read
 * at request time, never at module scope, and the sweep is safe to retry.
 */
import { db } from '@docket/db';
import { Hono } from 'hono';

import { env } from '../env';
import { sweepLifecycle } from '../billing/lifecycle';

/** Extract the presented cron secret from `Authorization: Bearer …` or `x-cron-secret`. */
function presentedSecret(
  authorization: string | undefined,
  xCronSecret: string | undefined,
): string | undefined {
  if (xCronSecret) return xCronSecret;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  return undefined;
}

/** The cron app: secret-guarded, idempotent org data-lifecycle sweep. */
const cron = new Hono().post('/lifecycle-sweep', async (c) => {
  const presented = presentedSecret(c.req.header('authorization'), c.req.header('x-cron-secret'));
  if (!presented || presented !== env.CRON_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const now = new Date().toISOString();
  const result = await sweepLifecycle(db, now);
  return c.json({ swept: true, ...result });
});

export default cron;

/**
 * `@docket/api` — a dev-only in-process scheduler.
 *
 * @remarks
 * In production the cron sweeps are driven by GCP Cloud Scheduler (`scripts/scheduler-setup.ts`),
 * which does not exist locally — so during `pnpm dev` the export/deletion sweeps would never run
 * and an export would sit `pending` forever. This runs the **same** sweep functions on a short
 * interval, in the API process (sharing the single PGlite writer), so the local flow completes
 * responsively. It is started from `server.ts` ONLY when `APP_MODE === 'local'`; prod is untouched.
 */
import { db } from '@docket/db';

import { sweepAccountExports } from './account/export';
import { sweepAccountDeletions } from './account/lifecycle';

/** How often the dev scheduler runs the account sweeps (short, so exports feel responsive). */
const TICK_MS = 3000;

/** Start the dev-only scheduler. Safe to call once at boot; never in prod/test. */
export function startDevScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      const now = new Date().toISOString();
      await sweepAccountExports(db, now);
      await sweepAccountDeletions(db, now);
    } catch (err) {
      console.error('[dev-cron] sweep failed:', err);
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  // Don't keep the process alive on this timer alone.
  timer.unref();
  console.log(`▶ Docket dev scheduler ticking every ${String(TICK_MS / 1000)}s (local only)`);
}

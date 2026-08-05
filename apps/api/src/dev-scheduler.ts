/**
 * `@docket/api` — a dev-only in-process scheduler.
 *
 * @remarks
 * In production the cron sweeps are driven by GCP Cloud Scheduler (`scripts/scheduler-setup.ts`),
 * which does not exist locally — so during `pnpm dev` the sweeps would never run and an export (or
 * a calendar sync) would sit stale forever. This runs the **same** sweep functions on a short
 * interval, in the API process (sharing the single PGlite writer), so the local flow completes
 * responsively. It is started from `server.ts` ONLY when `APP_MODE === 'local'`; prod is untouched.
 *
 * The search-index drain belongs here for a sharper reason than responsiveness. Nothing local was
 * draining it, so `search_document` stayed empty in development and every feature reading it — the
 * command palette, the search page, the `@` picker — looked broken rather than merely slow, which
 * is a much more expensive kind of wrong to debug.
 */
import { db } from '@docket/db';

import { sweepAccountExports } from './account/export';
import { sweepAccountDeletions } from './account/lifecycle';
import { getContainer } from './container';
import { sweepResourceUnfurls } from './content/unfurl-sweep';
import { sweepCalendarSync } from './routes/calendar-sync-sweep';
import { processSearchIndexJobs } from './search/process-jobs';
import { sweepElicitations } from './services/elicitation-service';

/** How often the dev scheduler runs the account sweeps (short, so exports feel responsive). */
const TICK_MS = 3000;

/** Start the dev-only scheduler. Safe to call once at boot; never in prod/test. */
export function startDevScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      const now = new Date();
      await sweepAccountExports(db, now.toISOString());
      await sweepAccountDeletions(db, now.toISOString());
      await sweepCalendarSync(now);
      // Locally there is no Cloud Scheduler, so without this a question's deadline would never
      // arrive and "nothing pends forever" would be false in exactly the environment it is
      // demonstrated in.
      await sweepElicitations(now);
      await processSearchIndexJobs({ limit: 50 });
      await sweepResourceUnfurls(getContainer().unfurler, now);
    } catch (err) {
      console.error('[dev-cron] sweep failed:', err);
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  // Don't keep the process alive on this timer alone.
  timer.unref();
  console.log(`▶ Docket dev scheduler ticking every ${String(TICK_MS / 1000)}s (local only)`);
}

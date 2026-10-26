/**
 * `@docket/api` — the daily pass that fills the usage ledger.
 *
 * @remarks
 * Each meter runs on its own. One meter failing is recorded against that meter and does not stop the
 * others, so a broken query never leaves the ledger stale for every resource at once.
 */
import { db, usageMeterRun, type UsageMeter } from '@docket/db';

import { rollupAiTokens } from './ai-tokens';
import { snapshotObjectStorage, snapshotPostgresStorage } from './storage';

/** Days of AI usage recomputed on each pass, because a generation can finish after its day ends. */
const AI_LOOKBACK_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How one meter's pass ended. */
export interface MeterOutcome {
  /** The meter that ran. */
  readonly meter: UsageMeter;
  /** Whether it completed. */
  readonly ok: boolean;
  /** Ledger rows it wrote; zero on failure. */
  readonly rows: number;
}

/** The UTC calendar date of an instant, as `YYYY-MM-DD`. */
function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Record how a meter's latest attempt ended. */
async function recordAttempt(meter: UsageMeter, now: Date, ok: boolean): Promise<void> {
  await db
    .insert(usageMeterRun)
    .values({ meter, lastAttemptAt: now, lastSuccessAt: ok ? now : null, failed: !ok })
    .onConflictDoUpdate({
      target: usageMeterRun.meter,
      set: ok
        ? { lastAttemptAt: now, lastSuccessAt: now, failed: false }
        : { lastAttemptAt: now, failed: true },
    });
}

/**
 * Run every meter once.
 *
 * @param now - The instant the pass is for; the storage snapshots are taken for its UTC day.
 * @returns how each meter ended.
 */
export async function runUsageRollup(now: Date = new Date()): Promise<MeterOutcome[]> {
  const today = utcDay(now);
  const passes: readonly [UsageMeter, () => Promise<number>][] = [
    [
      'ai_tokens',
      () =>
        rollupAiTokens({
          from: utcDay(new Date(now.getTime() - AI_LOOKBACK_DAYS * DAY_MS)),
          to: utcDay(new Date(now.getTime() + DAY_MS)),
        }),
    ],
    ['postgres_storage', () => snapshotPostgresStorage(today)],
    ['object_storage', () => snapshotObjectStorage(today)],
  ];

  const outcomes: MeterOutcome[] = [];
  for (const [meter, pass] of passes) {
    try {
      const rows = await pass();
      await recordAttempt(meter, now, true);
      outcomes.push({ meter, ok: true, rows });
    } catch (error) {
      console.warn(`Usage meter "${meter}" failed`, error);
      await recordAttempt(meter, now, false);
      outcomes.push({ meter, ok: false, rows: 0 });
    }
  }
  return outcomes;
}

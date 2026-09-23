/**
 * `@docket/api` — the per-person upload rate limit for synced phone notifications.
 *
 * @remarks
 * A fixed hourly window stored in Postgres, so the limit holds across API instances and restarts.
 * The limit is generous — a phone batching a minute of notifications at a time uploads far less —
 * and exists to stop a misbehaving client from flooding the table, not to shape normal use.
 */
import { db, deviceNotificationUploadWindow, type Database } from '@docket/db';
import { eq } from 'drizzle-orm';

import { RateLimitedError } from '../../error';

/** The length of one upload window. */
export const UPLOAD_WINDOW_MILLISECONDS = 3_600_000;

/** Batches one person may upload in one window. */
export const UPLOAD_BATCH_LIMIT = 240;

/**
 * Count one upload batch against the caller's window.
 *
 * @throws {RateLimitedError} 429 with the seconds until the window resets, when it is full.
 */
export async function consumeUploadBatch(
  hubId: string,
  now = new Date(),
  database: Database = db,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .insert(deviceNotificationUploadWindow)
      .values({ hubId, windowStartedAt: now, batches: 0 })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(deviceNotificationUploadWindow)
      .where(eq(deviceNotificationUploadWindow.hubId, hubId))
      .for('update');
    const current =
      row && row.windowStartedAt.getTime() + UPLOAD_WINDOW_MILLISECONDS > now.getTime()
        ? row
        : { windowStartedAt: now, batches: 0 };
    if (current.batches >= UPLOAD_BATCH_LIMIT) {
      const resetAt = current.windowStartedAt.getTime() + UPLOAD_WINDOW_MILLISECONDS;
      throw new RateLimitedError((resetAt - now.getTime()) / 1_000);
    }
    await tx
      .update(deviceNotificationUploadWindow)
      .set({ windowStartedAt: current.windowStartedAt, batches: current.batches + 1 })
      .where(eq(deviceNotificationUploadWindow.hubId, hubId));
  });
}

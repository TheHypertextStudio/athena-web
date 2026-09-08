import { workLocationGeocodeRateLimit, type Database } from '@docket/db';
import { eq } from 'drizzle-orm';

import { RateLimitedError } from '../../error';

const WINDOW_MILLISECONDS = 60_000;
const REQUEST_LIMIT = 30;

/** Consume one request from a user's durable rolling geocoding window. */
export async function consumeGeocodingRequest(
  database: Database,
  userId: string,
  now = new Date(),
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .insert(workLocationGeocodeRateLimit)
      .values({ userId, requestTimestamps: [] })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ requestTimestamps: workLocationGeocodeRateLimit.requestTimestamps })
      .from(workLocationGeocodeRateLimit)
      .where(eq(workLocationGeocodeRateLimit.userId, userId))
      .for('update');
    const cutoff = now.getTime() - WINDOW_MILLISECONDS;
    const active = (row?.requestTimestamps ?? []).filter(
      (timestamp) => Date.parse(timestamp) > cutoff,
    );
    if (active.length >= REQUEST_LIMIT) {
      const retryAt = Date.parse(active[0] ?? now.toISOString()) + WINDOW_MILLISECONDS;
      throw new RateLimitedError((retryAt - now.getTime()) / 1_000);
    }
    await tx
      .update(workLocationGeocodeRateLimit)
      .set({ requestTimestamps: [...active, now.toISOString()], updatedAt: now })
      .where(eq(workLocationGeocodeRateLimit.userId, userId));
  });
}

/** Scheduled work-location bootstrap, convergence, projection, and watch renewal. */
import { calendarConnection, type Database } from '@docket/db';
import { ne } from 'drizzle-orm';

import {
  drainWorkLocationWrites,
  registerWorkLocationWatches,
  syncUserWorkLocations,
  type GoogleWorkLocationTransport,
} from './sync-engine';

/** Aggregate operational counters that deliberately contain no place labels or coordinates. */
export interface WorkLocationSweepTally {
  readonly usersProcessed: number;
  readonly accountsSynced: number;
  readonly inboundAdoptions: number;
  readonly writesApplied: number;
  readonly writesRetried: number;
  readonly watchesRegistered: number;
  readonly unsupportedRecurrences: number;
  readonly errors: number;
  readonly outboundProjectionEnabled: boolean;
}

/** Run one isolated pass across every user with a live linked calendar account. */
export async function sweepWorkLocations(
  database: Database,
  input: {
    readonly transport: GoogleWorkLocationTransport;
    readonly now: Date;
    readonly callbackUrl: string | null;
    readonly outboundProjectionEnabled: boolean;
  },
): Promise<WorkLocationSweepTally> {
  const users = await database
    .selectDistinct({ userId: calendarConnection.userId })
    .from(calendarConnection)
    .where(ne(calendarConnection.status, 'disconnected'));
  const tally = {
    usersProcessed: 0,
    accountsSynced: 0,
    inboundAdoptions: 0,
    writesApplied: 0,
    writesRetried: 0,
    watchesRegistered: 0,
    unsupportedRecurrences: 0,
    errors: 0,
    outboundProjectionEnabled: input.outboundProjectionEnabled,
  };
  for (const user of users) {
    try {
      const synced = await syncUserWorkLocations(database, {
        userId: user.userId,
        transport: input.transport,
        now: input.now,
      });
      tally.accountsSynced += synced.accounts;
      tally.inboundAdoptions += synced.imported + synced.adopted + synced.deleted;
      tally.unsupportedRecurrences += synced.unsupported;
      tally.errors += synced.errors;
      if (input.outboundProjectionEnabled) {
        const drained = await drainWorkLocationWrites(database, {
          userId: user.userId,
          transport: input.transport,
          now: input.now,
        });
        tally.writesApplied += drained.applied;
        tally.writesRetried += drained.retried;
        tally.errors += drained.failed;
      }
      tally.watchesRegistered += await registerWorkLocationWatches(database, {
        userId: user.userId,
        transport: input.transport,
        callbackUrl: input.callbackUrl,
        now: input.now,
      });
      tally.usersProcessed += 1;
    } catch {
      tally.errors += 1;
    }
  }
  return tally;
}
